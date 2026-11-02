-- Boards, step Д3a: voting on sticky notes and a shared timer.
-- The same in supabase/team/migrations/0019_board_sessions.sql.
-- Rollback: supabase/rollbacks/20261202100000_board_sessions.down.sql

-- One board's shared session: voting (each person has N votes on its sticky
-- notes) and a timer everyone on the board sees.
create table public.board_sessions (
  object_id         uuid primary key references public.service_objects (id) on delete cascade,
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  votes_per_person  integer check (votes_per_person between 1 and 20),
  voting_open       boolean not null default false,
  timer_ends_at     timestamptz,
  timer_seconds     integer check (timer_seconds between 10 and 7200),
  updated_by        uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz not null default now()
);
create table public.board_votes (
  object_id     uuid not null references public.service_objects (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  element_id    text not null check (char_length(element_id) between 1 and 64),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (object_id, element_id, user_id)
);
create index board_votes_user_idx on public.board_votes (object_id, user_id);

-- Read and changed only through the functions below.
alter table public.board_sessions enable row level security;
alter table public.board_votes enable row level security;
revoke all on public.board_sessions from public, anon, authenticated;
revoke all on public.board_votes from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.board_sessions, public.board_votes to service_role;
  end if;
end $$;

create function public.check_board_session_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select o.workspace_id from public.service_objects o where o.id = new.object_id and o.service = 'boards') then
    raise exception 'session and board must be in the same workspace';
  end if;
  return new;
end;
$$;
create trigger board_sessions_same_workspace before insert or update on public.board_sessions
  for each row execute function public.check_board_session_workspace();
create trigger board_votes_same_workspace before insert or update on public.board_votes
  for each row execute function public.check_board_session_workspace();

-- What everyone on the board sees: the voting, the tally, my own votes, the timer.
create function public.board_session(target_object uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.board_sessions;
begin
  if public.service_object_role(target_object) is null
     or not exists (select 1 from public.service_objects o where o.id = target_object and o.service = 'boards' and o.deleted_at is null) then
    return public.page_error('forbidden');
  end if;
  select * into s from public.board_sessions where object_id = target_object;
  return jsonb_build_object(
    'ok', true,
    'votes_per_person', s.votes_per_person,
    'voting_open', coalesce(s.voting_open, false),
    'timer_ends_at', s.timer_ends_at,
    'timer_seconds', s.timer_seconds,
    'now', now(),
    'tally', coalesce((select jsonb_object_agg(t.element_id, t.n) from (
      select v.element_id, count(*) as n from public.board_votes v where v.object_id = target_object group by v.element_id) t), '{}'::jsonb),
    'mine', coalesce((select jsonb_agg(v.element_id order by v.created_at) from public.board_votes v
                      where v.object_id = target_object and v.user_id = auth.uid()), '[]'::jsonb),
    'voters', (select count(distinct v.user_id) from public.board_votes v where v.object_id = target_object)
  );
end;
$$;

-- Starting (with N votes each, the old votes cleared) or closing the voting: editors.
create function public.set_board_voting(target_object uuid, votes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select o.workspace_id from public.service_objects o where o.id = target_object and o.service = 'boards' and o.deleted_at is null);
begin
  if ws is null or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if votes is not null and votes not between 1 and 20 then
    return public.page_error('invalid');
  end if;
  if votes is not null then
    delete from public.board_votes where object_id = target_object;
  end if;
  insert into public.board_sessions as s (object_id, workspace_id, votes_per_person, voting_open, updated_by, updated_at)
  values (target_object, ws, votes, votes is not null, auth.uid(), now())
  on conflict (object_id) do update
    set votes_per_person = coalesce(excluded.votes_per_person, s.votes_per_person),
        voting_open = excluded.voting_open, updated_by = auth.uid(), updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- A vote for a sticky note, or taking it back: everyone who may comment, within their N.
create function public.toggle_board_vote(target_object uuid, target_element text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select o.workspace_id from public.service_objects o where o.id = target_object and o.service = 'boards' and o.deleted_at is null);
  s public.board_sessions;
begin
  if ws is null or public.role_rank(public.service_object_role(target_object)) < public.role_rank('commenter') then
    return public.page_error('forbidden');
  end if;
  select * into s from public.board_sessions where object_id = target_object;
  if s.object_id is null or not s.voting_open then
    return public.page_error('voting_closed');
  end if;
  if char_length(coalesce(target_element, '')) not between 1 and 64 then
    return public.page_error('invalid');
  end if;
  if exists (select 1 from public.board_votes v where v.object_id = target_object and v.element_id = target_element and v.user_id = auth.uid()) then
    delete from public.board_votes where object_id = target_object and element_id = target_element and user_id = auth.uid();
    return jsonb_build_object('ok', true, 'voted', false);
  end if;
  if (select count(*) from public.board_votes v where v.object_id = target_object and v.user_id = auth.uid()) >= s.votes_per_person then
    return public.page_error('no_votes_left');
  end if;
  insert into public.board_votes (object_id, workspace_id, element_id, user_id) values (target_object, ws, target_element, auth.uid());
  return jsonb_build_object('ok', true, 'voted', true);
end;
$$;

-- The shared timer: started for N seconds, or stopped (null): editors.
create function public.set_board_timer(target_object uuid, seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select o.workspace_id from public.service_objects o where o.id = target_object and o.service = 'boards' and o.deleted_at is null);
begin
  if ws is null or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if seconds is not null and seconds not between 10 and 7200 then
    return public.page_error('invalid');
  end if;
  insert into public.board_sessions as s (object_id, workspace_id, timer_ends_at, timer_seconds, updated_by, updated_at)
  values (target_object, ws, case when seconds is not null then now() + make_interval(secs => seconds) end, seconds, auth.uid(), now())
  on conflict (object_id) do update
    set timer_ends_at = excluded.timer_ends_at, timer_seconds = coalesce(excluded.timer_seconds, s.timer_seconds),
        updated_by = auth.uid(), updated_at = now();
  return jsonb_build_object('ok', true, 'timer_ends_at', (select timer_ends_at from public.board_sessions where object_id = target_object));
end;
$$;

revoke execute on function public.check_board_session_workspace() from public, anon, authenticated;
revoke execute on function public.board_session(uuid) from public, anon;
revoke execute on function public.set_board_voting(uuid, integer) from public, anon;
revoke execute on function public.toggle_board_vote(uuid, text) from public, anon;
revoke execute on function public.set_board_timer(uuid, integer) from public, anon;
grant execute on function public.board_session(uuid) to authenticated;
grant execute on function public.set_board_voting(uuid, integer) to authenticated;
grant execute on function public.toggle_board_vote(uuid, text) to authenticated;
grant execute on function public.set_board_timer(uuid, integer) to authenticated;
