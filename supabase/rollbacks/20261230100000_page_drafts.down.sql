-- Undo 20261230100000_page_drafts: the draft rule, publishing and the published_at column.
drop trigger pages_draft_ack on public.pages;
drop function public.guard_draft_ack();
drop function public.publish_page(uuid, boolean);
drop function public.is_draft(public.pages);

-- The page tree as in 20261226100000_fast_reads.
drop function public.my_page_tree(uuid);

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

-- The role as in 20261222100000_unit_access.
create or replace function public.page_role_of(target_page uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with chain as (
    select c.* from public.access_chain(target_page) c
  ),
  guest as (
    select public.is_guest((select p.workspace_id from public.pages p where p.id = target_page), member) as yes
  ),
  candidates as (
    select case when c.depth = 0 then 'owner' else 'editor' end as role
    from chain c where c.owner_id = member
    union all
    select public.capped_role((select p.workspace_id from public.pages p where p.id = target_page), member, c.workspace_role) from chain c where c.workspace_role is not null and not (select g.yes from guest g)
    union all
    select a.role from chain c join public.page_access a on a.page_id = c.id and a.user_id = member
    union all
    select ga.role from chain c
    join public.page_group_access ga on ga.page_id = c.id
    -- Company structure, stage 3: a unit's grant reaches its sub-units and the leads above it.
    join lateral (select 1 where public.unit_reaches(ga.group_id, member)) gm on true
    where not (select g.yes from guest g)
  )
  select role from candidates order by public.role_rank(role) desc limit 1;
$$;

drop function public.page_draft_open(uuid, uuid);
drop index public.pages_drafts;
alter table public.pages drop column published_at;
