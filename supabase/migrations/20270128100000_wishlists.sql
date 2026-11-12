-- Wishlists (profile, step 2): a person's wishlist for their next birthday — wishes with
-- links and pictures and a page look of its own; a draft only its owner sees, published to
-- colleagues who see the birthday (decision 2026-11-12). A service object ("wishlists",
-- kind "wishlist"); pictures are object files.
-- The same in supabase/team/migrations/0072_wishlists.sql.
-- Rollback: supabase/rollbacks/20270128100000_wishlists.down.sql

alter table public.service_objects drop constraint service_objects_service_check;
alter table public.service_objects add constraint service_objects_service_check
  check (service in ('nodes', 'boards', 'sheets', 'slides', 'surveys', 'apps', 'wishlists'));

-- What a wishlist keeps: the birthday it is for, whether it is published, a greeting, the
-- page's look and up to 50 wishes (title, note, up to 3 http(s) links, a picture, a price).
create function public.wishlist_data_ok(content jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d jsonb := content -> 'design';
  p jsonb;
  item jsonb;
  link jsonb;
begin
  if jsonb_typeof(content) <> 'object'
     or coalesce(content ->> 'birthday', '') !~ '^\d{4}-\d{2}-\d{2}$'
     or jsonb_typeof(content -> 'published') is distinct from 'boolean'
     or char_length(coalesce(content ->> 'intro', '')) > 2000
     or jsonb_typeof(d) is distinct from 'object'
     or coalesce(d ->> 'gradient', '') not in ('aurora', 'sunset', 'ocean', 'candy', 'forest', 'dusk', 'peach', 'mint', 'galaxy', 'gold')
     or coalesce(d ->> 'accent', '') !~ '^#[0-9a-f]{6}$'
     or coalesce(d ->> 'effect', '') not in ('none', 'glass', 'glow', 'sparkles', 'confetti')
     or jsonb_typeof(content -> 'items') is distinct from 'array'
     or jsonb_array_length(content -> 'items') > 50 then
    return false;
  end if;
  p := d -> 'pattern';
  if p is not null and jsonb_typeof(p) <> 'null' then
    if jsonb_typeof(p) <> 'object' or char_length(coalesce(p ->> 'emoji', '')) not between 1 and 16
       or jsonb_typeof(p -> 'size') <> 'number' or (p ->> 'size')::numeric not between 16 and 96
       or jsonb_typeof(p -> 'density') <> 'number' or (p ->> 'density')::numeric not between 1 and 5
       or jsonb_typeof(p -> 'opacity') <> 'number' or (p ->> 'opacity')::numeric not between 0.02 and 0.4
       or jsonb_typeof(p -> 'angle') <> 'number' or (p ->> 'angle')::numeric not between -45 and 45 then
      return false;
    end if;
  end if;
  for item in select value from jsonb_array_elements(content -> 'items') loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item ->> 'id', '') !~ '^[a-z0-9-]{1,40}$'
       or char_length(btrim(coalesce(item ->> 'title', ''))) not between 1 and 200
       or char_length(coalesce(item ->> 'note', '')) > 1000
       or char_length(coalesce(item ->> 'price', '')) > 40
       or (item ? 'image' and jsonb_typeof(item -> 'image') <> 'null'
           and coalesce(item ->> 'image', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
       or jsonb_typeof(coalesce(item -> 'links', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(item -> 'links', '[]'::jsonb)) > 3 then
      return false;
    end if;
    for link in select value from jsonb_array_elements(coalesce(item -> 'links', '[]'::jsonb)) loop
      if jsonb_typeof(link) <> 'string' or char_length(link #>> '{}') > 2000 or (link #>> '{}') !~* '^https?://[^\s]+$' then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

-- Who may do what with a wishlist: its owner everything; a member (not a guest) views a
-- published one while the owner's birthday is shown to colleagues; nobody else — not even
-- the workspace's owner or admins — sees it, nor a draft.
create function public.wishlist_role_of(target_object uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when o.owner_id = member and public.is_active_member(o.workspace_id, member) and not public.is_guest(o.workspace_id, member) then 'owner'
    when coalesce((o.data ->> 'published')::boolean, false)
         and public.is_active_member(o.workspace_id, member) and not public.is_guest(o.workspace_id, member)
         and public.is_active_member(o.workspace_id, o.owner_id) and not public.is_guest(o.workspace_id, o.owner_id)
         and exists (select 1 from public.leave_member_settings s
                     where s.workspace_id = o.workspace_id and s.user_id = o.owner_id and s.birth_month is not null and s.birthday_shown)
         and coalesce((select c.show_birthdays from public.calendar_settings c where c.workspace_id = o.workspace_id), true) then 'viewer'
  end
  from public.service_objects o
  where o.id = target_object and o.service = 'wishlists' and o.deleted_at is null;
$$;

-- The person's next birthday (today counts), from the day and month they keep here.
-- 29 February falls on the 28th in other years.
create function public.next_birthday_of(ws uuid, person uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  with s as (select s.birth_month::int as m, s.birth_day::int as d from public.leave_member_settings s
             where s.workspace_id = ws and s.user_id = person and s.birth_month is not null),
  t as (select public.workspace_today(ws) as today),
  y as (select extract(year from t.today)::int + k as y from t, generate_series(0, 1) k),
  days as (select make_date(y.y, s.m, case when s.m = 2 and s.d = 29 and not (y.y % 4 = 0 and (y.y % 100 <> 0 or y.y % 400 = 0)) then 28 else s.d end) as day
           from s, y)
  select min(days.day) from days, t where days.day >= t.today;
$$;

-- A new wishlist (a draft) for one's next birthday; one per birthday.
create function public.create_wishlist(ws uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  day date;
  existing uuid;
  new_id uuid;
  content jsonb;
begin
  if me is null or not public.is_workspace_member(ws) or public.is_guest(ws, me) then
    return public.page_error('forbidden');
  end if;
  day := public.next_birthday_of(ws, me);
  if day is null then
    return public.page_error('no_birthday');
  end if;
  select o.id into existing from public.service_objects o
  where o.workspace_id = ws and o.service = 'wishlists' and o.owner_id = me and o.deleted_at is null and o.data ->> 'birthday' = day::text;
  if existing is not null then
    return jsonb_build_object('ok', false, 'error', 'exists', 'id', existing);
  end if;
  if (select count(*) from public.service_objects o where o.workspace_id = ws and o.service = 'wishlists' and o.owner_id = me) >= 50 then
    return public.page_error('too_many');
  end if;
  content := jsonb_build_object('birthday', day::text, 'published', false, 'intro', '',
    'design', jsonb_build_object('gradient', 'aurora', 'accent', '#7c3aed', 'effect', 'glass',
                                 'pattern', jsonb_build_object('emoji', '🎁', 'size', 32, 'density', 3, 'opacity', 0.12, 'angle', -15)),
    'items', '[]'::jsonb);
  insert into public.service_objects (workspace_id, service, kind, title, data, search_text, owner_id, created_by, updated_by)
  values (ws, 'wishlists', 'wishlist', '', content, '', me, me, me)
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'birthday', day);
end;
$$;

-- A copy of one's own wishlist (wishes and look, not the pictures — the server copies
-- those) as a draft for the next birthday.
create function public.copy_wishlist(source uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  original public.service_objects;
  day date;
  existing uuid;
  new_id uuid;
begin
  select * into original from public.service_objects o where o.id = source and o.service = 'wishlists' and o.deleted_at is null;
  if not found or public.wishlist_role_of(source, me) is distinct from 'owner' then
    return public.page_error('forbidden');
  end if;
  day := public.next_birthday_of(original.workspace_id, me);
  if day is null then
    return public.page_error('no_birthday');
  end if;
  select o.id into existing from public.service_objects o
  where o.workspace_id = original.workspace_id and o.service = 'wishlists' and o.owner_id = me and o.deleted_at is null and o.data ->> 'birthday' = day::text;
  if existing is not null then
    return jsonb_build_object('ok', false, 'error', 'exists', 'id', existing);
  end if;
  insert into public.service_objects (workspace_id, service, kind, title, data, search_text, owner_id, created_by, updated_by)
  values (original.workspace_id, 'wishlists', 'wishlist', original.title,
          original.data || jsonb_build_object('birthday', day::text, 'published', false),
          original.search_text, me, me, me)
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'birthday', day);
end;
$$;

-- The owner publishes a wishlist (colleagues see it) or takes it back to a draft.
create function public.set_wishlist_published(target uuid, published boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.wishlist_role_of(target, auth.uid()) is distinct from 'owner' or published is null then
    return public.page_error('forbidden');
  end if;
  update public.service_objects
  set data = data || jsonb_build_object('published', published), version = version + 1, updated_at = now(), updated_by = auth.uid()
  where id = target;
  return jsonb_build_object('ok', true);
end;
$$;

-- The owner deletes a wishlist for good, pictures included (they go with the daily cleanup).
create function public.delete_wishlist(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.wishlist_role_of(target, auth.uid()) is distinct from 'owner' then
    return public.page_error('forbidden');
  end if;
  delete from public.service_objects where id = target;
  return jsonb_build_object('ok', true);
end;
$$;

-- One wishlist per person and birthday.
create unique index service_objects_wishlist_once on public.service_objects (workspace_id, owner_id, (data ->> 'birthday'))
  where service = 'wishlists' and deleted_at is null;

revoke execute on function public.wishlist_data_ok(jsonb), public.wishlist_role_of(uuid, uuid), public.next_birthday_of(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function
  public.create_wishlist(uuid), public.copy_wishlist(uuid), public.set_wishlist_published(uuid, boolean), public.delete_wishlist(uuid)
from public, anon;
grant execute on function
  public.create_wishlist(uuid), public.copy_wishlist(uuid), public.set_wishlist_published(uuid, boolean), public.delete_wishlist(uuid)
to authenticated;

create or replace function public.service_object_text(content jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(coalesce(string_agg(value #>> '{}', ' '), ''), 20000)
  from (
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.nodes[*].text') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.slides[*].nodes[*].text') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.pages[*].nodes[*].text') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.nodes[*].title') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.nodes[*].description') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.edges[*].label') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.elements[*] ? (!(@.isDeleted == true)).text') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.elements[*] ? (!(@.isDeleted == true)).name') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sheets[*].name') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sheets[*].celldata[*].v.m') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.description') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sections[*].title') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sections[*].questions[*].title') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sections[*].questions[*].options[*].label') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.category') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.items[*].title') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.intro') value
  ) parts
  where jsonb_typeof(value) = 'string' and value #>> '{}' <> '';
$$;

create or replace function public.service_object_role_of(target_object uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- Wishlists have their own rule (owner; colleagues see a published one), no grants.
  select case when o.service = 'wishlists' then public.wishlist_role_of(target_object, member)
  else (
  with object as (select * from public.service_objects o where o.id = target_object),
  guest as (select public.is_guest((select o.workspace_id from object o), member) as yes),
  candidates as (
    select 'owner' as role from object o where o.owner_id = member and public.is_active_member(o.workspace_id, member)
    union all
    select 'owner' from object o
    join public.workspace_members m on m.workspace_id = o.workspace_id and m.user_id = member and m.status = 'active'
    where m.role in ('owner', 'admin')
    union all
    select public.capped_role(o.workspace_id, member, o.workspace_role) from object o, guest g
    where o.workspace_role is not null and not g.yes and public.is_active_member(o.workspace_id, member)
    union all
    select case when g.yes and a.role = 'owner' then 'editor' else a.role end
    from public.service_object_access a, guest g where a.object_id = target_object and a.user_id = member
    union all
    select ga.role from public.service_object_group_access ga
    -- Company structure, stage 3: a unit's grant reaches its sub-units and the leads above it.
    join lateral (select 1 where public.unit_reaches(ga.group_id, member)) gm on true
    cross join guest g
    where ga.object_id = target_object and not g.yes
  )
  -- Company apps (Obriy): only the workspace's owner and admins manage them; anyone else at most views.
  select case
           when o.service = 'apps' and best.role <> 'viewer' and not exists (
             select 1 from public.workspace_members m
             where m.workspace_id = o.workspace_id and m.user_id = member and m.status = 'active' and m.role in ('owner', 'admin'))
           then 'viewer'
           else best.role
         end
  from (select role from candidates where role is not null order by public.role_rank(role) desc limit 1) best, object o
  ) end
  from public.service_objects o where o.id = target_object;
$$;

create or replace function public.create_service_object(ws uuid, target_service text, new_kind text, new_title text, new_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  guest boolean := public.is_guest(ws, auth.uid());
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  -- Custom roles (company structure, stage 2) may take this right away; guests keep their own rules.
  if not guest and not public.role_allows(ws, 'create_objects') then
    return public.page_error('forbidden');
  end if;
  -- "Own database first": as for pages.
  if not public.central_pages_allowed(ws) then
    return public.page_error('team_database_required');
  end if;
  -- Company apps (Obriy): only the workspace's owner and admins add them.
  if target_service = 'apps' and not public.is_workspace_admin(ws) then
    return public.page_error('forbidden');
  end if;
  -- Wishlists are made only by create_wishlist (for one's own next birthday).
  if target_service = 'wishlists' then
    return public.page_error('forbidden');
  end if;
  if not ((target_service = 'nodes' and new_kind in ('mindmap', 'flow')) or (target_service = 'boards' and new_kind in ('board', 'design'))
          or (target_service = 'sheets' and new_kind = 'sheet') or (target_service = 'surveys' and new_kind = 'survey')
          or (target_service = 'slides' and new_kind = 'deck')
          or (target_service = 'apps' and new_kind = 'app' and public.app_data_ok(new_data))) then
    return public.page_error('invalid');
  end if;
  if char_length(coalesce(new_title, '')) > 200 then
    return public.page_error('title_too_long');
  end if;
  if pg_column_size(coalesce(new_data, '{}'::jsonb)) > 1048576 then
    return public.page_error('too_large');
  end if;
  if (select count(*) from public.service_objects o where o.workspace_id = ws and o.deleted_at is null) >= 5000 then
    return public.page_error('too_many');
  end if;
  insert into public.service_objects (workspace_id, service, kind, title, data, search_text, owner_id, created_by, updated_by, workspace_role)
  values (ws, target_service, new_kind, btrim(coalesce(new_title, '')), coalesce(new_data, '{}'::jsonb),
          public.service_object_text(new_data), case when guest then public.workspace_owner_of(ws) else auth.uid() end, auth.uid(), auth.uid(),
          case when target_service in ('surveys', 'apps') then 'viewer' else 'editor' end)
  returning id into new_id;
  -- A guest's map or board belongs to the workspace owner; the guest edits it.
  if guest then
    insert into public.service_object_access (object_id, workspace_id, user_id, role, granted_by)
    values (new_id, ws, auth.uid(), 'editor', auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'id', new_id, 'version', 1);
end;
$$;

create or replace function public.register_object_file(target_object uuid, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  object public.service_objects;
  new_id uuid := gen_random_uuid();
  path text;
begin
  select * into object from public.service_objects where id = target_object;
  if not found or object.deleted_at is not null or object.service not in ('boards', 'slides', 'apps', 'wishlists')
     or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp') then
    return public.page_error('invalid_file');
  end if;
  -- A company app's logo: one small picture, 2 MB at most.
  if object.service = 'apps' and file_bytes > 2097152 then
    return public.page_error('too_large');
  end if;
  if (select count(*) from public.object_files f where f.object_id = target_object) >= 500 then
    return public.page_error('too_many_files');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images and task files count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = object.workspace_id and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = object.workspace_id and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = object.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = object.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = object.workspace_id) then
    return public.page_error('quota_exceeded');
  end if;
  path := object.workspace_id || '/objects/' || target_object || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, object.workspace_id, target_object, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', object.workspace_id);
end;
$$;

create or replace function public.save_service_object(target_object uuid, new_title text, new_data jsonb, base_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  object public.service_objects;
begin
  select * into object from public.service_objects where id = target_object;
  if not found or object.deleted_at is not null or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if char_length(coalesce(new_title, object.title)) > 200 then
    return public.page_error('title_too_long');
  end if;
  if new_data is not null and pg_column_size(new_data) > 1048576 then
    return public.page_error('too_large');
  end if;
  if object.service = 'apps' and new_data is not null and not public.app_data_ok(new_data) then
    return public.page_error('invalid');
  end if;
  -- A wishlist keeps its birthday and publication (changed by their own functions).
  if object.service = 'wishlists' and new_data is not null then
    new_data := new_data || jsonb_build_object('birthday', object.data -> 'birthday', 'published', coalesce(object.data -> 'published', 'false'::jsonb));
    if not public.wishlist_data_ok(new_data) then
      return public.page_error('invalid');
    end if;
  end if;
  if base_version is distinct from object.version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'version', object.version);
  end if;
  update public.service_objects set
    title = coalesce(btrim(new_title), title),
    data = coalesce(new_data, data),
    search_text = case when new_data is not null then public.service_object_text(new_data) else search_text end,
    version = version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  where id = target_object;
  -- Pictures no wish uses any more (and older than an hour, so a fresh upload is safe) go.
  if object.service = 'wishlists' and new_data is not null then
    delete from public.object_files f where f.object_id = target_object and f.created_at < now() - interval '1 hour'
      and not exists (select 1 from jsonb_array_elements(new_data -> 'items') i where i ->> 'image' = f.id::text);
  end if;
  return jsonb_build_object('ok', true, 'version', object.version + 1);
end;
$$;
