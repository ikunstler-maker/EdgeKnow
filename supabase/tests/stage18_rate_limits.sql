-- Rate limits: counted per person and kind, refused past the limit, nothing
-- for anonymous callers, and the counters are not readable or writable.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000018a1', 'hank@limits.test', now()),
 ('00000000-0000-0000-0000-0000000018b1', 'ivy@limits.test', now());

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000018a1';
select 'hank, three of three: ' || string_agg(public.hit_rate_limit('preview', 3, 3600)::text, ',' order by n) from generate_series(1, 3) n;
select 'hank, the fourth: ' || public.hit_rate_limit('preview', 3, 3600);
select 'hank, another kind: ' || public.hit_rate_limit('upload', 3, 3600);
select 'bad kind: ' || public.hit_rate_limit('Bad-Kind', 3, 3600);
select 'silly limits: ' || public.hit_rate_limit('preview', 0, 3600) || ',' || public.hit_rate_limit('preview', 3, 1);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000018b1';
select 'ivy is counted on her own: ' || public.hit_rate_limit('preview', 3, 3600);
reset role;
select 'counters: ' || count(*) from public.rate_limits where user_id in ('00000000-0000-0000-0000-0000000018a1', '00000000-0000-0000-0000-0000000018b1');

\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000018a1';
select count(*) from public.rate_limits;
delete from public.rate_limits;
set role anon;
select public.hit_rate_limit('preview', 3, 3600);
reset role;
\set ON_ERROR_STOP 1
