-- Deleting an account: refused while the person owns a workspace; otherwise
-- their pages go to the workspace owner, and removing the sign-in account takes
-- the rest with it while comments stay as "former member". Server only.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000019a1', 'olga@leave.test', now()),
 ('00000000-0000-0000-0000-0000000019b1', 'pete@leave.test', now());

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019a1';
select public.create_workspace('Leaving') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'leave.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Pete notes') ->> 'id' as page \gset
select public.create_comment_thread(:'page', 'x', 'Pete says hi', '{}') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;
insert into public.invitations (workspace_id, email, role, invited_by, token_hash) values (:'ws', 'pete@leave.test', 'member', '00000000-0000-0000-0000-0000000019a1', 'leave-token-hash-1');

select 'owner can''t go: ' || public.account_deletion_cleanup('00000000-0000-0000-0000-0000000019a1')::text;
select 'pete: ' || public.account_deletion_cleanup('00000000-0000-0000-0000-0000000019b1')::text;
select 'page now owned by: ' || (select p.email from public.pages g join public.profiles p on p.id = g.owner_id where g.id = :'page');
select 'invitations left: ' || count(*) from public.invitations where email = 'pete@leave.test';
delete from auth.users where id = '00000000-0000-0000-0000-0000000019b1';
select 'profile left: ' || count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000019b1';
select 'membership left: ' || count(*) from public.workspace_members where user_id = '00000000-0000-0000-0000-0000000019b1';
select 'comment kept, author: ' || coalesce(author_id::text, 'former member') from public.comments where body = 'Pete says hi';
select 'unknown person: ' || public.account_deletion_cleanup(gen_random_uuid())::text;

\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019a1';
select public.account_deletion_cleanup('00000000-0000-0000-0000-0000000019a1');
reset role;
\set ON_ERROR_STOP 1
delete from public.pages where workspace_id = :'ws';
