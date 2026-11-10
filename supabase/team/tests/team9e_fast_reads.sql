-- The page tree in one pass, in a team database: the same rows as reading the table.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set old 'select p.id, p.parent_id, p.title, p.icon, p.position, p.owner_id, public.my_role(p) as my_role, public.shared_with_workspace(p) as shared_with_workspace, p.ack_label from public.pages p where p.workspace_id = :''ws'' and p.deleted_at is null'
\set new 'select * from public.my_page_tree(:''ws'')'
\set compare 'select ((select count(*) from (:old) o) > 0) || '' some pages, '' || (select count(*) from ((:old) except (:new)) d) || '' only the old way, '' || (select count(*) from ((:new) except (:old)) d) || '' only the new way'''

set role authenticated;
:as_bob;
select public.create_page(:'ws', null, 'Fast tree') ->> 'id' as page \gset
select public.create_page(:'ws', :'page', 'Fast tree child') ->> 'id' as child \gset
select 'bob (member): ' || (:compare);
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member): ' || (select count(*) from public.my_page_tree(:'ws')) || ' the new way, ' || (select count(*) from public.pages where workspace_id = :'ws') || ' the old way';
reset role;
select 'anon may call it: ' || has_function_privilege('anon', 'public.my_page_tree(uuid)', 'execute');
