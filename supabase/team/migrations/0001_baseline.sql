-- Team database baseline (path C): the central schema as of migration
-- 20261108100000_profile_stats, dumped with pg_dump --schema-only --schema=public.
-- Generated, not edited by hand: changes go into later team migrations.
-- 0002_team_adapter.sql removes what belongs only to the central service.
--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


--
-- Name: access_chain(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.access_chain(target_page uuid) RETURNS TABLE(id uuid, depth integer, owner_id uuid, workspace_role text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with recursive chain as (
    select p.id, p.parent_id, p.inherit, p.owner_id, p.workspace_role, 0 as depth
    from public.pages p
    where p.id = target_page
    union all
    select pp.id, pp.parent_id, pp.inherit, pp.owner_id, pp.workspace_role, c.depth + 1
    from chain c
    join public.pages pp on pp.id = c.parent_id
    where c.inherit and c.depth < 100
  )
  select chain.id, chain.depth, chain.owner_id, chain.workspace_role from chain;
$$;


--
-- Name: add_workspace_domain(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_workspace_domain(ws uuid, new_domain text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  normalized text := lower(trim(coalesce(new_domain, '')));
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'add_domain', 'domain', normalized));
    return public.ws_error('forbidden');
  end if;
  if not public.is_valid_domain(normalized) then
    return public.ws_error('invalid_domain');
  end if;
  if exists (select 1 from public.public_email_domains where domain = normalized) then
    return public.ws_error('public_domain');
  end if;
  if normalized <> public.email_domain(public.current_email()) then
    return public.ws_error('domain_mismatch');
  end if;
  if exists (select 1 from public.workspace_domains where domain = normalized) then
    return public.ws_error('domain_taken');
  end if;

  insert into public.workspace_domains (domain, workspace_id, verified, added_by)
  values (normalized, ws, true, auth.uid());
  perform public.log_workspace_action(ws, 'domain_added', jsonb_build_object('domain', normalized));
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: admin_keeps_access_without(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_keeps_access_without(ws uuid, changed_domain text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = ws
      and m.status = 'active'
      and m.role in ('owner', 'admin')
      and (
        m.joined_via <> 'domain'
        or exists (
          select 1 from public.workspace_domains d
          where d.workspace_id = ws and d.is_active
            and d.domain = public.email_domain(p.email)
            and d.domain <> changed_domain
        )
      )
  );
$$;


--
-- Name: can_comment_page(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_comment_page(target_page uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(public.effective_role(target_page) in ('owner', 'editor', 'commenter'), false);
$$;


--
-- Name: can_edit_page(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_page(target_page uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(public.effective_role(target_page) in ('owner', 'editor'), false);
$$;


--
-- Name: check_comment_workspace(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_comment_workspace() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.workspace_id is distinct from (select t.workspace_id from public.comment_threads t where t.id = new.thread_id) then
    raise exception 'comment and thread must be in the same workspace';
  end if;
  return new;
end;
$$;


--
-- Name: check_page_access_workspace(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_page_access_workspace() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.workspace_id is distinct from (select p.workspace_id from public.pages p where p.id = new.page_id) then
    raise exception 'grant and page must be in the same workspace';
  end if;
  return new;
end;
$$;


--
-- Name: check_page_workspace(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_page_workspace() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.parent_id is not null and new.workspace_id is distinct from (
    select p.workspace_id from public.pages p where p.id = new.parent_id
  ) then
    raise exception 'page and parent must be in the same workspace';
  end if;
  return new;
end;
$$;


--
-- Name: check_thread_workspace(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_thread_workspace() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.workspace_id is distinct from (select p.workspace_id from public.pages p where p.id = new.page_id) then
    raise exception 'thread and page must be in the same workspace';
  end if;
  return new;
end;
$$;


--
-- Name: clean_cover(jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clean_cover(raw jsonb, target_page uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  kind text := raw ->> 'type';
  hex constant text := '^#[0-9a-fA-F]{6}$';
  url text;
  page public.pages;
  stops jsonb;
begin
  if jsonb_typeof(raw) is distinct from 'object' then
    return null;
  end if;
  select * into page from public.pages where id = target_page;

  if kind = 'color' then
    if coalesce(raw ->> 'color', '') !~ hex then return null; end if;
    return jsonb_build_object('type', 'color', 'color', lower(raw ->> 'color'));
  end if;

  if kind = 'gradient' then
    if jsonb_typeof(raw -> 'stops') <> 'array' or jsonb_array_length(raw -> 'stops') not between 2 and 4 then
      return null;
    end if;
    if exists (
      select 1 from jsonb_array_elements(raw -> 'stops') s
      where coalesce(s ->> 'color', '') !~ hex or jsonb_typeof(s -> 'at') <> 'number'
    ) then
      return null;
    end if;
    select jsonb_agg(jsonb_build_object(
             'color', lower(s ->> 'color'),
             'at', greatest(0, least(100, round((s ->> 'at')::numeric)))::integer
           ) order by (s ->> 'at')::numeric)
      into stops
    from jsonb_array_elements(raw -> 'stops') s;
    return jsonb_build_object(
      'type', 'gradient',
      'kind', case when raw ->> 'kind' = 'radial' then 'radial' else 'linear' end,
      'angle', case when jsonb_typeof(raw -> 'angle') = 'number'
                    then (round((raw ->> 'angle')::numeric)::integer % 360 + 360) % 360 else 90 end,
      'stops', stops
    );
  end if;

  if kind = 'image' then
    url := coalesce(raw ->> 'url', '');
    if url like 'ek-attachment:%' then
      -- Our own file: it must be a registered upload of this very page.
      if not exists (
        select 1 from public.attachments a
        where a.storage_path = substr(url, length('ek-attachment:') + 1)
          and a.page_id = target_page and a.workspace_id = page.workspace_id
      ) then
        return null;
      end if;
    elsif char_length(url) > 2000 or url !~ '^https://[^\s"''<>()\\]+$' then
      return null;
    end if;
    return jsonb_build_object(
      'type', 'image',
      'url', url,
      'y', case when jsonb_typeof(raw -> 'y') = 'number'
                then greatest(0, least(100, round((raw ->> 'y')::numeric)))::integer else 50 end
    );
  end if;

  return null;
end;
$_$;


--
-- Name: clean_mentions(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clean_mentions(target_page uuid, mention_ids uuid[]) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(array_agg(distinct m), '{}')
  from unnest(coalesce(mention_ids, '{}')) m
  join public.pages p on p.id = target_page
  where m <> auth.uid()
    and public.is_active_member(p.workspace_id, m)
    and public.page_role_of(target_page, m) is not null;
$$;


--
-- Name: collect_unreferenced_attachments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.collect_unreferenced_attachments() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  removed integer;
begin
  delete from public.attachments a
  using public.pages p
  where p.id = a.page_id
    and a.created_at < now() - interval '1 day'
    and position(a.storage_path in coalesce(p.content::text, '')) = 0
    and position(a.storage_path in coalesce(p.cover::text, '')) = 0;
  get diagnostics removed = row_count;
  return removed;
end;
$$;


--
-- Name: create_comment_thread(uuid, text, text, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_comment_thread(target_page uuid, quoted text, body text, mention_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  ws uuid;
  new_thread uuid;
  new_comment uuid;
  cleaned text := trim(coalesce(body, ''));
begin
  if not public.can_comment_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.pages where id = target_page and deleted_at is not null) then
    return public.page_error('in_trash');
  end if;
  if char_length(cleaned) not between 1 and 5000 then
    return public.page_error('invalid_comment');
  end if;

  select workspace_id into ws from public.pages where id = target_page;
  insert into public.comment_threads (workspace_id, page_id, quoted_text, created_by)
  values (ws, target_page, left(trim(coalesce(quoted, '')), 1000), auth.uid())
  returning id into new_thread;
  insert into public.comments (workspace_id, thread_id, author_id, body, mentions)
  values (ws, new_thread, auth.uid(), cleaned, public.clean_mentions(target_page, mention_ids))
  returning id into new_comment;
  return jsonb_build_object('ok', true, 'id', new_thread, 'comment_id', new_comment);
end;
$$;


--
-- Name: create_marked_comment_thread(uuid, integer, jsonb, text, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_marked_comment_thread(target_page uuid, base_version integer, ranges jsonb, body text, mention_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current record;
  cleaned text := trim(coalesce(body, ''));
  new_thread uuid := gen_random_uuid();
  marked jsonb;
  quoted text;
begin
  if not public.can_comment_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if char_length(cleaned) not between 1 and 5000 then
    return public.page_error('invalid_comment');
  end if;
  if jsonb_typeof(ranges) is distinct from 'array' or jsonb_array_length(ranges) not between 1 and 200
     or exists (
       select 1 from jsonb_array_elements(ranges) x
       where jsonb_typeof(x -> 'start') <> 'number' or jsonb_typeof(x -> 'end') <> 'number'
          or (x ->> 'start')::integer < 0 or (x ->> 'end')::integer <= (x ->> 'start')::integer
          or jsonb_typeof(x -> 'block') <> 'string'
     ) then
    return public.page_error('invalid_range');
  end if;

  select p.workspace_id, p.content, p.version, p.deleted_at into current
  from public.pages p where p.id = target_page
  for update;

  if current.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if current.version <> base_version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'version', current.version);
  end if;

  marked := public.mark_blocks(current.content, ranges, new_thread::text);
  if (marked ->> 'applied')::integer <> jsonb_array_length(ranges) or (marked ->> 'mismatch')::boolean then
    return public.page_error('invalid_range');
  end if;
  if octet_length((marked -> 'blocks')::text) > public.page_content_limit() then
    return public.page_error('too_large');
  end if;
  quoted := array_to_string(array(select jsonb_array_elements_text(marked -> 'texts')), ' ');

  update public.pages
  set content = marked -> 'blocks', version = current.version + 1, updated_at = now(), updated_by = auth.uid()
  where id = target_page;

  insert into public.comment_threads (id, workspace_id, page_id, quoted_text, created_by)
  values (new_thread, current.workspace_id, target_page, left(quoted, 1000), auth.uid());
  insert into public.comments (workspace_id, thread_id, author_id, body, mentions)
  values (current.workspace_id, new_thread, auth.uid(), cleaned, public.clean_mentions(target_page, mention_ids));
  return jsonb_build_object('ok', true, 'id', new_thread, 'version', current.version + 1);
end;
$$;


--
-- Name: create_page(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_page(ws uuid, parent uuid, new_title text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  new_id uuid;
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;

  if parent is not null then
    if not public.can_edit_page(parent)
       or (select workspace_id from public.pages where id = parent) <> ws then
      return public.page_error('forbidden');
    end if;
    if exists (select 1 from public.pages where id = parent and deleted_at is not null) then
      return public.page_error('in_trash');
    end if;
  end if;

  if char_length(coalesce(new_title, '')) > 200 then
    return public.page_error('title_too_long');
  end if;

  insert into public.pages (workspace_id, parent_id, owner_id, created_by, title, updated_by)
  values (ws, parent, auth.uid(), auth.uid(), trim(coalesce(new_title, '')), auth.uid())
  returning id into new_id;

  perform public.place_page(new_id, parent, null);
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;


--
-- Name: create_workspace(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_workspace(new_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  cleaned text := trim(coalesce(new_name, ''));
  ws public.workspaces;
begin
  if not public.has_platform_access() then
    return public.ws_error('forbidden');
  end if;
  if char_length(cleaned) not between 1 and 80 then
    return public.ws_error('invalid_name');
  end if;

  insert into public.workspaces (name, owner_id, created_by)
  values (cleaned, auth.uid(), auth.uid())
  returning * into ws;

  insert into public.workspace_members (workspace_id, user_id, role, joined_via)
  values (ws.id, auth.uid(), 'owner', 'creator');

  perform public.log_workspace_action(ws.id, 'workspace_created', jsonb_build_object('name', cleaned));
  perform public.log_workspace_action(null, 'workspace_created',
    jsonb_build_object('workspace_id', ws.id, 'name', cleaned));
  return jsonb_build_object('ok', true, 'id', ws.id, 'short_id', ws.short_id);
end;
$$;


--
-- Name: current_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_email() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;


--
-- Name: delete_comment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_comment(target_comment uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  thread uuid;
  page uuid;
begin
  select c.thread_id, t.page_id into thread, page
  from public.comments c join public.comment_threads t on t.id = c.thread_id
  where c.id = target_comment and c.author_id = auth.uid();
  if thread is null or public.effective_role(page) is null then
    return public.page_error('forbidden');
  end if;
  delete from public.comments where id = target_comment;
  if not exists (select 1 from public.comments where thread_id = thread) then
    delete from public.comment_threads where id = thread;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: delete_page_forever(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_page_forever(target_page uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if not exists (select 1 from public.pages where id = target_page and trashed_with = id) then
    return public.page_error('not_in_trash');
  end if;

  -- Children go with it through ON DELETE CASCADE.
  delete from public.pages where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: delete_workspace(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_workspace(ws uuid, confirm_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  ws_name text;
begin
  if coalesce(public.workspace_role(ws), '') <> 'owner' then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'delete_workspace'));
    return public.ws_error('forbidden');
  end if;

  select name into ws_name from public.workspaces where id = ws;
  if trim(coalesce(confirm_name, '')) <> ws_name then
    return public.ws_error('name_mismatch');
  end if;

  perform public.log_workspace_action(null, 'workspace_deleted',
    jsonb_build_object('workspace_id', ws, 'name', ws_name));
  -- Pages, members, domains, invitations and the workspace log go with it (ON DELETE CASCADE).
  delete from public.workspaces where id = ws;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: departed_page_owners(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.departed_page_owners(ws uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_workspace_admin(ws) then
    return public.page_error('forbidden');
  end if;
  return jsonb_build_object('ok', true, 'owners', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', x.owner_id, 'name', x.name, 'email', x.email, 'pages', x.pages)
             order by x.email)
    from (
      select p.owner_id, pr.name, pr.email, count(*) as pages
      from public.pages p
      join public.profiles pr on pr.id = p.owner_id
      where p.workspace_id = ws and not public.is_active_member(ws, p.owner_id)
      group by p.owner_id, pr.name, pr.email
    ) x
  ), '[]'::jsonb));
end;
$$;


--
-- Name: drop_grants_of_removed_member(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.drop_grants_of_removed_member() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.status <> 'active' then
    delete from public.page_access where workspace_id = new.workspace_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;


--
-- Name: edit_comment(uuid, text, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.edit_comment(target_comment uuid, body text, mention_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  page uuid;
  cleaned text := trim(coalesce(body, ''));
begin
  select t.page_id into page
  from public.comments c join public.comment_threads t on t.id = c.thread_id
  where c.id = target_comment and c.author_id = auth.uid();
  if page is null or not public.can_comment_page(page) then
    return public.page_error('forbidden');
  end if;
  if char_length(cleaned) not between 1 and 5000 then
    return public.page_error('invalid_comment');
  end if;
  update public.comments
  set body = cleaned, mentions = public.clean_mentions(page, mention_ids), edited_at = now()
  where id = target_comment;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: effective_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.effective_role(target_page uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select public.page_role_of(p.id, auth.uid())
  from public.pages p
  where p.id = target_page and public.is_workspace_member(p.workspace_id);
$$;


--
-- Name: email_domain(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.email_domain(email text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select lower(split_part(coalesce(email, ''), '@', 2));
$$;


--
-- Name: generate_short_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_short_id() RETURNS text
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select substr(md5(gen_random_uuid()::text), 1, 8);
$$;


--
-- Name: has_platform_access(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_platform_access() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select public.current_email() is not null and (
    exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid() and public.is_workspace_member(m.workspace_id)
    )
    or (select open_registration from public.platform_settings)
  );
$$;


--
-- Name: hash_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hash_token(token text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select encode(sha256(convert_to(token, 'UTF8')), 'hex');
$$;


--
-- Name: hook_before_user_created(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hook_before_user_created(event jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  user_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
  user_domain text := public.email_domain(user_email);
begin
  if user_email <> '' and (
    exists (
      select 1 from public.workspace_domains d where d.domain = user_domain and d.is_active
    )
    or exists (
      select 1 from public.invitations i
      where i.email = user_email
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    )
    or (select open_registration from public.platform_settings)
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'domain_not_allowed')
  );
end;
$$;


--
-- Name: invitation_preview(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invitation_preview(token text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'workspace', w.name,
    'workspace_short_id', w.short_id,
    'email', i.email,
    'valid', i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  )
  from public.invitations i
  join public.workspaces w on w.id = i.workspace_id
  where i.token_hash = public.hash_token(token);
$$;


--
-- Name: invite_member(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invite_member(ws uuid, invitee_email text, invitee_role text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  normalized text := lower(trim(coalesce(invitee_email, '')));
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  invitation_id uuid;
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'invite_member', 'email', normalized));
    return public.ws_error('forbidden');
  end if;
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return public.ws_error('invalid_email');
  end if;
  if coalesce(invitee_role, '') not in ('admin', 'member') then
    return public.ws_error('invalid_role');
  end if;
  if exists (
    select 1 from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = ws and p.email = normalized and m.status = 'active'
      and m.joined_via <> 'domain'
  ) then
    return public.ws_error('already_member');
  end if;

  -- A new link replaces any earlier pending one for the same person.
  update public.invitations
  set revoked_at = now()
  where workspace_id = ws and email = normalized and accepted_at is null and revoked_at is null;

  insert into public.invitations (workspace_id, email, role, token_hash, invited_by)
  values (ws, normalized, invitee_role, public.hash_token(token), auth.uid())
  returning id into invitation_id;

  perform public.log_workspace_action(ws, 'member_invited',
    jsonb_build_object('email', normalized, 'role', invitee_role));
  return jsonb_build_object('ok', true, 'id', invitation_id, 'token', token);
end;
$_$;


--
-- Name: is_active_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_active_member(ws uuid, member uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = member and m.status = 'active'
  );
$$;


--
-- Name: is_platform_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_platform_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select public.current_email() is not null
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_platform_admin);
$$;


--
-- Name: is_valid_domain(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_valid_domain(value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $_$
  select value ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$';
$_$;


--
-- Name: is_workspace_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_workspace_admin(ws uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(public.workspace_role(ws) in ('owner', 'admin'), false);
$$;


--
-- Name: is_workspace_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_workspace_member(ws uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.status = 'active'
      and public.current_email() is not null
      and (
        m.joined_via <> 'domain'
        or exists (
          select 1 from public.workspace_domains d
          where d.workspace_id = ws
            and d.is_active
            and d.domain = public.email_domain(public.current_email())
        )
      )
  );
$$;


--
-- Name: join_workspaces(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_workspaces() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  my_email text := public.current_email();
  invite record;
begin
  if my_email is null then
    return public.ws_error('forbidden');
  end if;

  -- Automatic joining by domain; people removed by an admin are not re-added.
  insert into public.workspace_members (workspace_id, user_id, role, joined_via)
  select d.workspace_id, auth.uid(), 'member', 'domain'
  from public.workspace_domains d
  where d.domain = public.email_domain(my_email) and d.is_active
  on conflict (workspace_id, user_id) do nothing;

  -- Invitations (also bring back a removed member, and outrank a domain join).
  for invite in
    select * from public.invitations i
    where i.email = my_email
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  loop
    insert into public.workspace_members as m (workspace_id, user_id, role, joined_via)
    values (invite.workspace_id, auth.uid(), invite.role, 'invite')
    on conflict (workspace_id, user_id) do update
      set status = 'active',
          joined_via = case when m.joined_via = 'creator' then 'creator' else 'invite' end,
          role = case
            when m.role = 'owner' then 'owner'
            when m.status = 'removed' then excluded.role
            when excluded.role = 'admin' then 'admin'
            else m.role
          end;

    update public.invitations
    set accepted_at = now(), accepted_by = auth.uid()
    where id = invite.id;

    perform public.log_workspace_action(invite.workspace_id, 'invitation_accepted',
      jsonb_build_object('email', my_email));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'workspaces', coalesce((
      select jsonb_agg(w.short_id order by w.created_at)
      from public.workspaces w
      where public.is_workspace_member(w.id)
    ), '[]'::jsonb)
  );
end;
$$;


--
-- Name: log_workspace_action(uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_workspace_action(ws uuid, action text, details jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  insert into public.audit_log (workspace_id, actor_id, action, details)
  values (ws, auth.uid(), action, coalesce(details, '{}'::jsonb));
$$;


--
-- Name: mark_blocks(jsonb, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_blocks(blocks jsonb, ranges jsonb, thread text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  result jsonb := '[]'::jsonb;
  block jsonb;
  r jsonb;
  marked jsonb;
  sub jsonb;
  applied integer := 0;
  mismatch boolean := false;
  texts text[] := '{}';
begin
  for block in select value from jsonb_array_elements(coalesce(blocks, '[]'::jsonb)) loop
    select x into r from jsonb_array_elements(ranges) x where x ->> 'block' = block ->> 'id' limit 1;
    if r is not null and jsonb_typeof(block -> 'content') = 'array' then
      marked := public.mark_inline(block -> 'content', (r ->> 'start')::integer, (r ->> 'end')::integer, thread);
      if (marked ->> 'text') is distinct from (r ->> 'text') or (marked ->> 'text') = '' then
        mismatch := true;
      end if;
      block := jsonb_set(block, '{content}', marked -> 'nodes');
      applied := applied + 1;
      texts := texts || (marked ->> 'text');
    end if;
    if jsonb_typeof(block -> 'children') = 'array' and jsonb_array_length(block -> 'children') > 0 then
      sub := public.mark_blocks(block -> 'children', ranges, thread);
      block := jsonb_set(block, '{children}', sub -> 'blocks');
      applied := applied + (sub ->> 'applied')::integer;
      mismatch := mismatch or (sub ->> 'mismatch')::boolean;
      texts := texts || array(select jsonb_array_elements_text(sub -> 'texts'));
    end if;
    result := result || jsonb_build_array(block);
  end loop;
  return jsonb_build_object('blocks', result, 'applied', applied, 'mismatch', mismatch, 'texts', to_jsonb(texts));
end;
$$;


--
-- Name: mark_inline(jsonb, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_inline(nodes jsonb, start_pos integer, end_pos integer, thread text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  result jsonb := '[]'::jsonb;
  covered text := '';
  pos integer := 0;
  node jsonb;
  piece text;
  len integer;
  s integer;
  e integer;
  inner_result jsonb;
begin
  for node in select value from jsonb_array_elements(coalesce(nodes, '[]'::jsonb)) loop
    if node ->> 'type' = 'text' then
      piece := coalesce(node ->> 'text', '');
      len := char_length(piece);
      s := greatest(start_pos - pos, 0);
      e := least(end_pos - pos, len);
      if s >= e then
        result := result || jsonb_build_array(node);
      else
        if s > 0 then
          result := result || jsonb_build_array(jsonb_set(node, '{text}', to_jsonb(substr(piece, 1, s))));
        end if;
        result := result || jsonb_build_array(
          jsonb_set(
            jsonb_set(node, '{text}', to_jsonb(substr(piece, s + 1, e - s))),
            '{styles}', coalesce(node -> 'styles', '{}'::jsonb) || jsonb_build_object('comment', thread)
          )
        );
        covered := covered || substr(piece, s + 1, e - s);
        if e < len then
          result := result || jsonb_build_array(jsonb_set(node, '{text}', to_jsonb(substr(piece, e + 1))));
        end if;
      end if;
      pos := pos + len;
    elsif node ->> 'type' = 'link' then
      inner_result := public.mark_inline(node -> 'content', start_pos - pos, end_pos - pos, thread);
      result := result || jsonb_build_array(jsonb_set(node, '{content}', inner_result -> 'nodes'));
      covered := covered || (inner_result ->> 'text');
      pos := pos + (inner_result ->> 'length')::integer;
    else
      result := result || jsonb_build_array(node);
    end if;
  end loop;
  return jsonb_build_object('nodes', result, 'text', covered, 'length', pos);
end;
$$;


--
-- Name: mention_candidates(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mention_candidates(target_page uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  ws uuid;
begin
  if public.effective_role(target_page) is null then
    return public.page_error('forbidden');
  end if;
  select workspace_id into ws from public.pages where id = target_page;
  return jsonb_build_object('ok', true, 'people', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', pr.id, 'name', pr.name, 'email', pr.email)
             order by pr.name nulls last, pr.email)
    from public.workspace_members m
    join public.profiles pr on pr.id = m.user_id
    where m.workspace_id = ws and m.status = 'active' and m.user_id <> auth.uid()
      and public.page_role_of(target_page, m.user_id) is not null
  ), '[]'::jsonb));
end;
$$;


--
-- Name: move_page(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_page(target_page uuid, new_parent uuid, new_index integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.pages where id = target_page and deleted_at is not null) then
    return public.page_error('in_trash');
  end if;

  if new_parent is not null then
    if not public.can_edit_page(new_parent)
       or (select workspace_id from public.pages where id = new_parent)
          <> (select workspace_id from public.pages where id = target_page) then
      return public.page_error('forbidden');
    end if;
    if exists (select 1 from public.pages where id = new_parent and deleted_at is not null) then
      return public.page_error('in_trash');
    end if;
    if new_parent in (select id from public.page_subtree(target_page)) then
      return public.page_error('cycle');
    end if;
  end if;

  perform public.place_page(target_page, new_parent, new_index);
  update public.pages set updated_at = now(), updated_by = auth.uid() where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid,
    owner_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    icon text,
    "position" integer DEFAULT 0 NOT NULL,
    content jsonb,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    trashed_with uuid,
    workspace_id uuid NOT NULL,
    created_by uuid,
    inherit boolean DEFAULT true NOT NULL,
    workspace_role text,
    search_text text DEFAULT ''::text NOT NULL,
    search_vector tsvector DEFAULT ''::tsvector NOT NULL,
    cover jsonb,
    CONSTRAINT pages_check CHECK (((deleted_at IS NULL) = (trashed_with IS NULL))),
    CONSTRAINT pages_check1 CHECK ((parent_id IS DISTINCT FROM id)),
    CONSTRAINT pages_icon_check CHECK (((icon IS NULL) OR ((char_length(icon) >= 1) AND (char_length(icon) <= 16)))),
    CONSTRAINT pages_title_check CHECK ((char_length(title) <= 200)),
    CONSTRAINT pages_workspace_role_check CHECK ((workspace_role = ANY (ARRAY['editor'::text, 'commenter'::text, 'viewer'::text])))
);


--
-- Name: my_role(public.pages); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_role(page public.pages) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select public.effective_role(page.id);
$$;


--
-- Name: page_content_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.page_content_limit() RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select 1000000;
$$;


--
-- Name: page_error(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.page_error(code text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object('ok', false, 'error', code);
$$;


--
-- Name: page_plain_text(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.page_plain_text(doc jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare
  result text;
  extra text;
begin
  if doc is null or jsonb_typeof(doc) <> 'array' then
    return '';
  end if;
  select coalesce(string_agg(value #>> '{}', ' '), '') into result
  from jsonb_path_query(doc, 'strict $.**.text') value
  where jsonb_typeof(value) = 'string';

  select coalesce(string_agg(concat_ws(' ', b -> 'props' ->> 'title', b -> 'props' ->> 'description'), ' '), '')
    into extra
  from jsonb_path_query(doc, 'strict $.** ? (@.type == "linkCard")') b;
  result := result || ' ' || extra;

  -- Diagram data is a JSON string inside the block; a broken one is just skipped.
  begin
    select coalesce(string_agg(concat_ws(' ', n ->> 'title', n ->> 'description'), ' '), '')
      into extra
    from jsonb_path_query(doc, 'strict $.** ? (@.type == "diagram")') b,
         jsonb_array_elements(coalesce(nullif(b -> 'props' ->> 'data', '')::jsonb -> 'nodes', '[]'::jsonb)) n;
    result := result || ' ' || extra;
  exception when others then
    null;
  end;

  return left(regexp_replace(result, '\s+', ' ', 'g'), 200000);
end;
$_$;


--
-- Name: page_role_of(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.page_role_of(target_page uuid, member uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with chain as (
    select c.* from public.access_chain(target_page) c
  ),
  candidates as (
    select case when c.depth = 0 then 'owner' else 'editor' end as role
    from chain c where c.owner_id = member
    union all
    select c.workspace_role from chain c where c.workspace_role is not null
    union all
    select a.role from chain c join public.page_access a on a.page_id = c.id and a.user_id = member
  )
  select role from candidates order by public.role_rank(role) desc limit 1;
$$;


--
-- Name: page_sharing(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.page_sharing(target_page uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  my text := public.effective_role(target_page);
  page public.pages;
  inherited_ws text;
  entries jsonb;
  members jsonb := '[]'::jsonb;
begin
  if my is null then
    return public.page_error('forbidden');
  end if;
  select * into page from public.pages where id = target_page;

  select c.workspace_role into inherited_ws
  from public.access_chain(target_page) c
  where c.depth > 0 and c.workspace_role is not null
  order by public.role_rank(c.workspace_role) desc
  limit 1;

  with sources as (
    select a.user_id, a.role, c.depth, c.id as from_page
    from public.access_chain(target_page) c
    join public.page_access a on a.page_id = c.id
    union all
    select c.owner_id, 'editor', c.depth, c.id
    from public.access_chain(target_page) c
    where c.depth > 0
  ),
  best as (
    -- One line per person: their highest role; their own grant wins a tie.
    select distinct on (s.user_id) s.user_id, s.role, s.depth, s.from_page
    from sources s
    where s.user_id <> page.owner_id and public.is_active_member(page.workspace_id, s.user_id)
    order by s.user_id, public.role_rank(s.role) desc, s.depth
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', b.user_id,
      'name', pr.name,
      'email', pr.email,
      'role', b.role,
      'own', exists (select 1 from public.page_access a where a.page_id = target_page and a.user_id = b.user_id),
      'own_role', (select a.role from public.page_access a where a.page_id = target_page and a.user_id = b.user_id),
      'inherited_from', case when b.depth > 0 then b.from_page end,
      'inherited_title', case
        when b.depth > 0 and public.effective_role(b.from_page) is not null
        then (select f.title from public.pages f where f.id = b.from_page)
      end
    ) order by pr.name nulls last, pr.email), '[]'::jsonb)
    into entries
  from best b
  join public.profiles pr on pr.id = b.user_id;

  if my = 'owner' then
    select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', pr.name, 'email', pr.email)
             order by pr.name nulls last, pr.email), '[]'::jsonb)
      into members
    from public.workspace_members m
    join public.profiles pr on pr.id = m.user_id
    where m.workspace_id = page.workspace_id and m.status = 'active' and m.user_id <> page.owner_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'my_role', my,
    'owner', (select jsonb_build_object('user_id', pr.id, 'name', pr.name, 'email', pr.email)
              from public.profiles pr where pr.id = page.owner_id),
    'has_parent', page.parent_id is not null,
    'inherit', page.inherit,
    'workspace_role', page.workspace_role,
    'inherited_workspace_role', case when page.parent_id is not null and page.inherit then inherited_ws end,
    'entries', entries,
    'members', members
  );
end;
$$;


--
-- Name: page_subtree(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.page_subtree(root uuid) RETURNS TABLE(id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with recursive tree as (
    select p.id from public.pages p where p.id = root
    union all
    select c.id from public.pages c join tree t on c.parent_id = t.id
  )
  select tree.id from tree;
$$;


--
-- Name: place_page(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.place_page(moved uuid, new_parent uuid, new_index integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  sibling uuid;
  ordered uuid[];
  ws uuid;
  i integer := 0;
begin
  select workspace_id into ws from public.pages where id = moved;

  select coalesce(array_agg(p.id order by p.position, p.created_at), '{}')
    into ordered
  from public.pages p
  where p.workspace_id = ws
    and p.parent_id is not distinct from new_parent
    and p.deleted_at is null
    and p.id <> moved
    and (new_parent is not null or p.owner_id = auth.uid());

  new_index := greatest(0, least(coalesce(new_index, cardinality(ordered)), cardinality(ordered)));
  ordered := ordered[1:new_index] || moved || ordered[new_index + 1:];

  foreach sibling in array ordered loop
    update public.pages set position = i where id = sibling and position is distinct from i;
    i := i + 1;
  end loop;

  update public.pages set parent_id = new_parent where id = moved;
end;
$$;


--
-- Name: platform_workspaces(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.platform_workspaces() RETURNS TABLE(id uuid, short_id text, name text, owner_email text, members bigint, pages bigint, storage_bytes bigint, storage_limit_mb integer, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: profile_stats(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profile_stats(ws uuid, person uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: purge_trash(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_trash() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  purged integer;
begin
  delete from public.pages
  where trashed_with = id and deleted_at < now() - interval '30 days';
  get diagnostics purged = row_count;
  return purged;
end;
$$;


--
-- Name: reassign_member_pages(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reassign_member_pages(ws uuid, from_user uuid, to_user uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  moved integer;
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'reassign_member_pages'));
    return public.page_error('forbidden');
  end if;
  if public.is_active_member(ws, from_user) then
    return public.page_error('still_a_member');
  end if;
  if not public.is_active_member(ws, to_user) then
    return public.page_error('not_a_member');
  end if;

  delete from public.page_access a
  using public.pages p
  where a.page_id = p.id and p.workspace_id = ws and p.owner_id = from_user and a.user_id = to_user;
  update public.pages set owner_id = to_user where workspace_id = ws and owner_id = from_user;
  get diagnostics moved = row_count;
  perform public.log_workspace_action(ws, 'pages_reassigned', jsonb_build_object(
    'from', (select email from public.profiles where id = from_user),
    'to', (select email from public.profiles where id = to_user),
    'pages', moved));
  return jsonb_build_object('ok', true, 'pages', moved);
end;
$$;


--
-- Name: record_page_contribution(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_page_contribution() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: refresh_page_mentions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_page_mentions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  mentioned uuid[];
begin
  -- Ids from person chips anywhere in the document; only people of this
  -- workspace who can see the page, never the author of the change.
  select coalesce(array_agg(distinct m.id), '{}') into mentioned
  from (
    select (value #>> '{}')::uuid as id
    from jsonb_path_query(coalesce(new.content, '[]'::jsonb), 'strict $.** ? (@.type == "personChip").props.userId') value
    where (value #>> '{}') ~ '^[0-9a-f-]{36}$'
  ) m
  where m.id is distinct from auth.uid()
    and public.is_active_member(new.workspace_id, m.id)
    and public.page_role_of(new.id, m.id) is not null;

  delete from public.page_mentions where page_id = new.id and not (user_id = any (mentioned));
  insert into public.page_mentions (workspace_id, page_id, user_id, mentioned_by)
  select new.workspace_id, new.id, u, auth.uid() from unnest(mentioned) u
  on conflict (page_id, user_id) do nothing;
  return new;
end;
$_$;


--
-- Name: refresh_thread_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_thread_status(target_page uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  update public.comment_threads t
  set status = x.new_status
  from (
    select t2.id,
           case when position(t2.id::text in coalesce(p.content::text, '')) > 0 then 'open' else 'orphaned' end as new_status
    from public.comment_threads t2
    join public.pages p on p.id = t2.page_id
    where t2.page_id = target_page and t2.status in ('open', 'orphaned')
  ) x
  where t.id = x.id and t.status <> x.new_status;
$$;


--
-- Name: register_attachment(uuid, text, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_attachment(target_page uuid, file_type text, file_bytes integer, file_width integer, file_height integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  page record;
  used bigint;
  new_id uuid := gen_random_uuid();
  path text;
  on_drive boolean;
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

  on_drive := exists (
    select 1 from public.drive_connections c
    where c.workspace_id = page.workspace_id and c.active and c.status = 'ok'
  );
  if not on_drive then
    select coalesce(sum(bytes), 0) into used
    from public.attachments where workspace_id = page.workspace_id and storage_backend = 'supabase';
    if used + file_bytes > page.storage_limit_mb::bigint * 1048576 then
      return public.page_error('quota_exceeded');
    end if;
  end if;

  path := page.workspace_id || '/' || target_page || '/' || new_id || '.' ||
    case file_type when 'image/webp' then 'webp' when 'image/jpeg' then 'jpg'
                   when 'image/png' then 'png' else 'gif' end;
  insert into public.attachments (id, workspace_id, page_id, storage_path, mime_type, bytes, width, height, uploaded_by)
  values (new_id, page.workspace_id, target_page, path, file_type, file_bytes,
          nullif(file_width, 0), nullif(file_height, 0), auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path,
                            'backend', case when on_drive then 'drive' else 'supabase' end);
end;
$$;


--
-- Name: remember_deleted_attachment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remember_deleted_attachment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.attachment_tombstones (storage_path, storage_backend, drive_connection_id, drive_file_id)
  values (old.storage_path, old.storage_backend, old.drive_connection_id, old.drive_file_id)
  on conflict do nothing;
  return old;
end;
$$;


--
-- Name: remove_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_member(ws uuid, member uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if member <> auth.uid() and not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'remove_member'));
    return public.ws_error('forbidden');
  end if;
  if member = auth.uid() and not public.is_workspace_member(ws) then
    return public.ws_error('forbidden');
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = member and status = 'active'
  ) then
    return public.ws_error('not_a_member');
  end if;
  if (select role from public.workspace_members where workspace_id = ws and user_id = member) = 'owner' then
    return public.ws_error('owner_role');
  end if;

  -- Kept as 'removed' so their domain doesn't bring them back; their pages stay.
  update public.workspace_members
  set status = 'removed', role = 'member'
  where workspace_id = ws and user_id = member;
  perform public.log_workspace_action(ws,
    case when member = auth.uid() then 'member_left' else 'member_removed' end,
    jsonb_build_object('email', (select email from public.profiles where id = member)));
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: remove_workspace_domain(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_workspace_domain(ws uuid, target_domain text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'remove_domain', 'domain', target_domain));
    return public.ws_error('forbidden');
  end if;
  if not exists (select 1 from public.workspace_domains where domain = target_domain and workspace_id = ws) then
    return public.ws_error('not_found');
  end if;
  if not public.admin_keeps_access_without(ws, target_domain) then
    return public.ws_error('last_admin_domain');
  end if;

  delete from public.workspace_domains where domain = target_domain;
  perform public.log_workspace_action(ws, 'domain_removed', jsonb_build_object('domain', target_domain));
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: rename_page(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rename_page(target_page uuid, new_title text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if char_length(coalesce(new_title, '')) > 200 then
    return public.page_error('title_too_long');
  end if;

  update public.pages
  set title = trim(coalesce(new_title, '')), updated_at = now(), updated_by = auth.uid()
  where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: rename_workspace(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rename_workspace(ws uuid, new_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  cleaned text := trim(coalesce(new_name, ''));
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'rename_workspace'));
    return public.ws_error('forbidden');
  end if;
  if char_length(cleaned) not between 1 and 80 then
    return public.ws_error('invalid_name');
  end if;

  update public.workspaces set name = cleaned where id = ws;
  perform public.log_workspace_action(ws, 'workspace_renamed', jsonb_build_object('name', cleaned));
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: reply_to_thread(uuid, text, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reply_to_thread(target_thread uuid, body text, mention_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  thread public.comment_threads;
  cleaned text := trim(coalesce(body, ''));
  new_comment uuid;
begin
  select * into thread from public.comment_threads where id = target_thread;
  if thread.id is null or not public.can_comment_page(thread.page_id) then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.pages where id = thread.page_id and deleted_at is not null) then
    return public.page_error('in_trash');
  end if;
  if char_length(cleaned) not between 1 and 5000 then
    return public.page_error('invalid_comment');
  end if;
  insert into public.comments (workspace_id, thread_id, author_id, body, mentions)
  values (thread.workspace_id, thread.id, auth.uid(), cleaned, public.clean_mentions(thread.page_id, mention_ids))
  returning id into new_comment;
  return jsonb_build_object('ok', true, 'id', new_comment);
end;
$$;


--
-- Name: restore_page(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_page(target_page uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  parent uuid;
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if not exists (select 1 from public.pages where id = target_page and trashed_with = id) then
    return public.page_error('not_in_trash');
  end if;

  update public.pages
  set deleted_at = null, deleted_by = null, trashed_with = null
  where trashed_with = target_page;

  -- If the former parent is gone to the trash itself, bring the page back at the top level.
  select p.parent_id into parent from public.pages p where p.id = target_page;
  if parent is not null and exists (
    select 1 from public.pages where id = parent and deleted_at is not null
  ) then
    perform public.place_page(target_page, null, null);
  else
    perform public.place_page(target_page, parent, null);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: revoke_invitation(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_invitation(ws uuid, target_invitation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  invitee text;
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'revoke_invitation'));
    return public.ws_error('forbidden');
  end if;

  update public.invitations
  set revoked_at = now()
  where id = target_invitation and workspace_id = ws and accepted_at is null and revoked_at is null
  returning email into invitee;
  if invitee is null then
    return public.ws_error('not_found');
  end if;

  perform public.log_workspace_action(ws, 'invitation_revoked', jsonb_build_object('email', invitee));
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: role_rank(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.role_rank(page_role text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case page_role when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end;
$$;


--
-- Name: save_page_content(uuid, jsonb, integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_page_content(target_page uuid, new_content jsonb, base_version integer, force boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current record;
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if jsonb_typeof(new_content) is distinct from 'array' then
    return public.page_error('invalid_content');
  end if;
  if octet_length(new_content::text) > public.page_content_limit() then
    return public.page_error('too_large');
  end if;

  -- Lock the row so two simultaneous saves can't both pass the version check.
  select p.version, p.updated_at, p.deleted_at, pr.name as updated_by_name, pr.email as updated_by_email
    into current
  from public.pages p
  left join public.profiles pr on pr.id = p.updated_by
  where p.id = target_page
  for update of p;

  if current.deleted_at is not null then
    return public.page_error('in_trash');
  end if;

  if not force and current.version <> base_version then
    return jsonb_build_object(
      'ok', false,
      'error', 'conflict',
      'version', current.version,
      'updated_at', current.updated_at,
      'updated_by', coalesce(current.updated_by_name, current.updated_by_email)
    );
  end if;

  update public.pages
  set content = new_content,
      version = current.version + 1,
      updated_at = now(),
      updated_by = auth.uid()
  where id = target_page;

  perform public.refresh_thread_status(target_page);
  return jsonb_build_object('ok', true, 'version', current.version + 1);
end;
$$;


--
-- Name: search_pages(uuid, text, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_pages(ws uuid, query text, root uuid DEFAULT NULL::uuid, max_depth integer DEFAULT NULL::integer) RETURNS TABLE(id uuid, title text, icon text, parent_id uuid, depth integer, snippet text, rank real)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  q tsquery := public.search_query(query);
begin
  if q is null or not public.is_workspace_member(ws) then
    return;
  end if;
  if root is not null and (
    public.effective_role(root) is null
    or (select p.workspace_id from public.pages p where p.id = root) is distinct from ws
  ) then
    return;
  end if;

  return query
  with recursive tree as (
    select p.id, 0 as depth
    from public.pages p
    where p.workspace_id = ws and p.deleted_at is null
      and (case when root is null then p.parent_id is null else p.id = root end)
    union all
    select c.id, t.depth + 1
    from public.pages c
    join tree t on c.parent_id = t.id
    where c.deleted_at is null and t.depth < 100 and (max_depth is null or t.depth < max_depth)
  )
  select p.id, p.title, p.icon, p.parent_id, t.depth,
         ts_headline('simple'::regconfig, p.search_text, q,
           'StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', MaxWords=18, MinWords=6, MaxFragments=1, FragmentDelimiter=" … "'),
         ts_rank(p.search_vector, q)
  from tree t
  join public.pages p on p.id = t.id
  where p.search_vector @@ q
    and public.effective_role(p.id) is not null
  order by ts_rank(p.search_vector, q) desc, p.updated_at desc
  limit 30;
end;
$$;


--
-- Name: search_query(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_query(raw text) RETURNS tsquery
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case when count(*) = 0 then null else to_tsquery('simple'::regconfig, string_agg(quote_literal(w) || ':*', ' & ')) end
  from (
    select w
    from unnest(regexp_split_to_array(lower(left(coalesce(raw, ''), 200)), '[^[:alnum:]]+')) w
    where w <> ''
    limit 8
  ) words;
$$;


--
-- Name: set_member_role(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_member_role(ws uuid, member uuid, new_role text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'set_member_role'));
    return public.ws_error('forbidden');
  end if;
  if coalesce(new_role, '') not in ('admin', 'member') then
    return public.ws_error('invalid_role');
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = member and status = 'active'
  ) then
    return public.ws_error('not_a_member');
  end if;
  if (select role from public.workspace_members where workspace_id = ws and user_id = member) = 'owner' then
    return public.ws_error('owner_role');
  end if;

  update public.workspace_members set role = new_role where workspace_id = ws and user_id = member;
  perform public.log_workspace_action(ws, 'member_role_changed', jsonb_build_object(
    'email', (select email from public.profiles where id = member), 'role', new_role));
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: set_my_preferences(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_preferences(new_theme text, new_locale text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if new_theme is not null and new_theme not in ('system', 'light', 'dark') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if new_locale is not null and new_locale not in ('uk', 'en') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  update public.profiles
  set theme = coalesce(new_theme, theme), locale = coalesce(new_locale, locale)
  where id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: set_my_profile_visibility(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_profile_visibility(ws uuid, visibility text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: set_open_registration(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_open_registration(open boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_platform_admin() then
    perform public.log_workspace_action(null, 'access_denied',
      jsonb_build_object('attempted', 'set_open_registration'));
    return public.ws_error('forbidden');
  end if;
  update public.platform_settings
  set open_registration = open, updated_at = now(), updated_by = auth.uid();
  perform public.log_workspace_action(null,
    case when open then 'registration_opened' else 'registration_closed' end, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: set_page_cover(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_page_cover(target_page uuid, new_cover jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  cleaned jsonb;
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.pages where id = target_page and deleted_at is not null) then
    return public.page_error('in_trash');
  end if;
  if new_cover is not null and jsonb_typeof(new_cover) <> 'null' then
    cleaned := public.clean_cover(new_cover, target_page);
    if cleaned is null then
      return public.page_error('invalid_cover');
    end if;
  end if;
  update public.pages
  set cover = cleaned, updated_at = now(), updated_by = auth.uid()
  where id = target_page;
  return jsonb_build_object('ok', true, 'cover', cleaned);
end;
$$;


--
-- Name: set_page_icon(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_page_icon(target_page uuid, new_icon text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  cleaned text := nullif(trim(coalesce(new_icon, '')), '');
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if char_length(cleaned) > 16 then
    return public.page_error('invalid_icon');
  end if;

  update public.pages
  set icon = cleaned, updated_at = now(), updated_by = auth.uid()
  where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: set_page_inherit(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_page_inherit(target_page uuid, new_inherit boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  page public.pages;
  inherited_ws text;
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  select * into page from public.pages where id = target_page;
  if page.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if page.parent_id is null then
    return public.page_error('no_parent');
  end if;
  if page.inherit = new_inherit then
    return jsonb_build_object('ok', true);
  end if;

  if not new_inherit then
    with sources as (
      select a.user_id, a.role from public.access_chain(target_page) c
      join public.page_access a on a.page_id = c.id
      where c.depth > 0
      union all
      select c.owner_id, 'editor' from public.access_chain(target_page) c where c.depth > 0
    ),
    best as (
      select distinct on (s.user_id) s.user_id, s.role
      from sources s
      where s.user_id <> page.owner_id and public.is_active_member(page.workspace_id, s.user_id)
      order by s.user_id, public.role_rank(s.role) desc
    )
    insert into public.page_access (workspace_id, page_id, user_id, role, granted_by)
    select page.workspace_id, target_page, b.user_id, b.role, auth.uid() from best b
    on conflict (page_id, user_id) do update
      set role = case when public.role_rank(excluded.role) > public.role_rank(public.page_access.role)
                      then excluded.role else public.page_access.role end;

    select c.workspace_role into inherited_ws
    from public.access_chain(target_page) c
    where c.workspace_role is not null
    order by public.role_rank(c.workspace_role) desc
    limit 1;
    update public.pages set inherit = false, workspace_role = inherited_ws where id = target_page;
  else
    update public.pages set inherit = true where id = target_page;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: set_page_member_role(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_page_member_role(target_page uuid, member uuid, new_role text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  page public.pages;
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  select * into page from public.pages where id = target_page;
  if page.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if new_role is not null and new_role not in ('editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  if member = page.owner_id then
    return public.page_error('is_owner');
  end if;

  if new_role is null then
    delete from public.page_access where page_id = target_page and user_id = member;
    return jsonb_build_object('ok', true);
  end if;

  -- Only people of the same workspace; someone from another one is "not found".
  if not public.is_active_member(page.workspace_id, member) then
    return public.page_error('not_a_member');
  end if;

  insert into public.page_access (workspace_id, page_id, user_id, role, granted_by)
  values (page.workspace_id, target_page, member, new_role, auth.uid())
  on conflict (page_id, user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: set_page_workspace_role(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_page_workspace_role(target_page uuid, new_role text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.pages where id = target_page and deleted_at is not null) then
    return public.page_error('in_trash');
  end if;
  if new_role is not null and new_role not in ('editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  update public.pages set workspace_role = new_role where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: set_thread_resolved(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_thread_resolved(target_thread uuid, resolved boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  thread public.comment_threads;
begin
  select * into thread from public.comment_threads where id = target_thread;
  if thread.id is null or not public.can_comment_page(thread.page_id) then
    return public.page_error('forbidden');
  end if;
  if resolved then
    update public.comment_threads
    set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
    where id = target_thread;
  else
    update public.comment_threads
    set status = 'open', resolved_by = null, resolved_at = null
    where id = target_thread;
    perform public.refresh_thread_status(thread.page_id);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: set_workspace_domain_active(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_workspace_domain_active(ws uuid, target_domain text, active boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'set_domain_active', 'domain', target_domain));
    return public.ws_error('forbidden');
  end if;
  if not exists (select 1 from public.workspace_domains where domain = target_domain and workspace_id = ws) then
    return public.ws_error('not_found');
  end if;
  if not active and not public.admin_keeps_access_without(ws, target_domain) then
    return public.ws_error('last_admin_domain');
  end if;

  update public.workspace_domains set is_active = active where domain = target_domain;
  perform public.log_workspace_action(ws,
    case when active then 'domain_enabled' else 'domain_disabled' end,
    jsonb_build_object('domain', target_domain));
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: shared_with_workspace(public.pages); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shared_with_workspace(page public.pages) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select c.workspace_role
  from public.access_chain(page.id) c
  where public.is_workspace_member(page.workspace_id) and c.workspace_role is not null
  order by public.role_rank(c.workspace_role) desc
  limit 1;
$$;


--
-- Name: shares_workspace_with(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shares_workspace_with(other uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select (other = auth.uid() and public.current_email() is not null)
      or exists (
        select 1
        from public.workspace_members mine
        join public.workspace_members theirs
          on theirs.workspace_id = mine.workspace_id
         and theirs.user_id = other
         and theirs.status = 'active'
        where mine.user_id = auth.uid() and public.is_workspace_member(mine.workspace_id)
      );
$$;


--
-- Name: sync_profile_from_auth_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_profile_from_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email      = excluded.email,
        name       = excluded.name,
        avatar_url = excluded.avatar_url;
  return new;
end;
$$;


--
-- Name: transfer_page_ownership(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_page_ownership(target_page uuid, new_owner uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  page public.pages;
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  select * into page from public.pages where id = target_page;
  if page.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if new_owner = page.owner_id then
    return jsonb_build_object('ok', true);
  end if;
  if not public.is_active_member(page.workspace_id, new_owner) then
    return public.page_error('not_a_member');
  end if;

  delete from public.page_access where page_id = target_page and user_id = new_owner;
  insert into public.page_access (workspace_id, page_id, user_id, role, granted_by)
  values (page.workspace_id, target_page, page.owner_id, 'editor', auth.uid())
  on conflict (page_id, user_id) do update set role = 'editor';
  update public.pages set owner_id = new_owner where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: transfer_workspace_ownership(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_workspace_ownership(ws uuid, new_owner uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if coalesce(public.workspace_role(ws), '') <> 'owner' then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'transfer_ownership'));
    return public.ws_error('forbidden');
  end if;
  if new_owner = auth.uid() then
    return public.ws_error('already_owner');
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = new_owner and status = 'active'
  ) then
    return public.ws_error('not_a_member');
  end if;

  -- The former owner stays as an admin.
  update public.workspace_members set role = 'admin' where workspace_id = ws and user_id = auth.uid();
  update public.workspace_members
  set role = 'owner', joined_via = 'creator'
  where workspace_id = ws and user_id = new_owner;
  update public.workspaces set owner_id = new_owner where id = ws;

  perform public.log_workspace_action(ws, 'ownership_transferred',
    jsonb_build_object('to', (select email from public.profiles where id = new_owner)));
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: trash_page(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trash_page(target_page uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.pages where id = target_page and deleted_at is not null) then
    return public.page_error('in_trash');
  end if;

  update public.pages
  set deleted_at = now(), deleted_by = auth.uid(), trashed_with = target_page
  where id in (select id from public.page_subtree(target_page))
    and deleted_at is null;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: update_page_search(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_page_search() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.search_text := public.page_plain_text(new.content);
  new.search_vector :=
    setweight(to_tsvector('simple'::regconfig, coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('simple'::regconfig, new.search_text), 'B');
  return new;
end;
$$;


--
-- Name: workspace_login_hint(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_login_hint(ws_short_id text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case when count(*) = 1 then min(d.domain) end
  from public.workspace_domains d
  join public.workspaces w on w.id = d.workspace_id
  where w.short_id = ws_short_id and d.is_active;
$$;


--
-- Name: workspace_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_role(ws uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = ws and m.user_id = auth.uid() and public.is_workspace_member(ws);
$$;


--
-- Name: workspace_storage_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_storage_status(ws uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  conn public.drive_connections;
begin
  if not public.is_workspace_admin(ws) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into conn from public.drive_connections c where c.workspace_id = ws and c.active;
  return jsonb_build_object(
    'ok', true,
    'drive', case when conn.id is null then null else jsonb_build_object(
      'account_email', conn.account_email,
      'root_folder_id', conn.root_folder_id,
      'status', conn.status,
      'last_error', conn.last_error,
      'connected_at', conn.connected_at,
      'connected_by', (select coalesce(p.name, p.email) from public.profiles p where p.id = conn.connected_by),
      'last_backup_at', conn.last_backup_at
    ) end,
    'supabase_bytes', (select coalesce(sum(bytes), 0) from public.attachments a where a.workspace_id = ws and a.storage_backend = 'supabase'),
    'limit_mb', (select storage_limit_mb from public.workspaces w where w.id = ws),
    'total_files', (select count(*) from public.attachments a where a.workspace_id = ws),
    -- Files not yet on the active Drive: what "move files" would still do.
    'to_move', case when conn.id is null then 0 else (
      select count(*) from public.attachments a
      where a.workspace_id = ws and (a.storage_backend <> 'drive' or a.drive_connection_id is distinct from conn.id)
    ) end
  );
end;
$$;


--
-- Name: ws_error(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ws_error(code text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object('ok', false, 'error', code);
$$;


--
-- Name: attachment_tombstones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachment_tombstones (
    storage_path text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    storage_backend text DEFAULT 'supabase'::text NOT NULL,
    drive_connection_id uuid,
    drive_file_id text
);


--
-- Name: attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    page_id uuid NOT NULL,
    storage_path text NOT NULL,
    mime_type text NOT NULL,
    bytes integer NOT NULL,
    width integer,
    height integer,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    storage_backend text DEFAULT 'supabase'::text NOT NULL,
    drive_connection_id uuid,
    drive_file_id text,
    CONSTRAINT attachments_bytes_check CHECK (((bytes >= 1) AND (bytes <= 2097152))),
    CONSTRAINT attachments_height_check CHECK ((height > 0)),
    CONSTRAINT attachments_mime_type_check CHECK ((mime_type = ANY (ARRAY['image/webp'::text, 'image/jpeg'::text, 'image/png'::text, 'image/gif'::text]))),
    CONSTRAINT attachments_storage_backend_check CHECK ((storage_backend = ANY (ARRAY['supabase'::text, 'drive'::text]))),
    CONSTRAINT attachments_width_check CHECK ((width > 0))
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    workspace_id uuid,
    actor_id uuid,
    action text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: comment_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comment_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    page_id uuid NOT NULL,
    quoted_text text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    CONSTRAINT comment_threads_quoted_text_check CHECK ((char_length(quoted_text) <= 1000)),
    CONSTRAINT comment_threads_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'orphaned'::text])))
);


--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    author_id uuid,
    body text NOT NULL,
    mentions uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    edited_at timestamp with time zone,
    CONSTRAINT comments_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 5000)))
);


--
-- Name: drive_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drive_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    account_email text NOT NULL,
    root_folder_id text NOT NULL,
    files_folder_id text NOT NULL,
    backups_folder_id text NOT NULL,
    token_encrypted text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    status text DEFAULT 'ok'::text NOT NULL,
    last_error text,
    connected_by uuid,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    last_backup_at timestamp with time zone,
    CONSTRAINT drive_connections_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text])))
);


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    token_hash text NOT NULL,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    revoked_at timestamp with time zone,
    CONSTRAINT invitations_email_check CHECK (((email = lower(email)) AND (email ~~ '%_@_%'::text))),
    CONSTRAINT invitations_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);


--
-- Name: page_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    page_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT page_access_role_check CHECK ((role = ANY (ARRAY['editor'::text, 'commenter'::text, 'viewer'::text])))
);


--
-- Name: page_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_backups (
    page_id uuid NOT NULL,
    drive_connection_id uuid NOT NULL,
    json_file_id text NOT NULL,
    markdown_file_id text NOT NULL,
    backed_up_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: page_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_contributions (
    workspace_id uuid NOT NULL,
    page_id uuid NOT NULL,
    user_id uuid NOT NULL,
    chars_added bigint DEFAULT 0 NOT NULL,
    chars_removed bigint DEFAULT 0 NOT NULL,
    saves integer DEFAULT 0 NOT NULL,
    last_saved_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: page_mentions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_mentions (
    workspace_id uuid NOT NULL,
    page_id uuid NOT NULL,
    user_id uuid NOT NULL,
    mentioned_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_settings (
    id boolean DEFAULT true NOT NULL,
    open_registration boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT platform_settings_id_check CHECK (id)
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    name text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_platform_admin boolean DEFAULT false NOT NULL,
    theme text DEFAULT 'system'::text NOT NULL,
    locale text DEFAULT 'uk'::text NOT NULL,
    CONSTRAINT profiles_locale_check CHECK ((locale = ANY (ARRAY['uk'::text, 'en'::text]))),
    CONSTRAINT profiles_theme_check CHECK ((theme = ANY (ARRAY['system'::text, 'light'::text, 'dark'::text])))
);


--
-- Name: public_email_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_email_domains (
    domain text NOT NULL
);


--
-- Name: workspace_data_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_data_backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    drive_connection_id uuid NOT NULL,
    drive_file_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_domains (
    domain text NOT NULL,
    workspace_id uuid NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_domains_domain_check CHECK ((domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'::text))
);


--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_members (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_via text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    profile_visibility text DEFAULT 'private'::text NOT NULL,
    CONSTRAINT workspace_members_joined_via_check CHECK ((joined_via = ANY (ARRAY['creator'::text, 'domain'::text, 'invite'::text]))),
    CONSTRAINT workspace_members_profile_visibility_check CHECK ((profile_visibility = ANY (ARRAY['private'::text, 'workspace'::text]))),
    CONSTRAINT workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]))),
    CONSTRAINT workspace_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'removed'::text])))
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    short_id text DEFAULT public.generate_short_id() NOT NULL,
    name text NOT NULL,
    owner_id uuid NOT NULL,
    created_by uuid,
    plan text DEFAULT 'free'::text NOT NULL,
    storage_limit_mb integer DEFAULT 500 NOT NULL,
    storage_backend text DEFAULT 'supabase'::text NOT NULL,
    storage_config jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspaces_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 80))),
    CONSTRAINT workspaces_short_id_check CHECK ((short_id ~ '^[a-z0-9]{8}$'::text)),
    CONSTRAINT workspaces_storage_backend_check CHECK ((storage_backend = ANY (ARRAY['supabase'::text, 's3'::text, 'google_drive'::text]))),
    CONSTRAINT workspaces_storage_limit_mb_check CHECK ((storage_limit_mb >= 0))
);


--
-- Name: attachment_tombstones attachment_tombstones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_tombstones
    ADD CONSTRAINT attachment_tombstones_pkey PRIMARY KEY (storage_path);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: attachments attachments_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_storage_path_key UNIQUE (storage_path);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: comment_threads comment_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_threads
    ADD CONSTRAINT comment_threads_pkey PRIMARY KEY (id);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: drive_connections drive_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drive_connections
    ADD CONSTRAINT drive_connections_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: page_access page_access_page_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_access
    ADD CONSTRAINT page_access_page_id_user_id_key UNIQUE (page_id, user_id);


--
-- Name: page_access page_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_access
    ADD CONSTRAINT page_access_pkey PRIMARY KEY (id);


--
-- Name: page_backups page_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_backups
    ADD CONSTRAINT page_backups_pkey PRIMARY KEY (page_id, drive_connection_id);


--
-- Name: page_contributions page_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_contributions
    ADD CONSTRAINT page_contributions_pkey PRIMARY KEY (page_id, user_id);


--
-- Name: page_mentions page_mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_mentions
    ADD CONSTRAINT page_mentions_pkey PRIMARY KEY (page_id, user_id);


--
-- Name: pages pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (id);


--
-- Name: platform_settings platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: public_email_domains public_email_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_email_domains
    ADD CONSTRAINT public_email_domains_pkey PRIMARY KEY (domain);


--
-- Name: workspace_data_backups workspace_data_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_data_backups
    ADD CONSTRAINT workspace_data_backups_pkey PRIMARY KEY (id);


--
-- Name: workspace_domains workspace_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_domains
    ADD CONSTRAINT workspace_domains_pkey PRIMARY KEY (domain);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, user_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_short_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_short_id_key UNIQUE (short_id);


--
-- Name: attachments_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attachments_page_idx ON public.attachments USING btree (page_id);


--
-- Name: attachments_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attachments_workspace_idx ON public.attachments USING btree (workspace_id);


--
-- Name: audit_log_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_workspace_idx ON public.audit_log USING btree (workspace_id, created_at DESC);


--
-- Name: comment_threads_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_threads_page_idx ON public.comment_threads USING btree (page_id, created_at);


--
-- Name: comments_mentions_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_mentions_idx ON public.comments USING gin (mentions);


--
-- Name: comments_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_thread_idx ON public.comments USING btree (thread_id, created_at);


--
-- Name: drive_connections_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX drive_connections_one_active ON public.drive_connections USING btree (workspace_id) WHERE active;


--
-- Name: invitations_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitations_email_idx ON public.invitations USING btree (email) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: invitations_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitations_workspace_idx ON public.invitations USING btree (workspace_id);


--
-- Name: page_access_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX page_access_user_idx ON public.page_access USING btree (workspace_id, user_id);


--
-- Name: page_contributions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX page_contributions_user_idx ON public.page_contributions USING btree (workspace_id, user_id);


--
-- Name: page_mentions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX page_mentions_user_idx ON public.page_mentions USING btree (user_id, created_at DESC);


--
-- Name: pages_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pages_owner_idx ON public.pages USING btree (owner_id);


--
-- Name: pages_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pages_search_idx ON public.pages USING gin (search_vector);


--
-- Name: pages_trashed_with_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pages_trashed_with_idx ON public.pages USING btree (trashed_with) WHERE (trashed_with IS NOT NULL);


--
-- Name: pages_workspace_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pages_workspace_owner_idx ON public.pages USING btree (workspace_id, owner_id);


--
-- Name: pages_workspace_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pages_workspace_parent_idx ON public.pages USING btree (workspace_id, parent_id, "position");


--
-- Name: workspace_data_backups_conn_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_data_backups_conn_idx ON public.workspace_data_backups USING btree (drive_connection_id, created_at DESC);


--
-- Name: workspace_domains_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_domains_workspace_idx ON public.workspace_domains USING btree (workspace_id);


--
-- Name: workspace_members_one_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_members_one_owner ON public.workspace_members USING btree (workspace_id) WHERE ((role = 'owner'::text) AND (status = 'active'::text));


--
-- Name: workspace_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_members_user_idx ON public.workspace_members USING btree (user_id);


--
-- Name: attachments attachments_tombstone; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER attachments_tombstone AFTER DELETE ON public.attachments FOR EACH ROW EXECUTE FUNCTION public.remember_deleted_attachment();


--
-- Name: comment_threads comment_threads_same_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER comment_threads_same_workspace BEFORE INSERT OR UPDATE ON public.comment_threads FOR EACH ROW EXECUTE FUNCTION public.check_thread_workspace();


--
-- Name: comments comments_same_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER comments_same_workspace BEFORE INSERT OR UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.check_comment_workspace();


--
-- Name: page_access page_access_same_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER page_access_same_workspace BEFORE INSERT OR UPDATE ON public.page_access FOR EACH ROW EXECUTE FUNCTION public.check_page_access_workspace();


--
-- Name: pages pages_contributions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pages_contributions AFTER INSERT OR UPDATE OF content ON public.pages FOR EACH ROW EXECUTE FUNCTION public.record_page_contribution();


--
-- Name: pages pages_mentions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pages_mentions AFTER INSERT OR UPDATE OF content ON public.pages FOR EACH ROW EXECUTE FUNCTION public.refresh_page_mentions();


--
-- Name: pages pages_same_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pages_same_workspace BEFORE INSERT OR UPDATE OF parent_id, workspace_id ON public.pages FOR EACH ROW EXECUTE FUNCTION public.check_page_workspace();


--
-- Name: pages pages_search; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pages_search BEFORE INSERT OR UPDATE OF title, content ON public.pages FOR EACH ROW EXECUTE FUNCTION public.update_page_search();


--
-- Name: workspace_members workspace_members_drop_grants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_members_drop_grants AFTER UPDATE OF status ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION public.drop_grants_of_removed_member();


--
-- Name: attachments attachments_drive_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_drive_connection_id_fkey FOREIGN KEY (drive_connection_id) REFERENCES public.drive_connections(id) ON DELETE SET NULL;


--
-- Name: attachments attachments_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: attachments attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: attachments attachments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: audit_log audit_log_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: comment_threads comment_threads_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_threads
    ADD CONSTRAINT comment_threads_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: comment_threads comment_threads_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_threads
    ADD CONSTRAINT comment_threads_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: comment_threads comment_threads_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_threads
    ADD CONSTRAINT comment_threads_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: comment_threads comment_threads_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_threads
    ADD CONSTRAINT comment_threads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: comments comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: comments comments_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.comment_threads(id) ON DELETE CASCADE;


--
-- Name: comments comments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: drive_connections drive_connections_connected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drive_connections
    ADD CONSTRAINT drive_connections_connected_by_fkey FOREIGN KEY (connected_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: drive_connections drive_connections_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drive_connections
    ADD CONSTRAINT drive_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: invitations invitations_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: invitations invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: invitations invitations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: page_access page_access_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_access
    ADD CONSTRAINT page_access_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: page_access page_access_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_access
    ADD CONSTRAINT page_access_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: page_access page_access_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_access
    ADD CONSTRAINT page_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: page_access page_access_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_access
    ADD CONSTRAINT page_access_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: page_backups page_backups_drive_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_backups
    ADD CONSTRAINT page_backups_drive_connection_id_fkey FOREIGN KEY (drive_connection_id) REFERENCES public.drive_connections(id) ON DELETE CASCADE;


--
-- Name: page_backups page_backups_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_backups
    ADD CONSTRAINT page_backups_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: page_contributions page_contributions_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_contributions
    ADD CONSTRAINT page_contributions_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: page_contributions page_contributions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_contributions
    ADD CONSTRAINT page_contributions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: page_contributions page_contributions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_contributions
    ADD CONSTRAINT page_contributions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: page_mentions page_mentions_mentioned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_mentions
    ADD CONSTRAINT page_mentions_mentioned_by_fkey FOREIGN KEY (mentioned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: page_mentions page_mentions_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_mentions
    ADD CONSTRAINT page_mentions_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: page_mentions page_mentions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_mentions
    ADD CONSTRAINT page_mentions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: page_mentions page_mentions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_mentions
    ADD CONSTRAINT page_mentions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: pages pages_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: pages pages_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: pages pages_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: pages pages_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: pages pages_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: pages pages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: platform_settings platform_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: workspace_data_backups workspace_data_backups_drive_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_data_backups
    ADD CONSTRAINT workspace_data_backups_drive_connection_id_fkey FOREIGN KEY (drive_connection_id) REFERENCES public.drive_connections(id) ON DELETE CASCADE;


--
-- Name: workspace_domains workspace_domains_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_domains
    ADD CONSTRAINT workspace_domains_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: workspace_domains workspace_domains_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_domains
    ADD CONSTRAINT workspace_domains_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspaces workspaces_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: workspaces workspaces_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: invitations Admins can read invitations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read invitations" ON public.invitations FOR SELECT TO authenticated USING (public.is_workspace_admin(workspace_id));


--
-- Name: workspace_domains Admins can read workspace domains; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read workspace domains" ON public.workspace_domains FOR SELECT TO authenticated USING (public.is_workspace_admin(workspace_id));


--
-- Name: audit_log Admins read their log; platform admins read platform events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read their log; platform admins read platform events" ON public.audit_log FOR SELECT TO authenticated USING ((((workspace_id IS NOT NULL) AND public.is_workspace_admin(workspace_id)) OR ((workspace_id IS NULL) AND public.is_platform_admin())));


--
-- Name: platform_settings Anyone signed in can read platform settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone signed in can read platform settings" ON public.platform_settings FOR SELECT TO authenticated USING (true);


--
-- Name: pages Members can read pages they have a role on; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read pages they have a role on" ON public.pages FOR SELECT TO authenticated USING ((public.is_workspace_member(workspace_id) AND (public.effective_role(id) IS NOT NULL)));


--
-- Name: workspace_members Members can read the member list; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read the member list" ON public.workspace_members FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));


--
-- Name: workspaces Members can read their workspaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read their workspaces" ON public.workspaces FOR SELECT TO authenticated USING (public.is_workspace_member(id));


--
-- Name: attachments Members read attachments of pages they can see; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members read attachments of pages they can see" ON public.attachments FOR SELECT TO authenticated USING ((public.is_workspace_member(workspace_id) AND (public.effective_role(page_id) IS NOT NULL)));


--
-- Name: comments Members read comments of pages they can see; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members read comments of pages they can see" ON public.comments FOR SELECT TO authenticated USING ((public.is_workspace_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM public.comment_threads t
  WHERE ((t.id = comments.thread_id) AND (public.effective_role(t.page_id) IS NOT NULL))))));


--
-- Name: page_access Members read grants of pages they can see; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members read grants of pages they can see" ON public.page_access FOR SELECT TO authenticated USING ((public.is_workspace_member(workspace_id) AND (public.effective_role(page_id) IS NOT NULL)));


--
-- Name: comment_threads Members read threads of pages they can see; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members read threads of pages they can see" ON public.comment_threads FOR SELECT TO authenticated USING ((public.is_workspace_member(workspace_id) AND (public.effective_role(page_id) IS NOT NULL)));


--
-- Name: page_mentions People read their own mentions on pages they can see; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "People read their own mentions on pages they can see" ON public.page_mentions FOR SELECT TO authenticated USING (((user_id = auth.uid()) AND public.is_workspace_member(workspace_id) AND (public.effective_role(page_id) IS NOT NULL)));


--
-- Name: profiles Users can read profiles of people in their workspaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read profiles of people in their workspaces" ON public.profiles FOR SELECT TO authenticated USING (public.shares_workspace_with(id));


--
-- Name: attachment_tombstones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attachment_tombstones ENABLE ROW LEVEL SECURITY;

--
-- Name: attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: comment_threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comment_threads ENABLE ROW LEVEL SECURITY;

--
-- Name: comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

--
-- Name: drive_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.drive_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: page_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.page_access ENABLE ROW LEVEL SECURITY;

--
-- Name: page_backups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.page_backups ENABLE ROW LEVEL SECURITY;

--
-- Name: page_contributions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.page_contributions ENABLE ROW LEVEL SECURITY;

--
-- Name: page_mentions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.page_mentions ENABLE ROW LEVEL SECURITY;

--
-- Name: pages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: public_email_domains; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.public_email_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_data_backups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_data_backups ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_domains; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- Supabase grants everything in public to anon, authenticated and service_role by
-- default. Start from nothing for the client roles, then grant exactly what the
-- central schema grants (below).
--
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--



--
-- Name: FUNCTION access_chain(target_page uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.access_chain(target_page uuid) FROM PUBLIC;


--
-- Name: FUNCTION add_workspace_domain(ws uuid, new_domain text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_workspace_domain(ws uuid, new_domain text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_workspace_domain(ws uuid, new_domain text) TO authenticated;


--
-- Name: FUNCTION admin_keeps_access_without(ws uuid, changed_domain text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_keeps_access_without(ws uuid, changed_domain text) FROM PUBLIC;


--
-- Name: FUNCTION can_comment_page(target_page uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_comment_page(target_page uuid) FROM PUBLIC;


--
-- Name: FUNCTION can_edit_page(target_page uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_edit_page(target_page uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_edit_page(target_page uuid) TO authenticated;


--
-- Name: FUNCTION check_comment_workspace(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_comment_workspace() FROM PUBLIC;


--
-- Name: FUNCTION check_page_access_workspace(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_page_access_workspace() FROM PUBLIC;


--
-- Name: FUNCTION check_page_workspace(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_page_workspace() FROM PUBLIC;


--
-- Name: FUNCTION check_thread_workspace(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_thread_workspace() FROM PUBLIC;


--
-- Name: FUNCTION clean_cover(raw jsonb, target_page uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clean_cover(raw jsonb, target_page uuid) FROM PUBLIC;


--
-- Name: FUNCTION clean_mentions(target_page uuid, mention_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clean_mentions(target_page uuid, mention_ids uuid[]) FROM PUBLIC;


--
-- Name: FUNCTION collect_unreferenced_attachments(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.collect_unreferenced_attachments() FROM PUBLIC;


--
-- Name: FUNCTION create_comment_thread(target_page uuid, quoted text, body text, mention_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_comment_thread(target_page uuid, quoted text, body text, mention_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_comment_thread(target_page uuid, quoted text, body text, mention_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION create_marked_comment_thread(target_page uuid, base_version integer, ranges jsonb, body text, mention_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_marked_comment_thread(target_page uuid, base_version integer, ranges jsonb, body text, mention_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_marked_comment_thread(target_page uuid, base_version integer, ranges jsonb, body text, mention_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION create_page(ws uuid, parent uuid, new_title text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_page(ws uuid, parent uuid, new_title text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_page(ws uuid, parent uuid, new_title text) TO authenticated;


--
-- Name: FUNCTION create_workspace(new_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_workspace(new_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_workspace(new_name text) TO authenticated;


--
-- Name: FUNCTION current_email(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_email() FROM PUBLIC;


--
-- Name: FUNCTION delete_comment(target_comment uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_comment(target_comment uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_comment(target_comment uuid) TO authenticated;


--
-- Name: FUNCTION delete_page_forever(target_page uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_page_forever(target_page uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_page_forever(target_page uuid) TO authenticated;


--
-- Name: FUNCTION delete_workspace(ws uuid, confirm_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_workspace(ws uuid, confirm_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_workspace(ws uuid, confirm_name text) TO authenticated;


--
-- Name: FUNCTION departed_page_owners(ws uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.departed_page_owners(ws uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.departed_page_owners(ws uuid) TO authenticated;


--
-- Name: FUNCTION drop_grants_of_removed_member(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.drop_grants_of_removed_member() FROM PUBLIC;


--
-- Name: FUNCTION edit_comment(target_comment uuid, body text, mention_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.edit_comment(target_comment uuid, body text, mention_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.edit_comment(target_comment uuid, body text, mention_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION effective_role(target_page uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.effective_role(target_page uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.effective_role(target_page uuid) TO authenticated;


--
-- Name: FUNCTION email_domain(email text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.email_domain(email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.email_domain(email text) TO authenticated;


--
-- Name: FUNCTION generate_short_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generate_short_id() FROM PUBLIC;


--
-- Name: FUNCTION has_platform_access(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_platform_access() FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_platform_access() TO authenticated;


--
-- Name: FUNCTION hash_token(token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hash_token(token text) FROM PUBLIC;


--
-- Name: FUNCTION hook_before_user_created(event jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hook_before_user_created(event jsonb) FROM PUBLIC;


--
-- Name: FUNCTION invitation_preview(token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.invitation_preview(token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.invitation_preview(token text) TO anon;
GRANT ALL ON FUNCTION public.invitation_preview(token text) TO authenticated;


--
-- Name: FUNCTION invite_member(ws uuid, invitee_email text, invitee_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.invite_member(ws uuid, invitee_email text, invitee_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.invite_member(ws uuid, invitee_email text, invitee_role text) TO authenticated;


--
-- Name: FUNCTION is_active_member(ws uuid, member uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_active_member(ws uuid, member uuid) FROM PUBLIC;


--
-- Name: FUNCTION is_platform_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_platform_admin() TO authenticated;


--
-- Name: FUNCTION is_valid_domain(value text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_valid_domain(value text) FROM PUBLIC;


--
-- Name: FUNCTION is_workspace_admin(ws uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_workspace_admin(ws uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_workspace_admin(ws uuid) TO authenticated;


--
-- Name: FUNCTION is_workspace_member(ws uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_workspace_member(ws uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_workspace_member(ws uuid) TO authenticated;


--
-- Name: FUNCTION join_workspaces(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.join_workspaces() FROM PUBLIC;
GRANT ALL ON FUNCTION public.join_workspaces() TO authenticated;


--
-- Name: FUNCTION log_workspace_action(ws uuid, action text, details jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_workspace_action(ws uuid, action text, details jsonb) FROM PUBLIC;


--
-- Name: FUNCTION mark_blocks(blocks jsonb, ranges jsonb, thread text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_blocks(blocks jsonb, ranges jsonb, thread text) FROM PUBLIC;


--
-- Name: FUNCTION mark_inline(nodes jsonb, start_pos integer, end_pos integer, thread text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_inline(nodes jsonb, start_pos integer, end_pos integer, thread text) FROM PUBLIC;


--
-- Name: FUNCTION mention_candidates(target_page uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mention_candidates(target_page uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mention_candidates(target_page uuid) TO authenticated;


--
-- Name: FUNCTION move_page(target_page uuid, new_parent uuid, new_index integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.move_page(target_page uuid, new_parent uuid, new_index integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_page(target_page uuid, new_parent uuid, new_index integer) TO authenticated;


--
-- Name: TABLE pages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.pages TO authenticated;


--
-- Name: FUNCTION my_role(page public.pages); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_role(page public.pages) FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_role(page public.pages) TO authenticated;


--
-- Name: FUNCTION page_content_limit(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.page_content_limit() FROM PUBLIC;


--
-- Name: FUNCTION page_error(code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.page_error(code text) FROM PUBLIC;


--
-- Name: FUNCTION page_plain_text(doc jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.page_plain_text(doc jsonb) FROM PUBLIC;


--
-- Name: FUNCTION page_role_of(target_page uuid, member uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.page_role_of(target_page uuid, member uuid) FROM PUBLIC;


--
-- Name: FUNCTION page_sharing(target_page uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.page_sharing(target_page uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.page_sharing(target_page uuid) TO authenticated;


--
-- Name: FUNCTION page_subtree(root uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.page_subtree(root uuid) FROM PUBLIC;


--
-- Name: FUNCTION place_page(moved uuid, new_parent uuid, new_index integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.place_page(moved uuid, new_parent uuid, new_index integer) FROM PUBLIC;


--
-- Name: FUNCTION platform_workspaces(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.platform_workspaces() FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_workspaces() TO authenticated;


--
-- Name: FUNCTION profile_stats(ws uuid, person uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.profile_stats(ws uuid, person uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.profile_stats(ws uuid, person uuid) TO authenticated;


--
-- Name: FUNCTION purge_trash(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.purge_trash() FROM PUBLIC;


--
-- Name: FUNCTION reassign_member_pages(ws uuid, from_user uuid, to_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reassign_member_pages(ws uuid, from_user uuid, to_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reassign_member_pages(ws uuid, from_user uuid, to_user uuid) TO authenticated;


--
-- Name: FUNCTION record_page_contribution(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_page_contribution() FROM PUBLIC;


--
-- Name: FUNCTION refresh_page_mentions(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_page_mentions() FROM PUBLIC;


--
-- Name: FUNCTION refresh_thread_status(target_page uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_thread_status(target_page uuid) FROM PUBLIC;


--
-- Name: FUNCTION register_attachment(target_page uuid, file_type text, file_bytes integer, file_width integer, file_height integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.register_attachment(target_page uuid, file_type text, file_bytes integer, file_width integer, file_height integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_attachment(target_page uuid, file_type text, file_bytes integer, file_width integer, file_height integer) TO authenticated;


--
-- Name: FUNCTION remember_deleted_attachment(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remember_deleted_attachment() FROM PUBLIC;


--
-- Name: FUNCTION remove_member(ws uuid, member uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remove_member(ws uuid, member uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_member(ws uuid, member uuid) TO authenticated;


--
-- Name: FUNCTION remove_workspace_domain(ws uuid, target_domain text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remove_workspace_domain(ws uuid, target_domain text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_workspace_domain(ws uuid, target_domain text) TO authenticated;


--
-- Name: FUNCTION rename_page(target_page uuid, new_title text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rename_page(target_page uuid, new_title text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rename_page(target_page uuid, new_title text) TO authenticated;


--
-- Name: FUNCTION rename_workspace(ws uuid, new_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rename_workspace(ws uuid, new_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rename_workspace(ws uuid, new_name text) TO authenticated;


--
-- Name: FUNCTION reply_to_thread(target_thread uuid, body text, mention_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reply_to_thread(target_thread uuid, body text, mention_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reply_to_thread(target_thread uuid, body text, mention_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION restore_page(target_page uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.restore_page(target_page uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.restore_page(target_page uuid) TO authenticated;


--
-- Name: FUNCTION revoke_invitation(ws uuid, target_invitation uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.revoke_invitation(ws uuid, target_invitation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revoke_invitation(ws uuid, target_invitation uuid) TO authenticated;


--
-- Name: FUNCTION role_rank(page_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.role_rank(page_role text) FROM PUBLIC;


--
-- Name: FUNCTION save_page_content(target_page uuid, new_content jsonb, base_version integer, force boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_page_content(target_page uuid, new_content jsonb, base_version integer, force boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_page_content(target_page uuid, new_content jsonb, base_version integer, force boolean) TO authenticated;


--
-- Name: FUNCTION search_pages(ws uuid, query text, root uuid, max_depth integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.search_pages(ws uuid, query text, root uuid, max_depth integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.search_pages(ws uuid, query text, root uuid, max_depth integer) TO authenticated;


--
-- Name: FUNCTION search_query(raw text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.search_query(raw text) FROM PUBLIC;


--
-- Name: FUNCTION set_member_role(ws uuid, member uuid, new_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_member_role(ws uuid, member uuid, new_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_member_role(ws uuid, member uuid, new_role text) TO authenticated;


--
-- Name: FUNCTION set_my_preferences(new_theme text, new_locale text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_my_preferences(new_theme text, new_locale text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_my_preferences(new_theme text, new_locale text) TO authenticated;


--
-- Name: FUNCTION set_my_profile_visibility(ws uuid, visibility text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_my_profile_visibility(ws uuid, visibility text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_my_profile_visibility(ws uuid, visibility text) TO authenticated;


--
-- Name: FUNCTION set_open_registration(open boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_open_registration(open boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_open_registration(open boolean) TO authenticated;


--
-- Name: FUNCTION set_page_cover(target_page uuid, new_cover jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_page_cover(target_page uuid, new_cover jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_page_cover(target_page uuid, new_cover jsonb) TO authenticated;


--
-- Name: FUNCTION set_page_icon(target_page uuid, new_icon text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_page_icon(target_page uuid, new_icon text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_page_icon(target_page uuid, new_icon text) TO authenticated;


--
-- Name: FUNCTION set_page_inherit(target_page uuid, new_inherit boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_page_inherit(target_page uuid, new_inherit boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_page_inherit(target_page uuid, new_inherit boolean) TO authenticated;


--
-- Name: FUNCTION set_page_member_role(target_page uuid, member uuid, new_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_page_member_role(target_page uuid, member uuid, new_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_page_member_role(target_page uuid, member uuid, new_role text) TO authenticated;


--
-- Name: FUNCTION set_page_workspace_role(target_page uuid, new_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_page_workspace_role(target_page uuid, new_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_page_workspace_role(target_page uuid, new_role text) TO authenticated;


--
-- Name: FUNCTION set_thread_resolved(target_thread uuid, resolved boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_thread_resolved(target_thread uuid, resolved boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_thread_resolved(target_thread uuid, resolved boolean) TO authenticated;


--
-- Name: FUNCTION set_workspace_domain_active(ws uuid, target_domain text, active boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_workspace_domain_active(ws uuid, target_domain text, active boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_workspace_domain_active(ws uuid, target_domain text, active boolean) TO authenticated;


--
-- Name: FUNCTION shared_with_workspace(page public.pages); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.shared_with_workspace(page public.pages) FROM PUBLIC;
GRANT ALL ON FUNCTION public.shared_with_workspace(page public.pages) TO authenticated;


--
-- Name: FUNCTION shares_workspace_with(other uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.shares_workspace_with(other uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.shares_workspace_with(other uuid) TO authenticated;


--
-- Name: FUNCTION sync_profile_from_auth_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_profile_from_auth_user() FROM PUBLIC;


--
-- Name: FUNCTION transfer_page_ownership(target_page uuid, new_owner uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.transfer_page_ownership(target_page uuid, new_owner uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.transfer_page_ownership(target_page uuid, new_owner uuid) TO authenticated;


--
-- Name: FUNCTION transfer_workspace_ownership(ws uuid, new_owner uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.transfer_workspace_ownership(ws uuid, new_owner uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.transfer_workspace_ownership(ws uuid, new_owner uuid) TO authenticated;


--
-- Name: FUNCTION trash_page(target_page uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.trash_page(target_page uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.trash_page(target_page uuid) TO authenticated;


--
-- Name: FUNCTION update_page_search(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_page_search() FROM PUBLIC;


--
-- Name: FUNCTION workspace_login_hint(ws_short_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_login_hint(ws_short_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_login_hint(ws_short_id text) TO anon;
GRANT ALL ON FUNCTION public.workspace_login_hint(ws_short_id text) TO authenticated;


--
-- Name: FUNCTION workspace_role(ws uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_role(ws uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_role(ws uuid) TO authenticated;


--
-- Name: FUNCTION workspace_storage_status(ws uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_storage_status(ws uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_storage_status(ws uuid) TO authenticated;


--
-- Name: FUNCTION ws_error(code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ws_error(code text) FROM PUBLIC;


--
-- Name: TABLE attachments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.attachments TO authenticated;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.audit_log TO authenticated;


--
-- Name: TABLE comment_threads; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.comment_threads TO authenticated;


--
-- Name: TABLE comments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.comments TO authenticated;


--
-- Name: TABLE invitations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.invitations TO authenticated;


--
-- Name: TABLE page_access; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.page_access TO authenticated;


--
-- Name: TABLE page_mentions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.page_mentions TO authenticated;


--
-- Name: TABLE platform_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.platform_settings TO authenticated;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE public_email_domains; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.public_email_domains TO authenticated;


--
-- Name: TABLE workspace_domains; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.workspace_domains TO authenticated;


--
-- Name: TABLE workspace_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.workspace_members TO authenticated;


--
-- Name: TABLE workspaces; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.workspaces TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;


--
-- PostgreSQL database dump complete
--


