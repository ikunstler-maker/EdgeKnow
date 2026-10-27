-- After migrating and then running the rollback scripts: stage 2 behaviour is back.
\pset format unaligned
\pset tuples_only on
select 'workspaces table gone: ' || (to_regclass('public.workspaces') is null);
select 'pages.workspace_id gone: ' || not exists (
  select 1 from information_schema.columns where table_name = 'pages' and column_name = 'workspace_id');
select 'pages kept: ' || count(*) from public.pages;
select 'domains kept: ' || string_agg(domain, ',') from public.allowed_domains;
select 'hook iyo.gg: ' || (public.hook_before_user_created('{"user":{"email":"new@iyo.gg"}}') = '{}'::jsonb);
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select 'elaidzha allowed: ' || public.is_allowed_user();
select 'elaidzha sees: ' || string_agg(title, ',' order by title) from public.pages where deleted_at is null;
select 'create works: ' || (public.create_page(null, 'After rollback') ->> 'ok');
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select 'daniil sees: ' || string_agg(title, ',' order by title) from public.pages;
reset role;
