// SQL a team runs in its own Supabase project (SQL editor) for the live check:
// a "who am I" function, and the guard that lets tokens from EdgeKnow act only as
// a plain signed-in person, never as an admin role, even if our key leaked.
export function teamCheckSql(issuer: string) {
  const quoted = issuer.replace(/'/g, "''");
  return `-- EdgeKnow: перевірка входу
create or replace function public.edgeknow_whoami()
returns jsonb language sql stable as $$
  select jsonb_build_object('uid', auth.uid(), 'role', current_user, 'iss', auth.jwt() ->> 'iss')
$$;
revoke execute on function public.edgeknow_whoami() from public, anon;
grant execute on function public.edgeknow_whoami() to authenticated;

create or replace function public.edgeknow_guard()
returns void language plpgsql as $$
begin
  if auth.jwt() ->> 'iss' = '${quoted}' and coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise exception 'EdgeKnow tokens are for signed-in people only' using errcode = '42501';
  end if;
end;
$$;
alter role authenticator set pgrst.db_pre_request = 'public.edgeknow_guard';
notify pgrst, 'reload config';
`;
}
