-- Files of a team workspace (path C, step 1.6) live in the team's own Supabase
-- Storage, in a private bucket. Only the EdgeKnow server touches it (with the
-- team's secret key), after the team database said yes (register_attachment,
-- RLS on attachments); people get short-lived signed links to read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 2097152, array['image/webp', 'image/jpeg', 'image/png', 'image/gif'])
on conflict (id) do nothing;
