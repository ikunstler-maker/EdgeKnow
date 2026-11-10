"use server";

import { withPaths } from "@/lib/groups";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import type { GrantRole, PageRole } from "@/lib/pages";
import { dataClient, writeClient } from "@/lib/team-db/data";

// Permission checks live in the database functions; these actions only forward
// the call and refresh every page that shows the tree.
async function callPageRpc<T extends object = object>(
  fn: string,
  args: Record<string, unknown>,
): Promise<ActionResult<T>> {
  const supabase = await writeClient();
  if (!supabase) return { ok: false, error: "team_setup" };
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

// A new page takes the id the browser already chose (it shows the page at once),
// and nothing is re-rendered here: the browser opens the page and refreshes the tree itself.
export async function createPage(workspaceId: string, parentId: string | null, id: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await writeClient();
  if (!supabase) return { ok: false, error: "team_setup" };
  const { data, error } = await supabase.rpc("create_page_at", { ws: workspaceId, parent: parentId, new_title: "", page_id: id });
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<{ id: string }>;
}

export async function renamePage(id: string, title: string) {
  return callPageRpc("rename_page", { target_page: id, new_title: title });
}

export async function setPageIcon(id: string, icon: string | null) {
  return callPageRpc("set_page_icon", { target_page: id, new_icon: icon });
}

export async function movePage(id: string, parentId: string | null, index: number) {
  return callPageRpc("move_page", { target_page: id, new_parent: parentId, new_index: index });
}

export async function trashPage(id: string) {
  return callPageRpc("trash_page", { target_page: id });
}

export async function restorePage(id: string) {
  return callPageRpc("restore_page", { target_page: id });
}

export async function deletePageForever(id: string) {
  return callPageRpc("delete_page_forever", { target_page: id });
}

// Sharing (stage 5). The database lets only the page owner change access.

export type SharingPerson = { user_id: string; name: string | null; email: string; guest?: boolean };
export type SharingEntry = SharingPerson & {
  role: GrantRole;
  own: boolean;
  own_role: GrantRole | null;
  inherited_from: string | null;
  inherited_title: string | null;
};
export type PageSharing = {
  my_role: PageRole;
  owner: SharingPerson;
  has_parent: boolean;
  inherit: boolean;
  workspace_role: GrantRole | null;
  inherited_workspace_role: GrantRole | null;
  entries: SharingEntry[];
  members: SharingPerson[];
  // Groups with a role on this page, and (for the owner) all groups to choose from.
  groups: SharingGroup[];
  all_groups: { group_id: string; name: string; members: number }[];
};
export type SharingGroup = {
  group_id: string;
  name: string;
  members: number;
  role: GrantRole;
  own: boolean;
  own_role: GrantRole | null;
  inherited_from: string | null;
  inherited_title: string | null;
};

export async function getPageSharing(id: string): Promise<ActionResult<PageSharing>> {
  const supabase = await dataClient();
  const { data, error } = await supabase.rpc("page_sharing", { target_page: id });
  if (error || !data) return { ok: false, error: "unknown" };
  const result = data as ActionResult<PageSharing>;
  if (!result.ok) return result;
  // Guests are marked wherever people are listed.
  const { data: guestRows } = await supabase.from("workspace_members").select("user_id").eq("role", "guest").eq("status", "active");
  const guests = new Set((guestRows ?? []).map((g) => g.user_id as string));
  const mark = <T extends SharingPerson>(person: T): T => (guests.has(person.user_id) ? { ...person, guest: true } : person);
  // Units are named by their path in the company structure.
  const { data: units } = await supabase.from("workspace_groups").select("id, name, parent_id");
  const pathOf = new Map(withPaths((units ?? []) as { id: string; name: string; parent_id: string | null }[]).map((u) => [u.id, u.name]));
  const named = <T extends { group_id: string; name: string }>(g: T): T => ({ ...g, name: pathOf.get(g.group_id) ?? g.name });
  return {
    ...result,
    owner: mark(result.owner),
    entries: result.entries.map(mark),
    members: result.members.map(mark),
    groups: (result.groups ?? []).map(named),
    all_groups: (result.all_groups ?? []).map(named).sort((x, y) => x.name.localeCompare(y.name)),
  };
}

export async function setPageMemberRole(id: string, userId: string, role: GrantRole | null) {
  return callPageRpc("set_page_member_role", { target_page: id, member: userId, new_role: role });
}

export async function setPageGroupRole(id: string, groupId: string, role: GrantRole | null) {
  return callPageRpc("set_page_group_role", { target_page: id, target_group: groupId, new_role: role });
}

export async function setPageWorkspaceRole(id: string, role: GrantRole | null) {
  return callPageRpc("set_page_workspace_role", { target_page: id, new_role: role });
}

export async function setPageInherit(id: string, inherit: boolean) {
  return callPageRpc("set_page_inherit", { target_page: id, new_inherit: inherit });
}

export async function transferPageOwnership(id: string, userId: string) {
  return callPageRpc("transfer_page_ownership", { target_page: id, new_owner: userId });
}

// Search (titles and text). Rights, the workspace and the trash are handled by
// public.search_pages; matches in the snippet are marked with \u0001…\u0002.
export type SearchHit = {
  id: string;
  title: string;
  icon: string | null;
  parent_id: string | null;
  depth: number;
  snippet: string;
};

export async function searchPages(
  workspaceId: string,
  query: string,
  rootId: string | null,
  maxDepth: number | null,
): Promise<SearchHit[]> {
  const supabase = await dataClient();
  const { data } = await supabase.rpc("search_pages", {
    ws: workspaceId,
    query: query.slice(0, 200),
    root: rootId,
    max_depth: maxDepth,
  });
  return (data ?? []) as SearchHit[];
}

// public.search_blocks: every heading, image, video… on pages the person can open.
export type BlockKind = "heading" | "image" | "video" | "table" | "code" | "quote" | "checklist" | "callout" | "diagram" | "link";
export type BlockHit = {
  id: string;
  title: string;
  icon: string | null;
  parent_id: string | null;
  depth: number;
  block_id: string;
  block_type: string;
  block_text: string;
};

export async function searchBlocks(
  workspaceId: string,
  kind: BlockKind,
  query: string,
  rootId: string | null,
  maxDepth: number | null,
): Promise<BlockHit[]> {
  const supabase = await dataClient();
  const { data } = await supabase.rpc("search_blocks", {
    ws: workspaceId,
    kind,
    query: query.slice(0, 200) || null,
    root: rootId,
    max_depth: maxDepth,
  });
  return (data ?? []) as BlockHit[];
}

// Publishes a draft (its owner or an editor), optionally with the drafts inside it.
export async function publishPage(id: string, withChildren: boolean) {
  return callPageRpc<{ published: number }>("publish_page", { target_page: id, with_children: withChildren });
}

export async function setPageCover(id: string, cover: unknown) {
  return callPageRpc<{ cover: unknown }>("set_page_cover", { target_page: id, new_cover: cover });
}

// A wiki page as a card (presentations, step П-3б): title, icon and the first words,
// read with the viewer's own access (RLS) — no access, no card.
export async function pageCard(shortId: string, id: string): Promise<{ id: string; title: string; icon: string | null; snippet: string } | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const db = await dataClient(shortId);
  const { data } = await db.from("pages").select("id, title, icon, content, deleted_at").eq("id", id).maybeSingle();
  const row = data as { id: string; title: string; icon: string | null; content: unknown; deleted_at: string | null } | null;
  if (!row || row.deleted_at) return null;
  const words: string[] = [];
  const walk = (value: unknown) => {
    if (words.join(" ").length > 280) return;
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      const node = value as Record<string, unknown>;
      if (node.type === "text" && typeof node.text === "string") words.push(node.text);
      walk(node.content);
      walk(node.children);
    }
  };
  walk(row.content);
  return { id: row.id, title: row.title, icon: row.icon, snippet: words.join(" ").replace(/\s+/g, " ").trim().slice(0, 280) };
}

// --- Page history (decision 2027-01-29): only the page's owner and editors read it (RLS). ---

export type PageVersionItem = {
  id: string;
  reason: "edit" | "publish" | "ack_revision" | "restore";
  createdAt: string;
  lastAt: string;
  author: string | null;
  title: string;
  restoredFrom: string | null;
};

export async function pageVersions(shortId: string, pageId: string): Promise<PageVersionItem[] | null> {
  if (!/^[0-9a-f-]{36}$/.test(pageId)) return null;
  const db = await dataClient(shortId);
  const { data, error } = await db
    .from("page_versions")
    .select("id, reason, created_at, last_at, created_by, title, restored_from")
    .eq("page_id", pageId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200);
  if (error) return null;
  const rows = (data ?? []) as { id: string; reason: PageVersionItem["reason"]; created_at: string; last_at: string; created_by: string | null; title: string; restored_from: string | null }[];
  const ids = [...new Set(rows.map((r) => r.created_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await db.from("profiles").select("id, name, email").in("id", ids);
    for (const p of (people ?? []) as { id: string; name: string | null; email: string }[]) names.set(p.id, p.name || p.email);
  }
  return rows.map((r) => ({
    id: r.id,
    reason: r.reason,
    createdAt: r.created_at,
    // The first version (the text from before the history) has no session end.
    lastAt: r.last_at === "-infinity" ? r.created_at : r.last_at,
    author: r.created_by ? (names.get(r.created_by) ?? null) : null,
    title: r.title,
    restoredFrom: r.restored_from,
  }));
}

// One version's text with the page's current text, to show what differs.
export async function pageVersion(shortId: string, versionId: string): Promise<{ title: string; icon: string | null; content: unknown; current: unknown } | null> {
  if (!/^[0-9a-f-]{36}$/.test(versionId)) return null;
  const db = await dataClient(shortId);
  const { data: version } = await db.from("page_versions").select("page_id, title, icon, content").eq("id", versionId).maybeSingle();
  if (!version) return null;
  const { data: page } = await db.from("pages").select("content").eq("id", version.page_id).maybeSingle();
  return { title: version.title as string, icon: (version.icon as string | null) ?? null, content: version.content, current: page?.content ?? null };
}

export async function restorePageVersion(versionId: string) {
  return callPageRpc<{ version: number }>("restore_page_version", { target_version: versionId });
}
