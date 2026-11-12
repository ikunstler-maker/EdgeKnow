-- Undo 20270117100000_large_attachments.
drop function public.begin_large_task_file(uuid, text, text, bigint);
drop function public.set_project_file_limits(uuid, integer, integer);
drop table public.task_uploads;
-- Records of large attachments go (the files stay on the Drive): they don't fit the old limits.
delete from public.task_files where large;
alter table public.task_files drop constraint task_files_mime_type_check;
alter table public.task_files drop constraint task_files_bytes_check;
alter table public.task_files drop column large;
alter table public.task_files add constraint task_files_bytes_check CHECK (((bytes >= 1) AND (bytes <= CASE WHEN (external_id IS NULL) THEN (4194304)::bigint WHEN (mime_type = 'application/zip'::text) THEN '10737418240'::bigint ELSE (262144000)::bigint END)));
alter table public.task_files add constraint task_files_mime_type_check CHECK ((((external_id IS NOT NULL) AND (storage_backend = 'drive'::text) AND (mime_type ~ '^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,60}$'::text)) OR (mime_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/gif'::text, 'image/webp'::text, 'application/pdf'::text, 'text/plain'::text, 'text/csv'::text, 'application/zip'::text, 'application/msword'::text, 'application/vnd.ms-excel'::text, 'application/vnd.ms-powerpoint'::text, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'::text]))));
alter table public.task_projects drop column zip_limit_mb, drop column file_limit_mb;
