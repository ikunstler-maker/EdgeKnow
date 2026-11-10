-- Wiki confirmations in a team database: frozen page, signatures only for members.
\pset format unaligned
\pset tuples_only on

-- Pages in this file are published when created; drafts have their own test (page drafts).
alter table public.pages alter column published_at set default now();
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.create_page(:'ws', null, 'Team rules') ->> 'id' as page \gset
select 'turned on: ' || (public.set_page_ack(:'page', 'accept', '{}') ->> 'revision');
select 'signed: ' || (public.ack_page(:'page') ->> 'ok');
select 'stats: ' || jsonb_array_length(public.page_ack_stats(:'page', null) -> 'signed');
reset role;
set role authenticated;
:as_bob;
select 'rename frozen: ' || coalesce(public.rename_page(:'page', 'X')::text, 'null');
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member) signs: ' || (public.ack_page(:'page') ->> 'error') || ', sees: ' || (select count(*) from public.page_acks);
reset role;

reset role;
alter table public.pages alter column published_at drop default;
