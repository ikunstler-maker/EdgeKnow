-- Undo 20261031100000_attachments.sql. Files already uploaded stay in the bucket;
-- remove them in Supabase → Storage if needed.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('collect-attachments');
  end if;
end;
$$;
drop policy if exists "Page owners and uploaders delete files" on storage.objects;
drop policy if exists "Read files of pages you can see" on storage.objects;
drop policy if exists "Upload only to a path registered by the uploader" on storage.objects;
drop function if exists public.register_attachment(uuid, text, integer, integer, integer);
drop function if exists public.collect_unreferenced_attachments();
drop table if exists public.attachments;
drop table if exists public.attachment_tombstones;
drop function if exists public.remember_deleted_attachment();
revoke execute on function public.can_edit_page(uuid) from authenticated;
-- platform_workspaces keeps working (it reports 0 bytes again after re-running M3's version if needed).
