import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pageToMarkdown } from "@/lib/markdown";
import { driveApi } from "./google-drive";
import { noteDriveError, refreshTokenOf, type DriveConnection } from "./storage";

// Copies pages changed since their last backup to the Drive's backup folder:
// an exact JSON copy (for restoring) and a readable Markdown one. Existing backup
// files are overwritten, so the folder always holds the latest version of each page.
// `source` holds the pages: the central database or a team database (path C).
export async function backupWorkspace(admin: SupabaseClient, connection: DriveConnection, limit = 40, source: SupabaseClient = admin) {
  const { data: pages } = await source
    .from("pages")
    .select("id, title, icon, parent_id, content, cover, created_at, updated_at")
    .eq("workspace_id", connection.workspace_id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: true });
  const { data: done } = await source
    .from("page_backups")
    .select("page_id, json_file_id, markdown_file_id, backed_up_at")
    .eq("drive_connection_id", connection.id);
  const previous = new Map((done ?? []).map((b) => [b.page_id as string, b]));
  const due = (pages ?? []).filter((p) => {
    const last = previous.get(p.id as string);
    return !last || new Date(last.backed_up_at as string) < new Date(p.updated_at as string);
  });

  const api = driveApi();
  const token = refreshTokenOf(connection);
  let saved = 0;
  try {
    for (const page of due.slice(0, limit)) {
      const json = new TextEncoder().encode(JSON.stringify(page, null, 2));
      const markdown = new TextEncoder().encode(pageToMarkdown(String(page.title || "—"), page.content));
      const last = previous.get(page.id as string);
      let jsonId = last?.json_file_id as string | undefined;
      let markdownId = last?.markdown_file_id as string | undefined;
      const base = `${String(page.title || "—").replace(/[\\/:*?"<>|]/g, " ").slice(0, 80)} — ${page.id}`;
      if (jsonId && markdownId) {
        await api.overwrite(token, jsonId, "application/json", json);
        await api.overwrite(token, markdownId, "text/markdown", markdown);
      } else {
        jsonId = await api.upload(token, connection.backups_folder_id, `${base}.json`, "application/json", json);
        markdownId = await api.upload(token, connection.backups_folder_id, `${base}.md`, "text/markdown", markdown);
      }
      await source.from("page_backups").upsert({
        page_id: page.id,
        drive_connection_id: connection.id,
        json_file_id: jsonId,
        markdown_file_id: markdownId,
        backed_up_at: new Date().toISOString(),
      });
      saved += 1;
    }
  } catch (error) {
    await noteDriveError(admin, connection, error);
    throw error;
  }
  await admin.from("drive_connections").update({ last_backup_at: new Date().toISOString() }).eq("id", connection.id);
  return { saved, remaining: Math.max(0, due.length - saved) };
}

const KEEP_SNAPSHOTS = 14;

// Everything of the workspace except the page text (that is in the page backups)
// and secrets: enough to rebuild members, access and discussions.
export async function snapshotWorkspace(admin: SupabaseClient, connection: DriveConnection, source: SupabaseClient = admin) {
  const { data: last } = await admin
    .from("workspace_data_backups")
    .select("created_at")
    .eq("drive_connection_id", connection.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Once a day is enough, even if the job runs again.
  if (last && Date.now() - new Date(last.created_at as string).getTime() < 20 * 60 * 60 * 1000) return { saved: false };

  const ws = connection.workspace_id;
  const rows = async (query: PromiseLike<{ data: unknown[] | null }>) => (await query).data ?? [];
  // Members and domains are always central; pages and discussions where the workspace keeps them.
  const of = (name: string, columns: string, from: SupabaseClient = source) => from.from(name).select(columns).eq("workspace_id", ws);
  const snapshot = {
    format: "edgeknow-workspace-snapshot/1",
    created_at: new Date().toISOString(),
    workspace: (await admin.from("workspaces").select("id, short_id, name, owner_id, storage_limit_mb, created_at").eq("id", ws).maybeSingle()).data,
    members: await rows(of("workspace_members", "user_id, role, joined_via, status, joined_at, profile:profiles!workspace_members_user_id_fkey(email, name)", admin)),
    domains: await rows(of("workspace_domains", "domain, is_active, added_at", admin)),
    pages: await rows(of("pages", "id, parent_id, title, icon, position, owner_id, created_by, inherit, workspace_role, cover, created_at, updated_at, deleted_at")),
    page_access: await rows(of("page_access", "page_id, user_id, role, granted_by, created_at")),
    groups: await rows(of("workspace_groups", "id, name, created_at", admin)),
    group_members: await rows(of("workspace_group_members", "group_id, user_id, added_at", admin)),
    page_group_access: await rows(of("page_group_access", "page_id, group_id, role, granted_by, created_at")),
    comment_threads: await rows(of("comment_threads", "id, page_id, quoted_text, status, created_by, created_at, resolved_by, resolved_at")),
    comments: await rows(of("comments", "id, thread_id, author_id, body, mentions, created_at, edited_at")),
    attachments: await rows(of("attachments", "id, page_id, storage_path, mime_type, bytes, width, height, storage_backend, drive_file_id, uploaded_by, created_at")),
    audit_log: await rows(of("audit_log", "action, details, actor_id, created_at").order("created_at", { ascending: false }).limit(1000)),
  };

  const api = driveApi();
  const token = refreshTokenOf(connection);
  const name = `workspace-${snapshot.created_at.slice(0, 10)}.json`;
  try {
    const fileId = await api.upload(token, connection.backups_folder_id, name, "application/json", new TextEncoder().encode(JSON.stringify(snapshot, null, 2)));
    await admin.from("workspace_data_backups").insert({ drive_connection_id: connection.id, drive_file_id: fileId });
    const { data: old } = await admin
      .from("workspace_data_backups")
      .select("id, drive_file_id")
      .eq("drive_connection_id", connection.id)
      .order("created_at", { ascending: false })
      .range(KEEP_SNAPSHOTS, KEEP_SNAPSHOTS + 50);
    for (const row of old ?? []) {
      await api.remove(token, row.drive_file_id as string);
      await admin.from("workspace_data_backups").delete().eq("id", row.id);
    }
  } catch (error) {
    await noteDriveError(admin, connection, error);
    throw error;
  }
  return { saved: true };
}
