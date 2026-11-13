-- KADRY-1: a presentation's show through a link without signing in (owner's approval
-- 2026-11-13). The deck's owner turns the link on and off; the link holds a secret key
-- (like the survey links and the calendar feed). Through it: the slides only (title, slides,
-- pictures) — nothing else of the workspace, no embeds' contents.
-- Rollback: supabase/rollbacks/20270213100000_kadry_public_show.down.sql

create table public.deck_public_links (
  object_id    uuid primary key references public.service_objects (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  token        text not null unique check (token ~ '^[0-9a-f]{32}$'),
  enabled      boolean not null default true,
  updated_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now()
);
alter table public.deck_public_links enable row level security;

-- Only the deck's owners see its link (and its key).
create policy "Owners of a deck see its show link"
  on public.deck_public_links for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and public.my_object_role(object_id) = 'owner');

-- Turn the link on (a new key when asked, or the first time) or off. Owners of the deck only.
create function public.set_deck_public_link(target uuid, turn_on boolean, renew boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deck public.service_objects;
  key text;
begin
  select * into deck from public.service_objects o where o.id = target and o.deleted_at is null;
  if not found or deck.service <> 'slides' or not public.is_workspace_member(deck.workspace_id) then
    return public.page_error('not_found');
  end if;
  if public.service_object_role(deck.id) is distinct from 'owner' then
    return public.page_error('forbidden');
  end if;
  insert into public.deck_public_links as l (object_id, workspace_id, token, enabled, updated_by, updated_at)
  values (deck.id, deck.workspace_id, replace(gen_random_uuid()::text, '-', ''), turn_on, auth.uid(), now())
  on conflict (object_id) do update set
    enabled = turn_on,
    token = case when renew then replace(gen_random_uuid()::text, '-', '') else l.token end,
    updated_by = auth.uid(),
    updated_at = now()
  returning token into key;
  return jsonb_build_object('ok', true, 'enabled', turn_on, 'token', key);
end;
$$;

-- What the open show page reads with the key (server only).
create function public.public_deck(token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object('ok', true, 'id', o.id, 'title', o.title, 'data', o.data)
    from public.deck_public_links l
    join public.service_objects o on o.id = l.object_id
    where l.token = public_deck.token and l.enabled and o.deleted_at is null and o.service = 'slides'
  ), public.page_error('not_found'));
$$;

revoke all on function public.set_deck_public_link(uuid, boolean, boolean), public.public_deck(text) from public, anon, authenticated;
grant execute on function public.set_deck_public_link(uuid, boolean, boolean) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.public_deck(text) to service_role;
  end if;
end $$;
-- Read through the rule above; written only by set_deck_public_link.
revoke all on public.deck_public_links from public, anon, authenticated;
grant select on public.deck_public_links to authenticated;
