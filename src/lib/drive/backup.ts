import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pageToMarkdown } from "@/lib/markdown";
import { driveApi } from "./google-drive";
import { noteDriveError, refreshTokenOf, type DriveConnection } from "./storage";

// Copies pages changed since their last backup to the Drive's backup folder:
// an exact JSON copy (for restoring) and a readable Markdown one. Existing backup
// files are overwritten, so the folder always holds the latest version of each page.
export async function backupWorkspace(admin: SupabaseClient, connection: DriveConnection, limit = 40) {
  const { data: pages } = await admin
    .from("pages")
    .select("id, title, icon, parent_id, content, cover, created_at, updated_at")
    .eq("workspace_id", connection.workspace_id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: true });
  const { data: done } = await admin
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
      await admin.from("page_backups").upsert({
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
