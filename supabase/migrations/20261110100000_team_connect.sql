-- Path C, step 1.5: connecting a team's Supabase project from the wiki.
--
-- The owner signs in to Supabase (OAuth) and the wiki creates or picks the
-- project, installs the team schema, takes its keys and adds EdgeKnow's sign-in.
-- That takes a few minutes, so the registry row exists from the start ("pending")
-- and records which step comes next; the keys arrive along the way.
-- Rollback: supabase/rollbacks/20261110100000_team_connect.down.sql

alter table public.team_databases
  alter column project_url drop not null,
  alter column publishable_key drop not null,
  alter column secret_key_encrypted drop not null,
  add column project_ref text check (project_ref ~ '^[a-z0-9]{20}$'),
  -- Supabase OAuth refresh token (encrypted): lets the wiki update the schema and
  -- wake a paused project. The team can revoke it in its Supabase account.
  add column management_token_encrypted text,
  add column setup_step text check (setup_step in ('project', 'schema', 'keys', 'sync', 'sign_in', 'done')),
  add column connected_by uuid references public.profiles (id) on delete set null,
  -- A connection is usable only with its address and keys.
  add constraint team_databases_ready check (
    status <> 'ok' or (project_url is not null and publishable_key is not null and secret_key_encrypted is not null)
  );

create unique index team_databases_project_ref on public.team_databases (project_ref) where project_ref is not null;
