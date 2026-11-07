-- Rollback: supabase/rollbacks/20261217100000_external_sources.down.sql
-- Wiki pages fed from an external Markdown address (e.g. another service's help).
-- The server fetches the address (with an optional secret key) every hour and writes
-- the result into the page; the page is read-only in the editor while it has a source.
-- The key is encrypted by the server and this table is server-only: no policies,
-- nothing for anon/authenticated. page_id has no foreign key because the page may
-- live in the team's own database (path C).
-- Several languages: one address with {lang}; the main one is written into the page.

create table public.external_sources (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  page_id           uuid not null unique,
  url               text not null check (char_length(url) between 9 and 2000 and url like 'https://%'),
  secret_encrypted  text,
  -- Languages of the source, main first; the URL holds {lang} when there are several.
  -- The main language is the page's content (searchable); the others live here.
  languages         text[] not null default '{}' check (cardinality(languages) <= 5
                      and array_to_string(languages, ',') ~ '^([a-z]{2}(,[a-z]{2})*)?$'),
  translations      jsonb not null default '{}'::jsonb,
  etag              text,
  last_modified     text,
  synced_at         timestamptz,
  last_error        text check (last_error is null or char_length(last_error) <= 200),
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index external_sources_workspace_idx on public.external_sources (workspace_id);

alter table public.external_sources enable row level security;
-- No policies: only the server (secret key) reads or writes this table.
revoke all on public.external_sources from anon, authenticated;
