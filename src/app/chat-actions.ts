"use server";

import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { dataClient, writeClient } from "@/lib/team-db/data";
import { CHIP_SERVICES, type ChatChip, type ChipRef, type ChipService } from "@/lib/chat-chips";
import { MESSAGE_PAGE, type ChatCategory, type ChatCategoryAccess, type ChatChannel, type ChatMember, type ChatMessage, type ChatFile, type ChatNotify, type ChatReaction, type ChatScheduled, type ChatSearchHit } from "@/lib/chat";

// Toker: the screen's reads and changes. The database decides who sees and does
// what (chat_* functions, row level security); these only forward to wherever the
// workspace keeps its data. No page re-render: the screen keeps its own state.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MESSAGE_COLUMNS = "id, channel_id, author_id, thread_root_id, body, mentions, created_at, edited_at, deleted_at, pinned_at, reply_count, last_reply_at, file_count";

async function call<T extends object = object>(shortId: string, fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const supabase = await writeClient(shortId);
  if (!supabase) return { ok: false, error: "team_setup" };
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<T>;
}

const ids = (list: string[]) => list.filter((id) => UUID.test(id));

// ---------------------------------------------------------------- reading

export async function loadChat(shortId: string, workspaceId: string): Promise<{ channels: ChatChannel[]; categories: ChatCategory[] } | null> {
  if (!UUID.test(workspaceId)) return null;
  // Messages planned for later whose time has come go out first (anyone's open page sends them).
  await sendDue(shortId, workspaceId);
  const supabase = await dataClient(shortId);
  const [{ data: channels, error }, { data: categories }] = await Promise.all([
    supabase.rpc("chat_my_channels", { ws: workspaceId }),
    supabase.from("chat_categories").select("id, name, position, restricted").eq("workspace_id", workspaceId).order("position"),
  ]);
  if (error) return null;
  return { channels: (channels ?? []) as ChatChannel[], categories: (categories ?? []) as ChatCategory[] };
}

// Top messages of a channel, newest first from the database (the screen sorts):
// the latest page, or the page before a moment.
export async function loadMessages(shortId: string, channelId: string, before: string | null): Promise<ChatMessage[] | null> {
  if (!UUID.test(channelId)) return null;
  const supabase = await dataClient(shortId);
  let query = supabase.from("chat_messages").select(MESSAGE_COLUMNS).eq("channel_id", channelId).is("thread_root_id", null);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(MESSAGE_PAGE);
  if (error) return null;
  return (data ?? []) as ChatMessage[];
}

// Single messages again (after a live signal: new, changed or deleted).
export async function loadMessagesById(shortId: string, messageIds: string[]): Promise<ChatMessage[]> {
  const wanted = ids(messageIds).slice(0, 100);
  if (!wanted.length) return [];
  const supabase = await dataClient(shortId);
  const { data } = await supabase.from("chat_messages").select(MESSAGE_COLUMNS).in("id", wanted);
  return (data ?? []) as ChatMessage[];
}

// A thread: its replies, oldest first (at most the latest 500).
export async function loadThread(shortId: string, rootId: string): Promise<ChatMessage[] | null> {
  if (!UUID.test(rootId)) return null;
  const supabase = await dataClient(shortId);
  const { data, error } = await supabase
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("thread_root_id", rootId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return null;
  return ((data ?? []) as ChatMessage[]).reverse();
}

// Pinned messages of a channel, newest pin first.
export async function loadPinned(shortId: string, channelId: string): Promise<ChatMessage[]> {
  if (!UUID.test(channelId)) return [];
  const supabase = await dataClient(shortId);
  const { data } = await supabase.from("chat_messages").select(MESSAGE_COLUMNS).eq("channel_id", channelId).not("pinned_at", "is", null).order("pinned_at", { ascending: false }).limit(50);
  return (data ?? []) as ChatMessage[];
}

// Files of messages (the database gives only those of messages the person sees).
export async function loadFiles(shortId: string, messageIds: string[]): Promise<ChatFile[]> {
  const wanted = ids(messageIds).slice(0, 200);
  if (!wanted.length) return [];
  const supabase = await dataClient(shortId);
  const { data } = await supabase
    .from("chat_files")
    .select("id, message_id, name, mime_type, bytes, kind, duration_ms, width, height, waveform")
    .in("message_id", wanted)
    .order("created_at")
    .limit(2000);
  return (data ?? []) as ChatFile[];
}

export async function searchChat(shortId: string, workspaceId: string, query: string, channelId: string | null = null): Promise<ChatSearchHit[]> {
  if (!UUID.test(workspaceId) || query.trim().length < 2) return [];
  const supabase = await dataClient(shortId);
  const { data } = await supabase.rpc("chat_search", { ws: workspaceId, query: query.trim().slice(0, 200), ch: channelId && UUID.test(channelId) ? channelId : null });
  return (data ?? []) as ChatSearchHit[];
}

export async function loadScheduled(shortId: string, workspaceId: string): Promise<ChatScheduled[]> {
  if (!UUID.test(workspaceId)) return [];
  const supabase = await dataClient(shortId);
  const { data } = await supabase.from("chat_scheduled").select("id, channel_id, thread_root_id, body, send_at").eq("workspace_id", workspaceId).order("send_at");
  return (data ?? []) as ChatScheduled[];
}

// Sends what is due (an older database without the function simply has none).
export async function sendDue(shortId: string, workspaceId: string) {
  const writer = await writeClient(shortId);
  if (writer && UUID.test(workspaceId)) await writer.rpc("chat_send_due", { ws: workspaceId });
}

export async function loadReactions(shortId: string, messageIds: string[]): Promise<ChatReaction[]> {
  const wanted = ids(messageIds).slice(0, 200);
  if (!wanted.length) return [];
  const supabase = await dataClient(shortId);
  const { data } = await supabase.from("chat_reactions").select("message_id, user_id, emoji, created_at").in("message_id", wanted).order("created_at").limit(5000);
  return (data ?? []) as ChatReaction[];
}

export async function loadMembers(shortId: string, channelId: string): Promise<ChatMember[]> {
  if (!UUID.test(channelId)) return [];
  const supabase = await dataClient(shortId);
  const { data } = await supabase.from("chat_channel_members").select("user_id, role, invited, history_from, can_post").eq("channel_id", channelId).limit(2000);
  return (data ?? []) as ChatMember[];
}

// Owner and admins only (the database returns nothing to others).
export async function loadCategoryAccess(shortId: string, categoryId: string): Promise<ChatCategoryAccess[]> {
  if (!UUID.test(categoryId)) return [];
  const supabase = await dataClient(shortId);
  const { data } = await supabase.from("chat_category_access").select("group_id, user_id").eq("category_id", categoryId);
  return (data ?? []) as ChatCategoryAccess[];
}

// ---------------------------------------------------------------- channels

export async function createChannel(
  shortId: string,
  workspaceId: string,
  input: { name: string; topic: string; closed: boolean; categoryId: string | null; unitId: string | null },
) {
  return call<{ id: string }>(shortId, "chat_create_channel", {
    ws: workspaceId,
    cat: input.categoryId,
    new_name: input.name,
    new_topic: input.topic,
    is_closed: input.closed,
    unit: input.closed ? input.unitId : null,
  });
}

export async function updateChannel(shortId: string, channelId: string, input: { name: string; topic: string; categoryId: string | null; unitId: string | null }) {
  return call(shortId, "chat_update_channel", { ch: channelId, new_name: input.name, new_topic: input.topic, new_category: input.categoryId, new_unit: input.unitId });
}

export async function archiveChannel(shortId: string, channelId: string, archived: boolean) {
  return call(shortId, "chat_archive_channel", { ch: channelId, archived });
}

export async function deleteChannel(shortId: string, channelId: string) {
  return call(shortId, "chat_delete_channel", { ch: channelId });
}

export async function joinChannel(shortId: string, channelId: string) {
  return call(shortId, "chat_join_channel", { ch: channelId });
}

export async function leaveChannel(shortId: string, channelId: string) {
  return call(shortId, "chat_leave_channel", { ch: channelId });
}

// showHistory: null — as the channel says; true / false — chosen for these people.
export async function addMembers(shortId: string, channelId: string, userIds: string[], showHistory: boolean | null = null) {
  return call(shortId, "chat_add_members", { ch: channelId, user_ids: ids(userIds), show_history: showHistory });
}

export async function openDirect(shortId: string, workspaceId: string, people: string[]) {
  return call<{ id: string }>(shortId, "chat_open_direct", { ws: workspaceId, people: ids(people) });
}

export async function setHistoryVisible(shortId: string, channelId: string, visible: boolean) {
  return call(shortId, "chat_set_history_visible", { ch: channelId, visible });
}

export async function setPostPolicy(shortId: string, channelId: string, policy: "everyone" | "chosen") {
  return call(shortId, "chat_set_post_policy", { ch: channelId, policy });
}

export async function setMemberCanPost(shortId: string, channelId: string, userId: string, allowed: boolean) {
  return call(shortId, "chat_set_member_can_post", { ch: channelId, person: userId, allowed });
}

export async function setMemberHistory(shortId: string, channelId: string, userId: string, show: boolean) {
  return call(shortId, "chat_set_member_history", { ch: channelId, person: userId, show });
}

export async function removeMember(shortId: string, channelId: string, userId: string) {
  return call(shortId, "chat_remove_member", { ch: channelId, person: userId });
}

export async function setMemberRole(shortId: string, channelId: string, userId: string, role: "owner" | "member") {
  return call(shortId, "chat_set_member_role", { ch: channelId, person: userId, new_role: role });
}

export async function markRead(shortId: string, channelId: string) {
  return call(shortId, "chat_mark_read", { ch: channelId, up_to: null });
}

export async function setNotify(shortId: string, channelId: string, level: ChatNotify) {
  return call(shortId, "chat_set_notify", { ch: channelId, level });
}

// ---------------------------------------------------------------- messages

export async function postMessage(shortId: string, channelId: string, body: string, threadRootId: string | null = null, mentions: string[] = [], fileIds: string[] = []) {
  return call<{ id: string }>(shortId, "chat_post_message", { ch: channelId, new_body: body, thread_root: threadRootId, mention_ids: ids(mentions), file_ids: ids(fileIds) });
}

export async function editMessage(shortId: string, messageId: string, body: string, mentions: string[] = []) {
  return call(shortId, "chat_edit_message", { msg: messageId, new_body: body, mention_ids: ids(mentions) });
}

export async function scheduleMessage(shortId: string, channelId: string, body: string, at: string, threadRootId: string | null = null, mentions: string[] = []) {
  return call<{ id: string }>(shortId, "chat_schedule_message", { ch: channelId, new_body: body, thread_root: threadRootId, mention_ids: ids(mentions), at });
}

export async function cancelScheduled(shortId: string, scheduledId: string) {
  return call(shortId, "chat_cancel_scheduled", { target: scheduledId });
}

export async function pinMessage(shortId: string, messageId: string, pinned: boolean) {
  return call(shortId, "chat_pin_message", { msg: messageId, pinned });
}

export async function toggleReaction(shortId: string, messageId: string, emoji: string) {
  return call<{ on: boolean }>(shortId, "chat_toggle_reaction", { msg: messageId, reaction: emoji });
}

export async function deleteMessage(shortId: string, messageId: string) {
  return call(shortId, "chat_delete_message", { msg: messageId });
}

// ---------------------------------------------------------------- categories (owner and admins)

export async function saveCategory(shortId: string, workspaceId: string, categoryId: string | null, name: string, restricted: boolean) {
  return call<{ id: string }>(shortId, "chat_save_category", { ws: workspaceId, cat: categoryId, new_name: name, is_restricted: restricted });
}

export async function deleteCategory(shortId: string, workspaceId: string, categoryId: string) {
  return call(shortId, "chat_delete_category", { ws: workspaceId, cat: categoryId });
}

export async function reorderCategories(shortId: string, workspaceId: string, ordered: string[]) {
  return call(shortId, "chat_reorder_categories", { ws: workspaceId, ordered: ids(ordered) });
}

export async function setCategoryAccess(shortId: string, workspaceId: string, categoryId: string, groupIds: string[], userIds: string[]) {
  return call(shortId, "chat_set_category_access", { ws: workspaceId, cat: categoryId, group_ids: ids(groupIds), user_ids: ids(userIds) });
}

// ---------------------------------------------------------------- live chips (stage 3a)

type ChipTaskRow = { id: string; number: number; project: { key: string } | null };

// What the workspace links of messages point at, as the reader may see them (their
// own access in the database): anything hidden or gone comes back as "none". A task
// comes back as its id only; its card reads it live like a chip on a wiki page.
export async function loadChatChips(shortId: string, workspaceId: string, refs: ChipRef[]): Promise<Record<string, ChatChip>> {
  const result: Record<string, ChatChip> = {};
  if (!UUID.test(workspaceId) || !Array.isArray(refs)) return result;
  const list = refs.slice(0, 40);
  for (const ref of list) result[ref.key] = { kind: "none" };
  const db = await dataClient(shortId);
  const pageIds = list.flatMap((r) => (r.kind === "page" && UUID.test(r.id) ? [r.id] : []));
  const objectIds = list.flatMap((r) => (r.kind === "object" && UUID.test(r.id) && (CHIP_SERVICES as readonly string[]).includes(r.service) ? [r.id] : []));
  const tasks = list.flatMap((r) => (r.kind === "task" && /^[A-Z][A-Z0-9]{1,9}$/.test(r.project) && Number.isInteger(r.number) && r.number > 0 ? [r] : []));
  const [pages, objects, ...taskRows] = await Promise.all([
    pageIds.length ? db.from("pages").select("id, title, icon").eq("workspace_id", workspaceId).in("id", pageIds).is("deleted_at", null) : Promise.resolve({ data: [] }),
    objectIds.length ? db.from("service_objects").select("id, service, title, icon").eq("workspace_id", workspaceId).in("id", objectIds).is("deleted_at", null) : Promise.resolve({ data: [] }),
    ...tasks.map((r) =>
      db
        .from("tasks")
        .select("id, number, project:task_projects!inner(key)")
        .eq("workspace_id", workspaceId)
        .eq("project.key", r.project)
        .eq("number", r.number)
        .is("deleted_at", null)
        .maybeSingle()
        .overrideTypes<ChipTaskRow | null, { merge: false }>(),
    ),
  ]);
  for (const p of (pages.data ?? []) as { id: string; title: string; icon: string | null }[]) result[`page:${p.id}`] = { kind: "page", title: p.title, icon: p.icon };
  for (const o of (objects.data ?? []) as { id: string; service: ChipService; title: string; icon: string | null }[]) {
    // The link's own service must match (a table link never shows a board).
    const ref = list.find((r) => r.kind === "object" && r.id === o.id);
    if (ref?.kind === "object" && ref.service === o.service) result[`object:${o.id}`] = { kind: "object", service: o.service, title: o.title, icon: o.icon };
  }
  for (const { data: row } of taskRows) if (row?.project) result[`task:${row.project.key}-${row.number}`] = { kind: "task", id: row.id };
  return result;
}

// ---------------------------------------------------------------- from a message (stage 3b)

type Block = { type: string; content?: unknown[]; props?: Record<string, unknown> };

// The message (or the chosen part of it) as paragraphs, then "From the chat:" with a
// link back to the message. Plain text only: links stay text the editor shows as is.
function fromMessageBlocks(text: string, link: string, label: string): Block[] {
  const lines = text.slice(0, 4000).split(/\n/);
  return [
    ...lines.map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line, styles: {} }] : [] })),
    { type: "paragraph", content: [{ type: "text", text: `${label} `, styles: {} }, { type: "link", href: link, content: [{ type: "text", text: link, styles: {} }] }] },
  ];
}

// Only links to this site's own chat may go back into a task or a page.
const chatLink = (link: string) => /^https?:\/\/[^/\s]+\/w\/[^/\s]+\/chat\?[\w=&-]{1,200}$/.test(link);

export async function taskFromMessage(shortId: string, projectId: string, title: string, text: string, link: string): Promise<ActionResult<{ id: string; key: string }>> {
  if (!UUID.test(projectId) || !title.trim() || !chatLink(link)) return { ok: false, error: "unknown" };
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const description = fromMessageBlocks(text, link, t.chat.fromMessage.backLink);
  const { data, error } = await db.rpc("create_task", { target_project: projectId, fields: { title: title.trim().slice(0, 300), description } });
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<{ id: string; key: string }>;
}

export async function noteFromMessage(shortId: string, workspaceId: string, title: string, text: string, link: string): Promise<ActionResult<{ id: string }>> {
  if (!UUID.test(workspaceId) || !title.trim() || !chatLink(link)) return { ok: false, error: "unknown" };
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc("create_page", { ws: workspaceId, parent: null, new_title: title.trim().slice(0, 200) });
  const made = data as ActionResult<{ id: string }> | null;
  if (error || !made) return { ok: false, error: "unknown" };
  if (!made.ok) return made;
  const saved = await db.rpc("save_page_content", { target_page: made.id, new_content: fromMessageBlocks(text, link, t.chat.fromMessage.backLink), base_version: 1 });
  if (saved.error || !(saved.data as ActionResult | null)?.ok) return { ok: false, error: "unknown" };
  return made;
}
