-- After the workspace migrations (including drop_legacy): everything moved into
-- workspace "iyo" intact, and the legacy tables are gone.
\pset format unaligned
\pset tuples_only on
select 'workspaces: ' || string_agg(name, ',') from public.workspaces;
select 'owner: ' || p.email from public.workspaces w join public.profiles p on p.id = w.owner_id;
select 'platform admins: ' || string_agg(email, ',') from public.profiles where is_platform_admin;
select 'members: ' || string_agg(p.email || '=' || m.role || '/' || m.joined_via || '/' || m.status, ', ' order by p.email)
  from public.workspace_members m join public.profiles p on p.id = m.user_id;
select 'domains: ' || string_agg(domain || ' active=' || is_active || ' verified=' || verified, ',') from public.workspace_domains;
select 'audit moved: ' || string_agg(action, ',' order by id) from public.audit_log where workspace_id is not null;
select 'pages without workspace: ' || count(*) from public.pages where workspace_id is null;
select 'pages author = owner: ' || bool_and(created_by = owner_id) from public.pages;
select 'tree: ' || string_agg(c.title || '<' || coalesce(p.title, '-'), ', ' order by c.title)
  from public.pages c left join public.pages p on p.id = c.parent_id;
select 'trash kept: ' || string_agg(title, ',') from public.pages where deleted_at is not null;
select 'hook iyo.gg: ' || (public.hook_before_user_created('{"user":{"email":"new@iyo.gg"}}') = '{}'::jsonb);
select 'hook gmail: ' || (public.hook_before_user_created('{"user":{"email":"x@gmail.com"}}') ? 'error');

set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select 'elaidzha access: ' || public.has_platform_access() || ' role ' || public.workspace_role((select id from public.workspaces));
select 'elaidzha sees: ' || string_agg(title, ',' order by title) from public.pages where deleted_at is null;
select 'elaidzha platform admin: ' || public.is_platform_admin();
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select 'daniil role: ' || public.workspace_role((select id from public.workspaces));
select 'daniil sees: ' || string_agg(title, ',' order by title) from public.pages;
select 'daniil sees domains: ' || count(*) from public.workspace_domains;
select 'daniil sees log: ' || count(*) from public.audit_log;
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select 'colleague role: ' || public.workspace_role((select id from public.workspaces));
select 'colleague sees pages: ' || count(*) from public.pages;
select 'colleague sees profiles: ' || count(*) from public.profiles;
reset role;
select 'legacy tables gone: ' || (to_regclass('public.allowed_domains') is null and to_regclass('public.admin_audit_log') is null);
select 'is_admin column gone: ' || not exists (
  select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'is_admin');
