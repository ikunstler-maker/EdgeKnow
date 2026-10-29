-- Limits on how often one person may call the expensive parts of the site
-- (stage 2, protection): fetching link previews, uploads, feedback, sign-in
-- passes for team databases, saving. One counter per person, kind and time
-- window; the server asks before doing the work and answers "too many
-- requests" past the limit. Old counters are cleared daily.
-- Rollback: supabase/rollbacks/20261117100000_rate_limits.down.sql

create table public.rate_limits (
  user_id       uuid not null,
  bucket        text not null,
  window_start  timestamptz not null,
  hits          integer not null default 1,
  primary key (user_id, bucket, window_start)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;

-- True while the caller is within the limit (and counts this call).
create function public.hit_rate_limit(kind text, max_hits integer, window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  started timestamptz;
  used integer;
begin
  if me is null or kind !~ '^[a-z_]{1,40}$' or max_hits not between 1 and 10000 or window_seconds not between 10 and 86400 then
    return false;
  end if;
  started := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
  insert into public.rate_limits as r (user_id, bucket, window_start, hits)
  values (me, kind, started, 1)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + 1
  returning hits into used;
  return used <= max_hits;
end;
$$;
revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.hit_rate_limit(text, integer, integer) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, delete on public.rate_limits to service_role;
  end if;
end;
$$;
