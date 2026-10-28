-- Stand-in for a team's Supabase project, on top of supabase/tests/supabase_stub.sql:
-- the roles Supabase has and auth.jwt() as PostgREST fills it from the token.
do $$
declare r text;
begin
  foreach r in array array['service_role', 'authenticator'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
    -- The secret key bypasses row level security, as on Supabase.
    if r = 'service_role' then
      execute 'alter role service_role bypassrls';
    end if;
  end loop;
end $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant execute on function auth.jwt() to public;
grant usage on schema public to service_role;
-- Like Supabase: the secret key's role gets everything created in public.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
