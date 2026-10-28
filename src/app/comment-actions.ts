"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import type { MarkRange, MentionPerson } from "@/lib/comments";
import { dataClient } from "@/lib/team-db/data";

// Rights are checked by the database functions; these actions forward the call and
// refresh the page so every card shows the latest messages.
async function callCommentRpc<T extends object = object>(
  fn: string,
  args: Record<string, unknown>,
): Promise<ActionResult<T>> {
  const supabase = await dataClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

// Owners and editors: the browser marks the text itself and autosave stores it.
export async function createThread(pageId: string, quoted: string, body: string, mentions: string[]) {
  return callCommentRpc<{ id: string }>("create_comment_thread", {
    target_page: pageId,
    quoted,
    body,
    mention_ids: mentions,
  });
}

// Commenters: the server marks the fragment on the version they're looking at.
export async function createMarkedThread(
  pageId: string,
  baseVersion: number,
  ranges: MarkRange[],
  body: string,
  mentions: string[],
) {
  return callCommentRpc<{ id: string; version: number }>("create_marked_comment_thread", {
    target_page: pageId,
    base_version: baseVersion,
    ranges,
    body,
    mention_ids: mentions,
  });
}

export async function replyToThread(threadId: string, body: string, mentions: string[]) {
  return callCommentRpc("reply_to_thread", { target_thread: threadId, body, mention_ids: mentions });
}

export async function setThreadResolved(threadId: string, resolved: boolean) {
  return callCommentRpc("set_thread_resolved", { target_thread: threadId, resolved });
}

export async function editComment(commentId: string, body: string, mentions: string[]) {
  return callCommentRpc("edit_comment", { target_comment: commentId, body, mention_ids: mentions });
}

export async function deleteComment(commentId: string) {
  return callCommentRpc("delete_comment", { target_comment: commentId });
}

export async function getMentionCandidates(pageId: string): Promise<MentionPerson[]> {
  const supabase = await dataClient();
  const { data } = await supabase.rpc("mention_candidates", { target_page: pageId });
  const people = (data as { ok: boolean; people?: { user_id: string; name: string | null; email: string }[] } | null)
    ?.people;
  return (people ?? []).map((p) => ({ userId: p.user_id, label: p.name || p.email }));
}
