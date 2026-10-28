-- A person's statistics in a workspace: pages created, pages they can open by
-- role, characters written (counted at every save), comments.
--
-- Private by default: only the person sees them. They can show them to the
-- other members of that workspace. The counts never include page contents.
-- Rollback: supabase/rollbacks/20261108100000_profile_stats.down.sql

-------------------------------------------------------------------------------
-- Characters added and removed by each person on each page
-------------------------------------------------------------------------------

create table public.page_contributions (
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  page_id        uuid not null references public.pages (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  chars_added    bigint not null default 0,
  chars_removed  bigint not null default 0,
  saves          integer not null default 0,
  last_saved_at  timestamptz not null default now(),
  primary key (page_id, user_id)
);
create index page_contributions_user_idx on public.page_contributions (workspace_id, user_id);

alter table public.page_contributions enable row level security;
-- Read only through profile_stats(); written only by the trigger.
revoke all on public.page_contributions from anon, authenticated;

-- Runs after the search trigger has filled search_text (the page's plain text),
-- so the difference in its length is what this save added or removed.
-- Approximate: replacing a word with one of the same length counts as nothing.
create function public.record_page_contribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_len bigint := case when tg_op = 'UPDATE' then char_length(btrim(old.search_text)) else 0 end;
  after_len bigint := char_length(btrim(new.search_text));
begin
  if auth.uid() is null or before_len = after_len then
    return new;
  end if;
  insert into public.page_contributions as c (workspace_id, page_id, user_id, chars_added, chars_removed, saves)
  values (new.workspace_id, new.id, auth.uid(), greatest(after_len - before_len, 0), greatest(before_len - after_len, 0), 1)
  on conflict (page_id, user_id) do update set
    chars_added = c.chars_added + excluded.chars_added,
    chars_removed = c.chars_removed + excluded.chars_removed,
    saves = c.saves + 1,
    last_saved_at = now();
  return new;
end;
$$;

create trigger pages_contributions
  after insert or update of content on public.pages
  for each row execute function public.record_page_contribution();

revoke execute on function public.record_page_contribution() from public, anon, authenticated;

-- Earlier saves weren't counted: today's text of each page goes to its author.
insert into public.page_contributions (workspace_id, page_id, user_id, chars_added, saves, last_saved_at)
select p.workspace_id, p.id, p.created_by, char_length(btrim(p.search_text)), 1, p.updated_at
from public.pages p
where p.created_by is not null and char_length(btrim(p.search_text)) > 0
on conflict do nothing;

-------------------------------------------------------------------------------
-- Who may see a person's statistics in a workspace
-------------------------------------------------------------------------------

alter table public.workspace_members
  add column profile_visibility text not null default 'private'
    check (profile_visibility in ('private', 'workspace'));

create function public.set_my_profile_visibility(ws uuid, visibility text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(ws) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if visibility is null or visibility not in ('private', 'workspace') then
    return jsonb_build_object('ok', false, 'error', 'invalid_visibility');
  end if;
  update public.workspace_members set profile_visibility = visibility
  where workspace_id = ws and user_id = auth.uid() and status = 'active';
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.set_my_profile_visibility(uuid, text) from public, anon, authenticated;
grant execute on function public.set_my_profile_visibility(uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- The statistics
-------------------------------------------------------------------------------

create function public.profile_stats(ws uuid, person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  member public.workspace_members;
  roles jsonb;
begin
  if not public.is_workspace_member(ws) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into member from public.workspace_members m
  where m.workspace_id = ws and m.user_id = person and m.status = 'active';
  -- Someone else's statistics only when they chose to show them; a hidden
  -- profile looks the same as a missing one.
  if member.user_id is null or (person is distinct from auth.uid() and member.profile_visibility <> 'workspace') then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(jsonb_object_agg(r.role, r.n), '{}'::jsonb) into roles
  from (
    select public.page_role_of(p.id, person) as role, count(*) as n
    from public.pages p
    where p.workspace_id = ws and p.deleted_at is null
    group by 1
  ) r
  where r.role is not null;

  return jsonb_build_object(
    'ok', true,
    'name', (select coalesce(nullif(pr.name, ''), pr.email) from public.profiles pr where pr.id = person),
    'visibility', member.profile_visibility,
    'joined_at', member.joined_at,
    'pages_created', (select count(*) from public.pages p
                      where p.workspace_id = ws and p.created_by = person and p.deleted_at is null),
    'pages_by_role', roles,
    'chars_written', (select coalesce(sum(c.chars_added), 0) from public.page_contributions c
                      where c.workspace_id = ws and c.user_id = person),
    'chars_in_own_pages', (select coalesce(sum(char_length(btrim(p.search_text))), 0) from public.pages p
                           where p.workspace_id = ws and p.created_by = person and p.deleted_at is null),
    'pages_edited', (select count(*) from public.page_contributions c
                     join public.pages p on p.id = c.page_id and p.deleted_at is null
                     where c.workspace_id = ws and c.user_id = person),
    'comments', (select count(*) from public.comments cm
                 where cm.workspace_id = ws and cm.author_id = person)
  );
end;
$$;

revoke execute on function public.profile_stats(uuid, uuid) from public, anon, authenticated;
grant execute on function public.profile_stats(uuid, uuid) to authenticated;
