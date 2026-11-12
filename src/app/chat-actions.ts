"use server";

import type { ActionResult } from "@/lib/action-result";
import { dataClient, writeClient } from "@/lib/team-db/data";
import { MESSAGE_PAGE, type ChatCategory, type ChatCategoryAccess, type ChatChannel, type ChatMember, type ChatMessage, type ChatNotify } from "@/lib/chat";

// Toker: the screen's reads and changes. The database decides who sees and does
// what (chat_* functions, row level security); these only forward to wherever the
// workspace keeps its data. No page re-render: the screen keeps its own state.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MESSAGE_COLUMNS = "id, channel_id, author_id, thread_root_id, body, mentions, created_at, edited_at, deleted_at, pinned_at, reply_count, last_reply_at";

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

export async function loadMembers(shortId: string, channelId: string): Promise<ChatMember[]> {
  if (!UUID.test(channelId)) return [];
  const supabase = await dataClient(shortId);
  const { data } = await supabase.from("chat_channel_members").select("user_id, role, invited").eq("channel_id", channelId).limit(2000);
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

export async function addMembers(shortId: string, channelId: string, userIds: string[]) {
  return call(shortId, "chat_add_members", { ch: channelId, user_ids: ids(userIds) });
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

export async function postMessage(shortId: string, channelId: string, body: string, threadRootId: string | null = null) {
  return call<{ id: string }>(shortId, "chat_post_message", { ch: channelId, new_body: body, thread_root: threadRootId, mention_ids: null });
}

export async function editMessage(shortId: string, messageId: string, body: string) {
  return call(shortId, "chat_edit_message", { msg: messageId, new_body: body, mention_ids: null });
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
