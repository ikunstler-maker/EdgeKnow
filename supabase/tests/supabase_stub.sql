-- Minimal stand-in for the parts of Supabase that migrations depend on.
-- Used only by scripts/test-db.sh; never applied to a real project.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'supabase_auth_admin'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
grant usage on schema public to anon, authenticated, supabase_auth_admin;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create schema auth; grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
-- Sessions (devices) as Supabase keeps them; the fields the sessions functions read.
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade, created_at timestamptz default now(), updated_at timestamptz default now(), refreshed_at timestamp, user_agent text, ip inet, not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
-- Storage: just enough of Supabase's storage schema for policies to be created and evaluated.
create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to anon, authenticated;
-- Realtime: the table whose policies decide who may join a private channel and send on it,
-- and the topic of the channel being checked (Realtime sets it for each check).
create schema realtime;
grant usage on schema realtime to anon, authenticated;
create table realtime.messages (
  id uuid primary key default gen_random_uuid(), topic text not null, extension text not null,
  payload jsonb, event text, private boolean default true, inserted_at timestamp default now()
);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;
create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
grant execute on function realtime.topic() to anon, authenticated;
