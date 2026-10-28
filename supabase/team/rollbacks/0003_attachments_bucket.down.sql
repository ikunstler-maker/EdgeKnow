-- Undo 0003_attachments_bucket.sql. Storage keeps a bucket with files; only an
-- empty one is removed.
delete from storage.buckets b
where b.id = 'attachments' and not exists (select 1 from storage.objects o where o.bucket_id = b.id);
