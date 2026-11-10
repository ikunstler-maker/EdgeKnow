-- Faster reads: the workspace of a request in one call, and the page tree in one pass.
-- The page tree part is the same in supabase/team/migrations/0041_fast_reads.sql.
-- Rollback: supabase/rollbacks/20261226100000_fast_reads.down.sql
-- No table, policy or rule of access changes: two read-only functions.

-- The workspace behind /w/<short id> for the caller: its id and name, the caller's
-- role and joining time, and whether it keeps its data in a team database (yes/no
-- only; where that database is stays readable with the secret key alone).
-- Nothing for someone who is not an active member — the same as reading
-- public.workspaces and asking workspace_role(), in one call instead of three.
create function public.workspace_context(ws_short_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', w.id,
    'short_id', w.short_id,
    'name', w.name,
    'role', r.role,
    'joined_at', (select m.joined_at from public.workspace_members m where m.workspace_id = w.id and m.user_id = auth.uid()),
    'team_database', exists (select 1 from public.team_databases t where t.workspace_id = w.id)
  )
  from public.workspaces w
  cross join lateral (select public.workspace_role(w.id) as role) r
  where w.short_id = ws_short_id and r.role is not null;
$$;

revoke execute on function public.workspace_context(text) from public, anon;
grant execute on function public.workspace_context(text) to authenticated;

-- The page tree of a workspace for the left panel, worked out in one pass: every
-- page the caller has a role on, with that role and the widest "whole workspace"
-- access. The same answer as reading public.pages with its computed columns
-- (my_role, shared_with_workspace) — the same rules as page_role_of(), written for
-- all pages at once: membership, "is a guest", the role ceiling and which units
-- reach the caller are worked out once per call instead of three times per page.
-- supabase/tests/stage51_fast_reads.sql compares the two ways row by row.
create function public.my_page_tree(ws uuid)
returns table (
  id uuid,
  parent_id uuid,
  title text,
  icon text,
  "position" integer,
  owner_id uuid,
  my_role text,
  shared_with_workspace text,
  ack_label text
)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive
  me as (
    select auth.uid() as id, public.is_workspace_member(ws) as member
  ),
  guest as (
    select public.is_guest(ws, (select me.id from me)) as yes
  ),
  -- Every live page with the pages it takes its access from (itself, then up while it inherits).
  chain as (
    select p.id as page_id, p.id, p.parent_id, p.inherit, p.owner_id, p.workspace_role, 0 as depth
    from public.pages p
    where p.workspace_id = ws and p.deleted_at is null and (select me.member from me)
    union all
    select c.page_id, pp.id, pp.parent_id, pp.inherit, pp.owner_id, pp.workspace_role, c.depth + 1
    from chain c
    join public.pages pp on pp.id = c.parent_id
    where c.inherit and c.depth < 100
  ),
  -- What "the whole workspace" access becomes for this person (a custom role may cap it).
  capped as (
    select v.granted, public.capped_role(ws, (select me.id from me), v.granted) as role
    from (values ('viewer'), ('commenter'), ('editor'), ('owner')) v (granted)
  ),
  -- The units whose grants reach this person (their own, the ones above, and below a unit they lead).
  reach as (
    select g.group_id
    from (select distinct ga.group_id from chain c join public.page_group_access ga on ga.page_id = c.id) g
    where public.unit_reaches(g.group_id, (select me.id from me))
  ),
  candidates as (
    select c.page_id, case when c.depth = 0 then 'owner' else 'editor' end as role
    from chain c where c.owner_id = (select me.id from me)
    union all
    select c.page_id, k.role
    from chain c join capped k on k.granted = c.workspace_role
    where not (select g.yes from guest g)
    union all
    select c.page_id, a.role
    from chain c join public.page_access a on a.page_id = c.id and a.user_id = (select me.id from me)
    union all
    select c.page_id, ga.role
    from chain c
    join public.page_group_access ga on ga.page_id = c.id
    join reach r on r.group_id = ga.group_id
    where not (select g.yes from guest g)
  ),
  roles as (
    select distinct on (k.page_id) k.page_id, k.role
    from candidates k
    where k.role is not null
    order by k.page_id, public.role_rank(k.role) desc
  ),
  shared as (
    select distinct on (c.page_id) c.page_id, c.workspace_role
    from chain c
    where c.workspace_role is not null
    order by c.page_id, public.role_rank(c.workspace_role) desc
  )
  select p.id, p.parent_id, p.title, p.icon, p.position, p.owner_id, r.role, s.workspace_role, p.ack_label
  from roles r
  join public.pages p on p.id = r.page_id
  left join shared s on s.page_id = p.id
  order by p.position;
$$;

revoke execute on function public.my_page_tree(uuid) from public, anon;
grant execute on function public.my_page_tree(uuid) to authenticated;
