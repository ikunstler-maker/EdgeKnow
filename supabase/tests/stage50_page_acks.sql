-- Wiki confirmations: a frozen page, signatures that can't change, statistics for the
-- owner and admins only, a deleted account kept as its id, new editions.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000050a1', 'alice@acks.test', now()),
 ('00000000-0000-0000-0000-0000000050b1', 'bob@acks.test', now()),
 ('00000000-0000-0000-0000-0000000050c1', 'carl@acks.test', now()),
 ('00000000-0000-0000-0000-0000000050e1', 'eve@other-acks.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050a1';
select public.create_workspace('Acks') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'acks.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050e1';
select public.create_workspace('Other') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050a1';
select public.create_page(:'ws', null, 'Rules') ->> 'id' as page \gset
select public.save_page_content(:'page', '[{"type": "paragraph", "content": "Be kind"}]', 1, false) ->> 'ok' as ignored \gset
select public.set_page_workspace_role(:'page', 'editor') ->> 'ok' as ignored \gset

-- Bob edits the page but doesn't manage confirmations.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050b1';
select 'editor turns on: ' || (public.set_page_ack(:'page', 'agree', '{}') ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050a1';
select 'owner turns on: ' || (public.set_page_ack(:'page', 'agree', '{}') ->> 'revision');
select 'bad button: ' || (public.set_page_ack(:'page', 'maybe', '{}') ->> 'error');
select 'button changed before signatures: ' || (public.set_page_ack(:'page', 'read', '{}') ->> 'ok');

-- Frozen: nobody edits it, by any route.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050b1';
select 'save frozen: ' || coalesce(public.save_page_content(:'page', '[]', 2, true)::text, 'null');
select 'rename frozen: ' || coalesce(public.rename_page(:'page', 'New')::text, 'null');
reset role;
update public.pages set content = '[]' where id = :'page';
set role authenticated;

-- Bob signs, twice is once.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050b1';
select 'bob signs: ' || (public.ack_page(:'page') ->> 'ok');
select 'again: ' || (public.ack_page(:'page') ->> 'ok');
select 'bob sees own: ' || count(*) from public.page_acks where page_id = :'page';
select 'bob stats: ' || (public.page_ack_stats(:'page', null) ->> 'error');
with d as (delete from public.page_acks where page_id = :'page' returning 1) select 'bob withdraws: ' || count(*) from d;
reset role;
update public.page_acks set signed_at = now() - interval '1 day' where page_id = :'page';
set role authenticated;
-- An outsider sees nothing and can't sign.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050e1';
select 'outsider signs: ' || (public.ack_page(:'page') ->> 'error');
select 'outsider sees: ' || count(*) from public.page_acks;
select 'outsider stats: ' || (public.page_ack_stats(:'page', null) ->> 'error');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050a1';
select 'button after signatures: ' || (public.set_page_ack(:'page', 'agree', '{}') ->> 'error');
select 'turn off after signatures: ' || (public.disable_page_ack(:'page') ->> 'error');
select 'stats: ' || jsonb_array_length(s -> 'signed') || ' signed (' || (s #>> '{signed,0,email}') || '), pending ' || (select string_agg(x ->> 'email', ',' order by x ->> 'email') from jsonb_array_elements(s -> 'pending') x)
from (select public.page_ack_stats(:'page', null) as s) q;
select 'hash kept: ' || (a.content_hash = public.page_ack_hash('Rules', '[{"type": "paragraph", "content": "Be kind"}]')) from public.page_acks a where a.page_id = :'page';

-- A new edition: editable, no signing until published; then revision 2.
select 'edition: ' || (public.page_ack_edition(:'page', 'start') ->> 'ok');
select 'save in edition: ' || (public.save_page_content(:'page', '[{"type": "paragraph", "content": "Be kinder"}]', 2, true) ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050c1';
select 'sign during edition: ' || (public.ack_page(:'page') ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050a1';
select 'published: ' || (public.page_ack_edition(:'page', 'publish') ->> 'revision');
select 'frozen again: ' || coalesce(public.rename_page(:'page', 'X')::text, 'null');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050c1';
select 'carl signs rev 2: ' || (public.ack_page(:'page') ->> 'revision');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050a1';
select 'rev 1 still: ' || jsonb_array_length(public.page_ack_stats(:'page', 1) -> 'signed') || ', rev 2: ' || jsonb_array_length(public.page_ack_stats(:'page', 2) -> 'signed');

-- Cancelling an edition brings back the published text.
select public.page_ack_edition(:'page', 'start') ->> 'ok' as ignored \gset
select public.save_page_content(:'page', '[{"type": "paragraph", "content": "Draft"}]', 4, true) ->> 'ok' as ignored \gset
select 'cancel: ' || (public.page_ack_edition(:'page', 'cancel') ->> 'ok');
select 'text back: ' || (content #>> '{0,content}') || ' frozen ' || (not ack_editing) from public.pages where id = :'page';

-- A deleted account stays as its id, without name or email.
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000050b1';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050a1';
select 'deleted signer: ' || (x ->> 'user_id') || ' ' || coalesce(x ->> 'name', 'no name') || ' ' || coalesce(x ->> 'email', 'no email')
from jsonb_array_elements(public.page_ack_stats(:'page', 1) -> 'signed') x;

-- A page without signatures can be turned off and edited again.
select public.create_page(:'ws', null, 'Draft rules') ->> 'id' as page2 \gset
select public.set_page_ack(:'page2', 'read', '{}') ->> 'ok' as ignored \gset
select 'turn off unsigned: ' || (public.disable_page_ack(:'page2') ->> 'ok');
select 'editable again: ' || (public.rename_page(:'page2', 'Draft 2') ->> 'ok');

reset role;
delete from public.workspaces where id in (:'ws', :'other');
delete from auth.users where email like '%acks.test';
