-- Stage 6 checks for comments: threads, rights, server-side marks for commenters,
-- orphaned and resolved threads, mentions, other workspaces.
-- Output is compared with stage6_comments.expected by scripts/test-db.sh.
\pset format unaligned
\pset tuples_only on

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000006a1', 'alice@comments.test', now(), '{"full_name":"Alice"}'),
 ('00000000-0000-0000-0000-0000000006b1', 'bob@comments.test', now(), '{"full_name":"Bob"}'),
 ('00000000-0000-0000-0000-0000000006c1', 'carol@comments.test', now(), '{"full_name":"Carol"}'),
 ('00000000-0000-0000-0000-0000000006d1', 'dave@comments.test', now(), '{"full_name":"Dave"}'),
 ('00000000-0000-0000-0000-0000000006e1', 'eve@other-comments.test', now(), '{"full_name":"Eve"}');

\set alice '00000000-0000-0000-0000-0000000006a1'
\set bob '00000000-0000-0000-0000-0000000006b1'
\set carol '00000000-0000-0000-0000-0000000006c1'
\set dave '00000000-0000-0000-0000-0000000006d1'
\set eve '00000000-0000-0000-0000-0000000006e1'

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Comments') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'comments.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Discussed') ->> 'id' as page \gset
select public.save_page_content(:'page', '[
  {"id":"b1","type":"paragraph","props":{},"content":[{"type":"text","text":"First line","styles":{}}],"children":[]},
  {"id":"b2","type":"paragraph","props":{},"content":[{"type":"text","text":"Hello ","styles":{}},{"type":"text","text":"bold 🙂 world","styles":{"bold":true}},{"type":"link","href":"https://example.com","content":[{"type":"text","text":" link","styles":{}}]}],
   "children":[{"id":"b3","type":"paragraph","props":{},"content":[{"type":"text","text":"Nested text","styles":{}}],"children":[]}]}
]', 1) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dave';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Other comments') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.set_page_member_role(:'page', :'bob', 'commenter') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'page', :'carol', 'viewer') ->> 'ok' as ignored \gset

-- The owner comments; the browser marks the text and saves the page itself.
select public.create_comment_thread(:'page', 'First', 'Is this right, @Bob?', array[:'bob', :'alice', :'eve']::uuid[]) ->> 'id' as t1 \gset
select 'mentions kept: ' || array_to_string(mentions, ',') from public.comments where thread_id = :'t1';
select 'empty comment: ' || (public.create_comment_thread(:'page', 'x', '   ', null))::text;

-- A viewer reads comments but can't write them; dave (no access) and eve see nothing.
set request.jwt.claim.sub = :'carol';
select 'viewer sees threads: ' || count(*) from public.comment_threads;
select 'viewer sees comments: ' || count(*) from public.comments;
select 'viewer comments: ' || (public.create_comment_thread(:'page', 'x', 'hi', null))::text;
select 'viewer replies: ' || (public.reply_to_thread(:'t1', 'hi', null))::text;
select 'viewer resolves: ' || (public.set_thread_resolved(:'t1', true))::text;
set request.jwt.claim.sub = :'dave';
select 'no access sees threads: ' || count(*) from public.comment_threads;
select 'no access replies: ' || (public.reply_to_thread(:'t1', 'hi', null))::text;
select 'no access mentions: ' || (public.mention_candidates(:'page'))::text;
set request.jwt.claim.sub = :'eve';
select 'other workspace sees comments: ' || count(*) from public.comments;
select 'other workspace replies: ' || (public.reply_to_thread(:'t1', 'hi', null))::text;
reset role;

\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = :'bob';
insert into public.comment_threads (workspace_id, page_id) values (:'ws', :'page');
update public.comments set body = 'hacked' where thread_id = :'t1';
reset role;
\set ON_ERROR_STOP 1

-- Bob (commenter) can't save the text, but the server marks his fragment.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'commenter saves text: ' || (public.save_page_content(:'page', '[]', 2))::text;
select 'mention candidates: ' || (select string_agg(p ->> 'name', ', ' order by p ->> 'name') from jsonb_array_elements(public.mention_candidates(:'page') -> 'people') p);
select 'reply: ' || (public.reply_to_thread(:'t1', 'Yes, @Alice', array[:'alice']::uuid[]) ->> 'ok');
select 'stale version: ' || (public.create_marked_comment_thread(:'page', 1, '[{"block":"b2","start":0,"end":5,"text":"Hello"}]', 'old', null))::text;
select 'text mismatch: ' || (public.create_marked_comment_thread(:'page', 2, '[{"block":"b2","start":0,"end":5,"text":"Hellx"}]', 'x', null))::text;
select 'unknown block: ' || (public.create_marked_comment_thread(:'page', 2, '[{"block":"nope","start":0,"end":5,"text":"Hello"}]', 'x', null))::text;
select 'bad range: ' || (public.create_marked_comment_thread(:'page', 2, '[{"block":"b2","start":4,"end":2,"text":""}]', 'x', null))::text;
select 'version unchanged: ' || version from public.pages where id = :'page';
-- Across a style boundary, an emoji and a link, plus a nested block.
select public.create_marked_comment_thread(:'page', 2,
  '[{"block":"b2","start":3,"end":20,"text":"lo bold 🙂 world l"},{"block":"b3","start":0,"end":6,"text":"Nested"}]',
  'Two places', null) ->> 'id' as t2 \gset
select 'marked version: ' || version || ', updated by bob: ' || (updated_by = auth.uid()) from public.pages where id = :'page';
select 'quoted: ' || quoted_text from public.comment_threads where id = :'t2';
select 'b2 after mark: ' || replace((content -> 1 -> 'content')::text, :'t2', 'T2') from public.pages where id = :'page';
select 'b3 after mark: ' || replace((content -> 1 -> 'children' -> 0 -> 'content')::text, :'t2', 'T2') from public.pages where id = :'page';
select 'b1 untouched: ' || (content -> 0)::text from public.pages where id = :'page';
reset role;

-- Edits above the fragment keep the thread open; deleting the fragment orphans it.
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'edit above: ' || (public.save_page_content(:'page',
  jsonb_insert((select content from public.pages where id = :'page'), '{0}',
    '{"id":"b0","type":"paragraph","props":{},"content":[{"type":"text","text":"New first paragraph","styles":{}}],"children":[]}'),
  3) ->> 'ok');
select 'status after edit above: ' || status from public.comment_threads where id = :'t2';
select 'still marked: ' || ((select content from public.pages where id = :'page')::text like '%' || :'t2' || '%');
select 'delete fragment: ' || (public.save_page_content(:'page', '[{"id":"b0","type":"paragraph","props":{},"content":[],"children":[]}]', 4) ->> 'ok');
select 'orphaned: ' || string_agg(status, ', ' order by created_at) from public.comment_threads where page_id = :'page';
select 'resolve: ' || (public.set_thread_resolved(:'t2', true) ->> 'ok');
select 'resolved: ' || status || ', by alice: ' || (resolved_by = auth.uid()) from public.comment_threads where id = :'t2';
select 'reopen: ' || (public.set_thread_resolved(:'t2', false) ->> 'ok');
select 'reopened without fragment: ' || status from public.comment_threads where id = :'t2';

-- Own messages only.
select id as bob_reply from public.comments where thread_id = :'t1' and author_id = :'bob' \gset
select 'edit other''s: ' || (public.edit_comment(:'bob_reply', 'changed', null))::text;
select 'delete other''s: ' || (public.delete_comment(:'bob_reply'))::text;
set request.jwt.claim.sub = :'bob';
select 'edit own: ' || (public.edit_comment(:'bob_reply', 'Yes indeed', null) ->> 'ok');
select 'edited: ' || body || ', edited_at set: ' || (edited_at is not null) from public.comments where id = :'bob_reply';
select 'delete own: ' || (public.delete_comment(:'bob_reply') ->> 'ok');
select 'thread t1 messages: ' || count(*) from public.comments where thread_id = :'t1';
select id as bob_first from public.comments where thread_id = :'t2' \gset
select 'delete last message: ' || (public.delete_comment(:'bob_first') ->> 'ok');
select 'thread t2 gone: ' || count(*) from public.comment_threads where id = :'t2';

-- Losing access to the page hides its comments.
set request.jwt.claim.sub = :'alice';
select public.set_page_member_role(:'page', :'bob', null) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select 'after unshare sees: ' || count(*) from public.comment_threads;
reset role;
