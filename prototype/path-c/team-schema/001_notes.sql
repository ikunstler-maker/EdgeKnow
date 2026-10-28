-- People live in the central service, so there is no foreign key to auth.users:
-- the team database trusts the "sub" of a token signed with its key.
create table if not exists public.notes (
  id     uuid primary key default gen_random_uuid(),
  owner  uuid not null default auth.uid(),
  body   text not null
);
alter table public.notes enable row level security;
revoke all on public.notes from anon, authenticated;
grant select, insert on public.notes to authenticated;
drop policy if exists "Own notes" on public.notes;
create policy "Own notes" on public.notes for select to authenticated using (owner = auth.uid());
drop policy if exists "Write own notes" on public.notes;
create policy "Write own notes" on public.notes for insert to authenticated with check (owner = auth.uid());
