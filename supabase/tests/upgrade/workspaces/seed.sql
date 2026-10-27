-- State before workspaces, shaped like production after stages 1–2:
-- two admins and a regular user on iyo.gg, an audit trail, a page tree and the trash.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000001', 'elaidzha_motion.designer@iyo.gg', now() - interval '3 days', '{"full_name":"Elaidzha"}'),
 ('10000000-0000-0000-0000-000000000002', 'daniil_head.of.design@iyo.gg', now() - interval '2 days', '{"full_name":"Daniil"}'),
 ('10000000-0000-0000-0000-000000000003', 'colleague@iyo.gg', now() - interval '1 day', '{}');
update public.profiles set created_at = now() - interval '3 days' where email like 'elaidzha%';
update public.profiles set is_admin = true where email in ('elaidzha_motion.designer@iyo.gg', 'daniil_head.of.design@iyo.gg');
insert into public.admin_audit_log (actor_id, action, details) values
 ('10000000-0000-0000-0000-000000000001', 'domain_added', '{"domain":"gmail.com"}'),
 ('10000000-0000-0000-0000-000000000001', 'domain_removed', '{"domain":"gmail.com"}');

set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select public.create_page(null, 'Креатив') ->> 'id' as kreatyv \gset
select public.create_page(:'kreatyv', 'Гайдлайни') ->> 'id' as guides \gset
select public.create_page(:'guides', 'Логотип') ->> 'id' as logo \gset
select public.create_page(null, 'Баїнг') ->> 'id' as buying \gset
select public.trash_page(:'buying') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select public.create_page(null, 'Daniil notes') ->> 'id' as notes \gset
reset role;
