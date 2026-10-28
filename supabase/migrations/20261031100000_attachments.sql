-- Stage 4: images in private storage, one folder per workspace, with a quota.
--
-- Flow: the browser compresses the image, asks register_attachment() for a
-- path (rights, type, size and quota are checked there), uploads the file to
-- that exact path (the storage policy only accepts registered paths) and
-- stores "ek-attachment:<path>" in the document. Reading needs a short-lived
-- signed URL, which the storage policy grants only to people who can see the page.
-- Rollback: supabase/rollbacks/20261031100000_attachments.down.sql

-------------------------------------------------------------------------------
-- Bucket
-------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 2097152,
        array['image/webp', 'image/jpeg', 'image/png', 'image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-------------------------------------------------------------------------------
-- Tables
-------------------------------------------------------------------------------

create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  page_id       uuid not null references public.pages (id) on delete cascade,
  -- <workspace_id>/<page_id>/<id>.<ext>
  storage_path  text not null unique,
  mime_type     text not null check (mime_type in ('image/webp', 'image/jpeg', 'image/png', 'image/gif')),
  bytes         integer not null check (bytes between 1 and 2097152),
  width         integer check (width > 0),
  height        integer check (height > 0),
  uploaded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index attachments_workspace_idx on public.attachments (workspace_id);
create index attachments_page_idx on public.attachments (page_id);

-- Files whose row is gone; a server job with the storage secret key deletes them.
create table public.attachment_tombstones (
  storage_path  text primary key,
  created_at    timestamptz not null default now()
);

alter table public.attachments enable row level security;
alter table public.attachment_tombstones enable row level security;
revoke all on public.attachments, public.attachment_tombstones from anon;
revoke insert, update, delete, truncate on public.attachments from authenticated;
revoke all on public.attachment_tombstones from authenticated;

create function public.remember_deleted_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attachment_tombstones (storage_path) values (old.storage_path)
  on conflict do nothing;
  return old;
end;
$$;

create trigger attachments_tombstone
  after delete on public.attachments
  for each row execute function public.remember_deleted_attachment();

-------------------------------------------------------------------------------
-- Registering an upload
-------------------------------------------------------------------------------

create function public.register_attachment(
  target_page uuid,
  file_type text,
  file_bytes integer,
  file_width integer,
  file_height integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  page record;
  used bigint;
  new_id uuid := gen_random_uuid();
  path text;
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  select p.workspace_id, p.deleted_at, w.storage_limit_mb into page
  from public.pages p join public.workspaces w on w.id = p.workspace_id
  where p.id = target_page;
  if page.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if file_type not in ('image/webp', 'image/jpeg', 'image/png', 'image/gif') then
    return public.page_error('unsupported_type');
  end if;
  if file_bytes is null or file_bytes < 1 or file_bytes > 2097152 then
    return public.page_error('too_large');
  end if;

  select coalesce(sum(bytes), 0) into used from public.attachments where workspace_id = page.workspace_id;
  if used + file_bytes > page.storage_limit_mb::bigint * 1048576 then
    return public.page_error('quota_exceeded');
  end if;

  path := page.workspace_id || '/' || target_page || '/' || new_id || '.' ||
    case file_type when 'image/webp' then 'webp' when 'image/jpeg' then 'jpg'
                   when 'image/png' then 'png' else 'gif' end;
  insert into public.attachments (id, workspace_id, page_id, storage_path, mime_type, bytes, width, height, uploaded_by)
  values (new_id, page.workspace_id, target_page, path, file_type, file_bytes,
          nullif(file_width, 0), nullif(file_height, 0), auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path);
end;
$$;

-- Daily: forget files no longer referenced by their page (kept one day for undo).
create function public.collect_unreferenced_attachments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.attachments a
  using public.pages p
  where p.id = a.page_id
    and a.created_at < now() - interval '1 day'
    and position(a.storage_path in coalesce(p.content::text, '')) = 0;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Usage per workspace for the platform statistics.
create or replace function public.platform_workspaces()
returns table (
  id uuid,
  short_id text,
  name text,
  owner_email text,
  members bigint,
  pages bigint,
  storage_bytes bigint,
  storage_limit_mb integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then
    return;
  end if;
  return query
    select
      w.id, w.short_id, w.name, o.email,
      (select count(*) from public.workspace_members m where m.workspace_id = w.id and m.status = 'active'),
      (select count(*) from public.pages p where p.workspace_id = w.id),
      (select coalesce(sum(a.bytes), 0)::bigint from public.attachments a where a.workspace_id = w.id),
      w.storage_limit_mb,
      w.created_at
    from public.workspaces w
    join public.profiles o on o.id = w.owner_id
    order by w.created_at;
end;
$$;

revoke execute on function
  public.remember_deleted_attachment(),
  public.register_attachment(uuid, text, integer, integer, integer),
  public.collect_unreferenced_attachments()
from public, anon, authenticated;
grant execute on function public.register_attachment(uuid, text, integer, integer, integer) to authenticated;
-- Storage policies below are evaluated as the caller.
grant execute on function public.can_edit_page(uuid) to authenticated;

-------------------------------------------------------------------------------
-- RLS: attachment records and the files themselves
-------------------------------------------------------------------------------

create policy "Members read attachments of pages they can see"
  on public.attachments for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.effective_role(page_id) is not null);

create policy "Upload only to a path registered by the uploader"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.attachments a
      where a.storage_path = storage.objects.name
        and a.uploaded_by = auth.uid()
        and a.created_at > now() - interval '1 hour'
        and public.can_edit_page(a.page_id)
    )
  );

create policy "Read files of pages you can see"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.attachments a
      where a.storage_path = storage.objects.name
        and public.is_workspace_member(a.workspace_id)
        and public.effective_role(a.page_id) is not null
    )
  );

create policy "Page owners and uploaders delete files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.attachments a
      where a.storage_path = storage.objects.name
        and (public.effective_role(a.page_id) = 'owner' or a.uploaded_by = auth.uid())
    )
  );

-------------------------------------------------------------------------------
-- Daily clean-up of unreferenced files (pg_cron on Supabase; skipped in plain Postgres).
-------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('collect-attachments', '37 3 * * *', 'select public.collect_unreferenced_attachments()');
  end if;
end;
$$;
