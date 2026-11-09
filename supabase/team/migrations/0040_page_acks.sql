-- Wiki confirmations in a team's own database (as supabase/migrations/20261225100000_page_acks.sql).
-- Rollback: supabase/team/rollbacks/0040_page_acks.down.sql

-- A page can ask its readers to confirm it ("I have read it", "I accept the terms",
-- "I agree"). Turning it on freezes the page: its title, icon, cover and text can't
-- change while people sign it, so every signature is tied to exactly what was shown.
-- A new edition unfreezes it; publishing the edition makes a new revision that people
-- sign again (the old signatures stay with the old revision). Signatures can't be
-- changed or withdrawn by anyone; they go only with the page itself.

alter table public.pages
  add column ack_label text check (ack_label in ('read', 'accept', 'agree')),
  add column ack_revision integer not null default 0 check (ack_revision >= 0),
  add column ack_editing boolean not null default false,
  add column ack_groups uuid[] not null default '{}' check (cardinality(ack_groups) <= 50),
  add constraint pages_ack_state check ((ack_label is null) = (ack_revision = 0) and (ack_label is not null or not ack_editing));

-- What was published in each revision (title, text and its fingerprint).
create table public.page_ack_revisions (
  page_id       uuid not null references public.pages (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  revision      integer not null check (revision >= 1),
  label         text not null check (label in ('read', 'accept', 'agree')),
  title         text not null default '',
  content       jsonb,
  content_hash  text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- Plain ids, no foreign keys: a deleted account leaves its id here.
  published_by  uuid,
  published_at  timestamptz not null default now(),
  primary key (page_id, revision)
);
create index page_ack_revisions_workspace_idx on public.page_ack_revisions (workspace_id);

create table public.page_acks (
  page_id       uuid not null,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  revision      integer not null,
  user_id       uuid not null,
  label         text not null check (label in ('read', 'accept', 'agree')),
  content_hash  text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  signed_at     timestamptz not null default now(),
  primary key (page_id, revision, user_id),
  foreign key (page_id, revision) references public.page_ack_revisions (page_id, revision) on delete cascade
);
create index page_acks_workspace_idx on public.page_acks (workspace_id);
create index page_acks_user_idx on public.page_acks (user_id);

-- The fingerprint of a page's title and text.
create function public.page_ack_hash(page_title text, page_content jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(page_title, '') || chr(10) || coalesce(page_content::text, ''), 'UTF8')), 'hex');
$$;
revoke execute on function public.page_ack_hash(text, jsonb) from public, anon;
grant execute on function public.page_ack_hash(text, jsonb) to authenticated;

-- A page waiting for signatures can't be edited (whoever writes, the database refuses).
create function public.guard_frozen_page()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.ack_label is not null and not old.ack_editing and not new.ack_editing
     and (new.title, new.icon, new.content, new.cover) is distinct from (old.title, old.icon, old.content, old.cover) then
    raise exception 'page_frozen' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger pages_frozen before update of title, icon, content, cover, ack_editing on public.pages
  for each row execute function public.guard_frozen_page();

-- Signatures are never edited.
create function public.guard_page_ack()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'signatures_are_final' using errcode = 'P0001';
end;
$$;
create trigger page_acks_final before update on public.page_acks
  for each row execute function public.guard_page_ack();
create trigger page_ack_revisions_final before update on public.page_ack_revisions
  for each row execute function public.guard_page_ack();

-- Who manages confirmations of a page: its owner and the workspace's admins.
create function public.can_manage_page_ack(target_page uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.effective_role(target_page) = 'owner'
    or public.is_workspace_admin((select p.workspace_id from public.pages p where p.id = target_page)),
    false);
$$;
revoke execute on function public.can_manage_page_ack(uuid) from public, anon;
grant execute on function public.can_manage_page_ack(uuid) to authenticated;

alter table public.page_ack_revisions enable row level security;
alter table public.page_acks enable row level security;
revoke all on public.page_ack_revisions, public.page_acks from public, anon, authenticated;
grant select on public.page_ack_revisions, public.page_acks to authenticated;

create policy "Readers of the page see its revisions" on public.page_ack_revisions
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.effective_role(page_id) is not null);
create policy "Own signatures, or all of them for who manages the page" on public.page_acks
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and (user_id = auth.uid() or public.can_manage_page_ack(page_id)));

-- A copy of what is published now, as the next revision.
create function public.publish_page_ack_revision(target_page uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pages;
begin
  select * into p from public.pages where id = target_page for update;
  insert into public.page_ack_revisions (page_id, workspace_id, revision, label, title, content, content_hash, published_by)
  values (p.id, p.workspace_id, p.ack_revision + 1, p.ack_label, p.title, p.content, public.page_ack_hash(p.title, p.content), auth.uid());
  update public.pages set ack_revision = p.ack_revision + 1, ack_editing = false where id = target_page;
  return p.ack_revision + 1;
end;
$$;
revoke execute on function public.publish_page_ack_revision(uuid) from public, anon, authenticated;

-- Turn confirmation on (or change its button and who should sign).
create function public.set_page_ack(target_page uuid, new_label text, new_groups uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pages;
  groups uuid[] := coalesce(new_groups, '{}');
begin
  select * into p from public.pages where id = target_page;
  if p.id is null or not public.can_manage_page_ack(target_page) then
    return public.page_error('forbidden');
  end if;
  if p.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if new_label is null or new_label not in ('read', 'accept', 'agree') or cardinality(groups) > 50 then
    return public.page_error('invalid');
  end if;
  if exists (select 1 from unnest(groups) g where not exists (select 1 from public.workspace_groups wg where wg.id = g and wg.workspace_id = p.workspace_id)) then
    return public.page_error('invalid');
  end if;
  if p.ack_label is null then
    insert into public.page_ack_revisions (page_id, workspace_id, revision, label, title, content, content_hash, published_by)
    values (p.id, p.workspace_id, 1, new_label, p.title, p.content, public.page_ack_hash(p.title, p.content), auth.uid());
    update public.pages set ack_label = new_label, ack_revision = 1, ack_groups = groups where id = target_page;
    return jsonb_build_object('ok', true, 'revision', 1);
  end if;
  -- The button of a revision people already signed stays as it was signed.
  if new_label <> p.ack_label then
    if exists (select 1 from public.page_acks a where a.page_id = target_page and a.revision = p.ack_revision) then
      return public.page_error('has_signatures');
    end if;
    -- Revisions are never edited: the unsigned one is written again with the new button.
    with gone as (delete from public.page_ack_revisions where page_id = target_page and revision = p.ack_revision returning *)
    insert into public.page_ack_revisions (page_id, workspace_id, revision, label, title, content, content_hash, published_by, published_at)
    select page_id, workspace_id, revision, new_label, title, content, content_hash, published_by, published_at from gone;
  end if;
  update public.pages set ack_label = new_label, ack_groups = groups where id = target_page;
  return jsonb_build_object('ok', true, 'revision', p.ack_revision);
end;
$$;
revoke execute on function public.set_page_ack(uuid, text, uuid[]) from public, anon;
grant execute on function public.set_page_ack(uuid, text, uuid[]) to authenticated;

-- Turn it off: only while nobody has signed any revision.
create function public.disable_page_ack(target_page uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_page_ack(target_page) then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.page_acks a where a.page_id = target_page) then
    return public.page_error('has_signatures');
  end if;
  delete from public.page_ack_revisions where page_id = target_page;
  update public.pages set ack_label = null, ack_revision = 0, ack_editing = false, ack_groups = '{}' where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.disable_page_ack(uuid) from public, anon;
grant execute on function public.disable_page_ack(uuid) to authenticated;

-- A new edition: the page can be edited again; signing waits until it is published.
create function public.page_ack_edition(target_page uuid, step text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pages;
  r public.page_ack_revisions;
begin
  select * into p from public.pages where id = target_page;
  if p.id is null or not public.can_manage_page_ack(target_page) then
    return public.page_error('forbidden');
  end if;
  if p.ack_label is null or p.deleted_at is not null then
    return public.page_error('invalid');
  end if;
  if step = 'start' and not p.ack_editing then
    update public.pages set ack_editing = true where id = target_page;
    return jsonb_build_object('ok', true);
  elsif step = 'publish' and p.ack_editing then
    return jsonb_build_object('ok', true, 'revision', public.publish_page_ack_revision(target_page));
  elsif step = 'cancel' and p.ack_editing then
    -- Back to the published text.
    select * into r from public.page_ack_revisions where page_id = target_page and revision = p.ack_revision;
    update public.pages set title = r.title, content = r.content, version = version + 1, updated_at = now(), updated_by = auth.uid(), ack_editing = false
    where id = target_page;
    return jsonb_build_object('ok', true);
  end if;
  return public.page_error('invalid');
end;
$$;
revoke execute on function public.page_ack_edition(uuid, text) from public, anon;
grant execute on function public.page_ack_edition(uuid, text) to authenticated;

-- "I have read it" / "I accept" / "I agree" on the published revision.
create function public.ack_page(target_page uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pages;
  r public.page_ack_revisions;
  at timestamptz;
begin
  select * into p from public.pages where id = target_page;
  if p.id is null or not public.is_workspace_member(p.workspace_id) or public.effective_role(target_page) is null then
    return public.page_error('forbidden');
  end if;
  if p.ack_label is null or p.ack_editing or p.deleted_at is not null then
    return public.page_error('not_open');
  end if;
  select * into r from public.page_ack_revisions where page_id = target_page and revision = p.ack_revision;
  insert into public.page_acks (page_id, workspace_id, revision, user_id, label, content_hash)
  values (p.id, p.workspace_id, r.revision, auth.uid(), r.label, r.content_hash)
  on conflict (page_id, revision, user_id) do nothing;
  select a.signed_at into at from public.page_acks a where a.page_id = target_page and a.revision = r.revision and a.user_id = auth.uid();
  return jsonb_build_object('ok', true, 'revision', r.revision, 'signed_at', at);
end;
$$;
revoke execute on function public.ack_page(uuid) from public, anon;
grant execute on function public.ack_page(uuid) to authenticated;

-- Who signed a revision (name and email, or only the id of a deleted account), and
-- for the current one who still should (members of the chosen units, or everyone,
-- who can open the page).
create function public.page_ack_stats(target_page uuid, target_revision integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.pages;
  rev integer;
  signed jsonb;
  pending jsonb := '[]'::jsonb;
begin
  select * into p from public.pages where id = target_page;
  if p.id is null or not public.can_manage_page_ack(target_page) then
    return public.page_error('forbidden');
  end if;
  rev := coalesce(target_revision, p.ack_revision);
  select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', pr.name, 'email', pr.email, 'signed_at', a.signed_at) order by a.signed_at), '[]'::jsonb)
  into signed
  from public.page_acks a left join public.profiles pr on pr.id = a.user_id
  where a.page_id = target_page and a.revision = rev;
  if rev = p.ack_revision and p.ack_label is not null then
    select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', pr.name, 'email', pr.email) order by coalesce(pr.name, pr.email)), '[]'::jsonb)
    into pending
    from public.workspace_members m
    join public.profiles pr on pr.id = m.user_id
    where m.workspace_id = p.workspace_id and m.status = 'active'
      and (cardinality(p.ack_groups) = 0 or exists (select 1 from unnest(p.ack_groups) g where public.unit_reaches(g, m.user_id)))
      and public.page_role_of(target_page, m.user_id) is not null
      and not exists (select 1 from public.page_acks a where a.page_id = target_page and a.revision = rev and a.user_id = m.user_id);
  end if;
  return jsonb_build_object('ok', true, 'revision', rev, 'signed', signed, 'pending', pending,
    'any_signed', exists (select 1 from public.page_acks a where a.page_id = target_page));
end;
$$;
revoke execute on function public.page_ack_stats(uuid, integer) from public, anon;
grant execute on function public.page_ack_stats(uuid, integer) to authenticated;
