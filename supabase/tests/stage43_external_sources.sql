-- External wiki sources: server-only table, members and outsiders cannot read the key.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000043a1', 'alice@external.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000043a1';
select public.create_workspace('External') ->> 'id' as ws \gset
select public.create_page(:'ws', null, 'Help') ->> 'id' as page \gset
reset role;
update public.platform_settings set open_registration = false;

insert into public.external_sources (workspace_id, page_id, url, secret_encrypted)
values (:'ws', :'page', 'https://help.example.com/doc.md', 'v1.secret');
insert into public.external_sources (workspace_id, page_id, url) values (:'ws', gen_random_uuid(), 'http://plain.example.com/x');
insert into public.external_sources (workspace_id, page_id, url, languages) values (:'ws', gen_random_uuid(), 'https://h.example.com/?lang={lang}', '{uk,RU}');
insert into public.external_sources (workspace_id, page_id, url, languages) values (:'ws', gen_random_uuid(), 'https://h.example.com/?lang={lang}', '{uk,ru}');
select 'languages: ' || array_to_string(languages, ',') from public.external_sources where languages <> '{}';


set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000043a1';
select 'admin reads table: ' || count(*) from public.external_sources;
reset role;
set role anon;
select 'anon reads table: ' || count(*) from public.external_sources;
reset role;
delete from public.workspaces where id = :'ws';
select 'rows left: ' || count(*) from public.external_sources;
