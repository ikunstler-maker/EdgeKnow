-- ADMIN-2: monitoring — only the platform admin reads the workspaces' load and the daily
-- snapshots; names only of her own workspaces; the snapshot is taken by the system alone.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000097a1', 'alice@monitor97.test', now()),
 ('00000000-0000-0000-0000-0000000097b1', 'bob@other97.test', now());
\set alice '00000000-0000-0000-0000-0000000097a1'
\set bob '00000000-0000-0000-0000-0000000097b1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Monitor mine') ->> 'id' as mine \gset
set request.jwt.claim.sub = :'bob';
select public.create_workspace('Monitor theirs') ->> 'id' as theirs \gset

-- Not a platform admin: nothing.
select 'member sees load rows: ' || count(*) from public.platform_workspace_load();
select 'member sees history rows: ' || count(*) from public.platform_stats_history();
select 'member may take a snapshot: ' || coalesce((select 'yes' from (select public.platform_take_snapshot()) x), 'no');
reset role;

-- The system takes today's snapshot (twice: one row a day).
select public.platform_take_snapshot();
select public.platform_take_snapshot();
select 'snapshots today: ' || count(*) from public.platform_daily_stats where day = current_date;

update public.profiles set is_platform_admin = true where id = :'alice';
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'admin sees both workspaces: ' || count(*) from public.platform_workspace_load() where id in (:'mine', :'theirs');
select 'own name shown: ' || coalesce(name, '(hidden)') from public.platform_workspace_load() where id = :'mine';
select 'other name hidden: ' || coalesce(name, '(hidden)') from public.platform_workspace_load() where id = :'theirs';
select 'members counted: ' || members from public.platform_workspace_load() where id = :'mine';
select 'admin sees today in history: ' || count(*) from public.platform_stats_history() where day = current_date;
select 'admin reads the table: ' || count(*) from public.platform_daily_stats where day = current_date;
insert into public.platform_daily_stats (day, database_bytes, storage_bytes, workspaces, members, files_bytes) values (current_date - 1, 1, 1, 1, 1, 1);
reset role;

set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'other member reads the table: ' || count(*) from public.platform_daily_stats;
reset role;
