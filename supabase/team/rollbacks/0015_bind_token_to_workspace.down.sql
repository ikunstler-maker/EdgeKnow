-- Back to checking only the role of EdgeKnow tokens (as in 0002).
create or replace function public.edgeknow_guard()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ours text := (select s.issuer from public.team_settings s);
begin
  if ours is not null and auth.jwt() ->> 'iss' = ours and coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise exception 'EdgeKnow tokens are for signed-in people only' using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.edgeknow_guard() to public;
