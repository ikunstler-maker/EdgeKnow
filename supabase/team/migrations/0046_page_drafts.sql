-- Wiki drafts in a team's own database (as supabase/migrations/20261231100000_page_drafts.sql).
-- Rollback: supabase/team/rollbacks/0046_page_drafts.down.sql
--
-- A draft is an extra filter on top of the usual page access, never a new access:
-- a page is hidden from a person when the page itself or any page above it (by
-- parent, whether or not it inherits access) is unpublished and that person is not,
-- for that unpublished page, its owner, someone invited to it personally
-- (page_access), or the workspace owner. An invitation covers only that one draft;
-- admins, units and "whole workspace" access don't open a draft. Everything that asks page_role_of() (reading pages, comments,
-- files, search, notifications, task links, chips) follows at once; the left
-- panel's my_page_tree() applies the same rule in one pass.
-- Existing pages become published at their creation time.

alter table public.pages add column published_at timestamptz;

update public.pages set published_at = created_at;

create index pages_drafts on public.pages (workspace_id) where published_at is null;

-- Does the draft rule let this person see the page? Every unpublished page on the way
-- up (the page itself included) must be open to them on its own: they own it, are
-- invited to it personally, or own the workspace. An invitation to a draft doesn't
-- reach the drafts inside it (the share dialog offers to invite to those as well).
create function public.page_draft_open(target_page uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select p.id, p.parent_id, p.published_at, p.owner_id, p.workspace_id, 0 as depth
    from public.pages p
    where p.id = target_page
    union all
    select pp.id, pp.parent_id, pp.published_at, pp.owner_id, pp.workspace_id, u.depth + 1
    from up u
    join public.pages pp on pp.id = u.parent_id
    where u.depth < 100
  )
  select not exists (
    select 1
    from up u
    where u.published_at is null
      and u.owner_id is distinct from member
      and not exists (select 1 from public.page_access a where a.page_id = u.id and a.user_id = member)
      and not exists (
        select 1 from public.workspace_members m
        where m.workspace_id = u.workspace_id and m.user_id = member and m.role = 'owner' and m.status = 'active'
      )
  );
$$;

revoke execute on function public.page_draft_open(uuid, uuid) from public, anon, authenticated;

-- The person's role on a page: as before (0037_unit_access), and nothing at
-- all while a draft on the way up is closed to them.
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
  select role from candidates
  where public.page_draft_open(target_page, member)
  order by public.role_rank(role) desc limit 1;
$$;

-- The page tree for the left panel (as 0041_fast_reads) with the draft rule
-- and a "draft" mark (the page or a page above it is unpublished).
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
  ack_label text,
  draft boolean
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
  ws_owner as (
    select exists (
      select 1 from public.workspace_members m
      where m.workspace_id = ws and m.user_id = (select me.id from me) and m.role = 'owner' and m.status = 'active'
    ) as yes
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
  -- Unpublished pages of the workspace that this person opens (owner, invited, workspace owner).
  opener as (
    select d.id
    from public.pages d
    where d.workspace_id = ws and d.published_at is null and (select me.member from me)
      and (
        d.owner_id = (select me.id from me)
        or exists (select 1 from public.page_access a where a.page_id = d.id and a.user_id = (select me.id from me))
        or (select o.yes from ws_owner o)
      )
  ),
  -- Down the tree from the top: hidden once a draft not open to this person is met
  -- (and everything below it); "draft" once any unpublished page is met.
  walk as (
    select p.id as page_id,
           p.published_at is null as draft,
           (p.published_at is null and not exists (select 1 from opener o where o.id = p.id)) as hidden,
           0 as depth
    from public.pages p
    where p.workspace_id = ws and p.parent_id is null and (select me.member from me)
    union all
    select c.id,
           w.draft or c.published_at is null,
           w.hidden or (c.published_at is null and not exists (select 1 from opener o where o.id = c.id)),
           w.depth + 1
    from walk w
    join public.pages c on c.parent_id = w.page_id
    where w.depth < 100
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
  select p.id, p.parent_id, p.title, p.icon, p.position, p.owner_id, r.role, s.workspace_role, p.ack_label, coalesce(w.draft, false)
  from roles r
  join public.pages p on p.id = r.page_id
  left join shared s on s.page_id = p.id
  left join walk w on w.page_id = p.id
  where not coalesce(w.hidden, false)
  order by p.position;
$$;

revoke execute on function public.my_page_tree(uuid) from public, anon;
grant execute on function public.my_page_tree(uuid) to authenticated;

-- Whether the page or a page above it is still unpublished (for the page header);
-- PostgREST computed field `is_draft` on pages.
create function public.is_draft(page public.pages)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select p.id, p.parent_id, p.published_at, 0 as depth from public.pages p where p.id = page.id
    union all
    select pp.id, pp.parent_id, pp.published_at, u.depth + 1
    from up u join public.pages pp on pp.id = u.parent_id
    where u.depth < 100
  )
  select exists (select 1 from up where published_at is null);
$$;

revoke execute on function public.is_draft(public.pages) from public, anon;
grant execute on function public.is_draft(public.pages) to authenticated;

-- Publish a draft (its owner or an editor). With `with_children`, the drafts below it
-- that this person may edit are published too; others' closed drafts stay as they are.
-- A page under a still unpublished page stays hidden until that page is published.
create function public.publish_page(target_page uuid, with_children boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pages;
  done integer := 0;
  more integer := 0;
begin
  select * into p from public.pages where id = target_page;
  if p.id is null or not public.is_workspace_member(p.workspace_id) or not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if p.deleted_at is not null then
    return public.page_error('in_trash');
  end if;

  update public.pages set published_at = now() where id = target_page and published_at is null;
  get diagnostics done = row_count;

  if coalesce(with_children, false) then
    with recursive below as (
      select c.id, 0 as depth from public.pages c where c.parent_id = target_page and c.deleted_at is null
      union all
      select c.id, b.depth + 1 from below b join public.pages c on c.parent_id = b.id
      where c.deleted_at is null and b.depth < 100
    )
    update public.pages q set published_at = now()
    from below b
    where q.id = b.id and q.published_at is null and public.can_edit_page(q.id);
    get diagnostics more = row_count;
  end if;

  return jsonb_build_object('ok', true, 'published', done + more);
end;
$$;

revoke execute on function public.publish_page(uuid, boolean) from public, anon;
grant execute on function public.publish_page(uuid, boolean) to authenticated;

-- Confirmations of reading can't be turned on for a draft.
create function public.guard_draft_ack()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ack_label is not null and old.ack_label is null and new.published_at is null then
    raise exception 'draft' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_draft_ack() from public, anon, authenticated;

create trigger pages_draft_ack before update of ack_label on public.pages
  for each row execute function public.guard_draft_ack();
