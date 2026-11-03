"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { dataClient, writeClient } from "@/lib/team-db/data";
import { workspacePath } from "@/lib/paths";
import { t } from "@/i18n";
import { getWorkspace } from "@/lib/workspace";
import { EMPTY_BOARD } from "@/lib/boards";

// Boards (step Д1): objects of the service "boards" in the shared objects table.
// Every check is in the database functions; these forward the call to wherever
// the workspace keeps its data.

async function call<T extends object = object>(shortId: string, fn: string, args: Record<string, unknown>, refresh = true): Promise<ActionResult<T>> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  if (refresh) revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

export async function createBoard(shortId: string, title?: string) {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return { ok: false, error: "forbidden" } as ActionResult<{ id: string }>;
  return call<{ id: string }>(shortId, "create_service_object", {
    ws: workspace.id,
    target_service: "boards",
    new_kind: "board",
    new_title: (title ?? "").slice(0, 200),
    new_data: EMPTY_BOARD,
  });
}

// Saved often while drawing: no page refresh.
export async function saveBoard(shortId: string, id: string, title: string | null, data: unknown, version: number) {
  return call<{ version: number }>(shortId, "save_service_object", { target_object: id, new_title: title, new_data: data, base_version: version }, false);
}

export async function trashBoard(shortId: string, id: string, restore = false) {
  return call(shortId, "trash_service_object", { target_object: id, restore });
}

export async function deleteBoardForever(shortId: string, id: string) {
  return call(shortId, "delete_service_object_forever", { target_object: id });
}

export async function setBoardWorkspaceRole(shortId: string, id: string, role: string | null) {
  return call(shortId, "set_service_object_workspace_role", { target_object: id, new_role: role });
}

export async function setBoardMemberRole(shortId: string, id: string, member: string, role: string | null) {
  return call(shortId, "set_service_object_member_role", { target_object: id, member, new_role: role });
}

export async function setBoardGroupRole(shortId: string, id: string, group: string, role: string | null) {
  return call(shortId, "set_service_object_group_role", { target_object: id, target_group: group, new_role: role });
}

// Step Д3a: voting and the shared timer (read and changed through the database
// functions, with the person's own access), and tasks from sticky notes.

export type BoardSession = {
  votesPerPerson: number | null;
  votingOpen: boolean;
  timerEndsAt: string | null;
  timerSeconds: number | null;
  // The server's clock, so a countdown is right whatever the device's clock says.
  now: string;
  tally: Record<string, number>;
  mine: string[];
  voters: number;
};

export async function boardSession(shortId: string, id: string): Promise<BoardSession | null> {
  const db = await dataClient(shortId);
  const { data } = await db.rpc("board_session", { target_object: id });
  const row = data as { ok: boolean; votes_per_person: number | null; voting_open: boolean; timer_ends_at: string | null; timer_seconds: number | null; now: string; tally: Record<string, number>; mine: string[]; voters: number } | null;
  if (!row?.ok) return null;
  return { votesPerPerson: row.votes_per_person, votingOpen: row.voting_open, timerEndsAt: row.timer_ends_at, timerSeconds: row.timer_seconds, now: row.now, tally: row.tally, mine: row.mine, voters: row.voters };
}

export async function setBoardVoting(shortId: string, id: string, votes: number | null) {
  return call(shortId, "set_board_voting", { target_object: id, votes }, false);
}

export async function toggleBoardVote(shortId: string, id: string, elementId: string) {
  return call<{ voted: boolean }>(shortId, "toggle_board_vote", { target_object: id, target_element: elementId }, false);
}

export async function setBoardTimer(shortId: string, id: string, seconds: number | null) {
  return call(shortId, "set_board_timer", { target_object: id, seconds }, false);
}

// A task from a sticky note's text; its description says which board it came from.
export async function createTaskFromSticky(shortId: string, projectId: string, title: string, boardId: string, boardTitle: string) {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" } as ActionResult<{ id: string; key: string }>;
  const href = workspacePath(shortId, `/boards/${boardId}`);
  const description = [
    { type: "paragraph", content: [{ type: "text", text: `${t.boards.task.fromBoard} `, styles: {} }, { type: "link", href, content: [{ type: "text", text: boardTitle || t.boards.untitled, styles: {} }] }] },
  ];
  const { data, error } = await db.rpc("create_task", { target_project: projectId, fields: { title: (title.trim() || t.boards.voting.untitledSticky).slice(0, 300), description } });
  if (error || !data) return { ok: false, error: "unknown" } as ActionResult<{ id: string; key: string }>;
  return data as ActionResult<{ id: string; key: string }>;
}

// Step Д4: boards inside wiki pages (read live with the reader's own access —
// someone who can't open the board gets nothing) and in search.

export type BoardSummary = { id: string; title: string };
export type BoardView = BoardSummary & { data: unknown; version: number; canEdit: boolean };

export async function boardsForEmbed(shortId: string): Promise<BoardSummary[]> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return [];
  const db = await dataClient(shortId);
  const { data } = await db
    .from("service_objects")
    .select("id, title")
    .eq("workspace_id", workspace.id)
    .eq("service", "boards")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  return (data ?? []) as BoardSummary[];
}

export async function boardView(shortId: string, id: string): Promise<BoardView | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const db = await dataClient(shortId);
  const [{ data }, { data: role }] = await Promise.all([
    db.from("service_objects").select("id, title, data, version, deleted_at").eq("id", id).eq("service", "boards").maybeSingle(),
    db.rpc("service_object_role", { target_object: id }),
  ]);
  if (!data || !role || data.deleted_at) return null;
  return { id: data.id, title: data.title, data: data.data, version: data.version, canEdit: role === "owner" || role === "editor" };
}

export type BoardHit = BoardSummary & { snippet: string };

// Boards whose name, sticky notes or frames have the words (search "Дошки").
export async function searchBoards(shortId: string, query: string): Promise<BoardHit[]> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return [];
  const db = await dataClient(shortId);
  const words = query.trim().slice(0, 200);
  let request = db.from("service_objects").select("id, title, search_text").eq("workspace_id", workspace.id).eq("service", "boards").is("deleted_at", null);
  if (words) {
    const like = `%${words.replace(/[%_\\,()]/g, " ")}%`;
    request = request.or(`title.ilike.${like},search_text.ilike.${like}`);
  }
  const { data } = await request.order("updated_at", { ascending: false }).limit(20);
  return ((data ?? []) as (BoardSummary & { search_text: string })[]).map((row) => {
    const at = words ? row.search_text.toLowerCase().indexOf(words.toLowerCase()) : -1;
    return { id: row.id, title: row.title, snippet: at >= 0 ? row.search_text.slice(Math.max(0, at - 30), at + words.length + 50) : row.search_text.slice(0, 80) };
  });
}
