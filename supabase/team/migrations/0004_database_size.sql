-- How full the team's project is (path C, step 1.5b): the database and the
-- files in its storage, for the EdgeKnow server's daily check (secret key only).
-- Rollback: supabase/team/rollbacks/0004_database_size.down.sql
create function public.edgeknow_database_size()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'storage_bytes', coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o), 0)
  );
$$;

revoke execute on function public.edgeknow_database_size() from public, anon, authenticated;
grant execute on function public.edgeknow_database_size() to service_role;
