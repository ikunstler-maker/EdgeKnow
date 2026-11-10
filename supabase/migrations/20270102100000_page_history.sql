-- Wiki page history (decision 2027-01-27): versions by editing session, view and restore.
-- The same in supabase/team/migrations/0048_page_history.sql.
-- Rollback: supabase/rollbacks/20270102100000_page_history.down.sql
--
-- A version is a snapshot of the page (title, icon, content) as it was after an
-- editing session: one person's changes merge into one version while they keep
-- editing with breaks under 10 minutes. Publishing, starting a new read-confirmation
-- revision and restoring make versions of their own. Only the page's owner and
-- editors read versions (through page_role_of, so drafts stay closed as they are);
-- nobody writes them directly. Versions older than page_history_days() are removed,
-- the newest one of each page always stays. Restoring writes the old text as the
-- page's current text (nothing is lost: the text before it is the version below).

create table public.page_versions (
  id          uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  page_id     uuid not null references public.pages (id) on delete cascade,
  reason      text not null check (reason in ('edit', 'publish', 'ack_revision', 'restore')),
  title       text not null default '',
  icon        text,
  content     jsonb,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  -- The last save merged into this version (an editing session).
  last_at     timestamptz not null default now(),
  restored_from uuid
);

create index page_versions_page on public.page_versions (page_id, created_at desc);
create index page_versions_age on public.page_versions (created_at);

alter table public.page_versions enable row level security;
revoke all on public.page_versions from anon;
revoke insert, update, delete, truncate on public.page_versions from authenticated;

create policy "Owners and editors of a page read its versions"
  on public.page_versions for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.can_edit_page(page_id));

-- How long versions are kept (Free: 7 days; longer plans come with payments).
create function public.page_history_days()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 7;
$$;

-- An editing session lasts while the same person keeps saving with breaks under this.
create function public.page_history_session()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '10 minutes';
$$;

-- Old versions of a page go, the newest one stays.
create function public.prune_page_versions(target_page uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.page_versions v
  where v.page_id = target_page
    and v.created_at < now() - make_interval(days => public.page_history_days())
    and v.id <> (select n.id from public.page_versions n where n.page_id = target_page order by n.created_at desc, n.id desc limit 1);
$$;

revoke execute on function public.prune_page_versions(uuid) from public, anon, authenticated;

-- Every page at once (the nightly clean-up).
create function public.prune_all_page_versions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  gone integer;
begin
  delete from public.page_versions v
  where v.created_at < now() - make_interval(days => public.page_history_days())
    and v.id <> (select n.id from public.page_versions n where n.page_id = v.page_id order by n.created_at desc, n.id desc limit 1);
  get diagnostics gone = row_count;
  return gone;
end;
$$;

revoke execute on function public.prune_all_page_versions() from public, anon, authenticated;

-- Writes a version of the page as it is now: merged into the person's open session,
-- or a new one (another person, a pause of 10 minutes or more, or a special reason).
create function public.record_page_version(target public.pages, why text, actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  last public.page_versions;
begin
  select * into last from public.page_versions v where v.page_id = target.id order by v.created_at desc, v.id desc limit 1;
  if why = 'edit' and last.id is not null and last.reason = 'edit'
     and last.created_by is not distinct from actor and last.last_at > now() - public.page_history_session() then
    update public.page_versions
    set title = target.title, icon = target.icon, content = target.content, last_at = now()
    where id = last.id;
  else
    insert into public.page_versions (workspace_id, page_id, reason, title, icon, content, created_by,
                                      restored_from)
    values (target.workspace_id, target.id, why, target.title, target.icon, target.content, actor,
            nullif(current_setting('edgeknow.restored_from', true), '')::uuid);
    perform public.prune_page_versions(target.id);
  end if;
end;
$$;

revoke execute on function public.record_page_version(public.pages, text, uuid) from public, anon, authenticated;

-- Pages keep their history by themselves: a change of text, title or icon is an edit
-- (or a restore, when restore_page_version made it); publishing and a new
-- read-confirmation revision are marked as such.
create function public.track_page_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := coalesce(auth.uid(), new.updated_by);
begin
  -- The page as it was before its first recorded change (pages older than the history).
  if not exists (select 1 from public.page_versions v where v.page_id = new.id)
     and (old.content is distinct from new.content or old.title is distinct from new.title or old.icon is distinct from new.icon) then
    insert into public.page_versions (workspace_id, page_id, reason, title, icon, content, created_by, created_at, last_at)
    -- last_at in the far past: a session never merges into it.
    values (old.workspace_id, old.id, 'edit', old.title, old.icon, old.content, old.updated_by,
            least(old.updated_at, now() - interval '1 second'), '-infinity');
  end if;
  if old.published_at is null and new.published_at is not null then
    perform public.record_page_version(new, 'publish', actor);
  elsif new.ack_revision > old.ack_revision then
    perform public.record_page_version(new, 'ack_revision', actor);
  elsif old.content is distinct from new.content or old.title is distinct from new.title or old.icon is distinct from new.icon then
    perform public.record_page_version(new, case when current_setting('edgeknow.restored_from', true) <> '' then 'restore' else 'edit' end, actor);
  end if;
  return new;
end;
$$;

revoke execute on function public.track_page_version() from public, anon, authenticated;

create trigger pages_history after update of content, title, icon, published_at, ack_revision on public.pages
  for each row execute function public.track_page_version();

-- Puts a version back as the page's text (owner or editor). Not on a page in the
-- trash or frozen for read confirmations. Comments whose text is gone are marked
-- "fragment removed" (not deleted) and come back if the text returns.
create function public.restore_page_version(target_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.page_versions;
  p public.pages;
begin
  select * into v from public.page_versions where id = target_version;
  if v.id is null then
    return public.page_error('forbidden');
  end if;
  select * into p from public.pages where id = v.page_id;
  if p.id is null or not public.is_workspace_member(p.workspace_id) or not public.can_edit_page(p.id) then
    return public.page_error('forbidden');
  end if;
  if p.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if p.ack_label is not null and not p.ack_editing then
    return public.page_error('frozen');
  end if;

  perform set_config('edgeknow.restored_from', v.id::text, true);
  update public.pages
  set content = v.content, title = v.title, icon = v.icon,
      version = p.version + 1, updated_at = now(), updated_by = auth.uid()
  where id = p.id;
  perform set_config('edgeknow.restored_from', '', true);
  perform public.refresh_thread_status(p.id);
  return jsonb_build_object('ok', true, 'version', p.version + 1);
end;
$$;

revoke execute on function public.restore_page_version(uuid) from public, anon;
grant execute on function public.restore_page_version(uuid) to authenticated;

-- The nightly clean-up where the database has a scheduler.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('prune-page-versions', '23 4 * * *', 'select public.prune_all_page_versions()');
  end if;
end;
$$;
