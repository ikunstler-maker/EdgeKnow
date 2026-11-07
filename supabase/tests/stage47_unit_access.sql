-- Company structure, stage 3: a unit's grant reaches its sub-units (down) and the leads
-- of the units above it (up, leads only); a lead manages only their own branch.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000047a1', 'alice@units.test', now()),
 ('00000000-0000-0000-0000-0000000047b1', 'dina@units.test', now()),
 ('00000000-0000-0000-0000-0000000047c1', 'max@units.test', now()),
 ('00000000-0000-0000-0000-0000000047d1', 'sam@units.test', now()),
 ('00000000-0000-0000-0000-0000000047e1', 'kim@units.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000047a1';
select public.create_workspace('Units') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'units.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000047b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000047c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000047d1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000047e1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

-- Company > Marketing > Design; Company > Sales. Dina: Design; Max: lead of Marketing;
-- Sam: Sales; Kim: plain member of Company.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000047a1';
select public.create_workspace_group(:'ws', 'Company') ->> 'id' as company \gset
select public.create_workspace_group(:'ws', 'Marketing', :'company') ->> 'id' as marketing \gset
select public.create_workspace_group(:'ws', 'Design', :'marketing') ->> 'id' as design \gset
select public.create_workspace_group(:'ws', 'Sales', :'company') ->> 'id' as sales \gset
select public.set_workspace_group_member(:'ws', :'design', '00000000-0000-0000-0000-0000000047b1', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'marketing', '00000000-0000-0000-0000-0000000047c1', true) ->> 'ok' as ignored \gset
select 'max leads marketing: ' || (public.set_group_lead(:'ws', :'marketing', '00000000-0000-0000-0000-0000000047c1', true) ->> 'ok');
select public.set_workspace_group_member(:'ws', :'sales', '00000000-0000-0000-0000-0000000047d1', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'company', '00000000-0000-0000-0000-0000000047e1', true) ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Marketing plan') ->> 'id' as mkt_page \gset
select public.set_page_workspace_role(:'mkt_page', null) ->> 'ok' as ignored \gset
select public.set_page_group_role(:'mkt_page', :'marketing', 'editor') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Design brief') ->> 'id' as design_page \gset
select public.set_page_workspace_role(:'design_page', null) ->> 'ok' as ignored \gset
select public.set_page_group_role(:'design_page', :'design', 'commenter') ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Campaigns', 'CMP', null, null) ->> 'id' as project \gset
select public.update_task_project(:'project', '{"workspace_role": null}') ->> 'ok' as ignored \gset
select public.set_task_project_group_role(:'project', :'marketing', 'editor') ->> 'ok' as ignored \gset

select 'design member on marketing page (down): ' || coalesce((select public.my_role(p) from public.pages p where p.id = :'mkt_page'), 'none')
  from (select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000047b1', false)) x;
select 'design member on marketing project (down): ' || coalesce(public.task_project_role(:'project'), 'none');
select 'sales on marketing page: ' || coalesce((select public.my_role(p) from public.pages p where p.id = :'mkt_page'), 'none')
  from (select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000047d1', false)) x;
select 'sales on marketing project: ' || coalesce(public.task_project_role(:'project'), 'none');
select 'marketing lead on design page (up): ' || coalesce((select public.my_role(p) from public.pages p where p.id = :'design_page'), 'none')
  from (select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000047c1', false)) x;
select 'company member on design page (no up for members): ' || coalesce((select public.my_role(p) from public.pages p where p.id = :'design_page'), 'none')
  from (select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000047e1', false)) x;
select 'company member on marketing page: ' || coalesce((select public.my_role(p) from public.pages p where p.id = :'mkt_page'), 'none');

-- Max (lead of Marketing) manages his branch only.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000047c1';
select 'lead adds to design: ' || (public.set_workspace_group_member(:'ws', :'design', '00000000-0000-0000-0000-0000000047e1', true) ->> 'ok');
select 'lead adds to sales: ' || public.set_workspace_group_member(:'ws', :'sales', '00000000-0000-0000-0000-0000000047e1', true)::text;
select 'lead makes a sub-unit: ' || (public.create_workspace_group(:'ws', 'Video', :'design') ->> 'ok');
select 'lead makes a top unit: ' || public.create_workspace_group(:'ws', 'Rogue')::text;
select 'lead moves design under sales: ' || public.move_workspace_group(:'ws', :'design', :'sales', null)::text;
select 'lead renames sales: ' || public.rename_workspace_group(:'ws', :'sales', 'Mine')::text;
select 'lead makes a lead below: ' || (public.set_group_lead(:'ws', :'design', '00000000-0000-0000-0000-0000000047b1', true) ->> 'ok');

-- Sam (plain member) cannot touch the structure.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000047d1';
select 'member sets a lead: ' || public.set_group_lead(:'ws', :'sales', '00000000-0000-0000-0000-0000000047d1', true)::text;
reset role;
select 'team copy has leads: ' || count(*) from jsonb_array_elements(public.team_sync_payload(:'ws') -> 'group_members') x where (x ->> 'is_lead')::boolean;
