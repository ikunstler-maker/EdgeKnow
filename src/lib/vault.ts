import type { SupabaseClient } from "@supabase/supabase-js";
import { workspacePath } from "@/lib/paths";
import type { ServiceKey } from "@/lib/services";

// Vault (VAULT-1): every file of the workspace the person can already see, gathered
// from the services' own file tables. Each table is read with the person's own
// session, so the database decides; a file of a binned page, task or object, or of
// a removed message, is left out. Nothing here changes data.

export type VaultKind = "image" | "pdf" | "video" | "audio" | "document" | "other";
export type VaultSource = Extract<ServiceKey, "files" | "wiki" | "tasks" | "chat" | "boards" | "nodes" | "sheets" | "slides" | "surveys">;

export type VaultFile = {
  key: string;
  source: VaultSource;
  // Empty for a wiki image (it has no name of its own); the screen names it.
  name: string;
  mime: string;
  kind: VaultKind;
  bytes: number;
  createdAt: string;
  // Shown in the browser (preview) and handed over as a file.
  src: string;
  download: string;
  // Where the file is used.
  where: { label: string; href: string; direct?: boolean; own?: boolean };
};

// Per service; the newest first. Enough for a first look; paging comes with own files.
export const VAULT_LIMIT = 400;

const DOCUMENTS = [
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
];

export function kindOf(mime: string): VaultKind {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return DOCUMENTS.includes(mime) ? "document" : "other";
}

// Shown in the preview window. Survey answers' files are always downloads (their own
// route); a PDF opens in its own tab, where the browser's viewer works under our
// files' strict rules.
export const previewable = (file: Pick<VaultFile, "kind" | "source">) =>
  file.source !== "surveys" && (file.kind === "image" || ((file.kind === "audio" || file.kind === "video") && (file.source === "chat" || file.source === "wiki" || file.source === "files")));

const OBJECT_SOURCES: VaultSource[] = ["boards", "nodes", "sheets", "slides", "surveys"];
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

type WikiRow = { id: string; storage_path: string; mime_type: string; bytes: number; created_at: string; pages: { id: string; title: string; deleted_at: string | null } | null };
type TaskRow = { id: string; name: string; mime_type: string; bytes: number; created_at: string; tasks: { number: number; title: string; deleted_at: string | null; task_projects: { key: string } | null } | null };
type ChatRow = { id: string; name: string; mime_type: string; bytes: number; created_at: string; channel_id: string; message_id: string; chat_messages: { deleted_at: string | null; thread_root_id: string | null } | null; chat_channels: { name: string; visibility: string } | null };
type OwnRow = { id: string; name: string; mime_type: string; bytes: number; created_at: string; parent_id: string | null; large: boolean };
type ObjectRow = { id: string; name: string; mime_type: string; bytes: number; created_at: string; service_objects: { id: string; service: string; title: string; deleted_at: string | null } | null };

export async function listVaultFiles(db: SupabaseClient, workspaceId: string, shortId: string): Promise<VaultFile[]> {
  const base = (rest: string) => workspacePath(shortId, rest);
  const [own, wiki, tasks, chat, objects] = await Promise.all([
    // Vault's own files (VAULT-2): those the person has a role on, not in the bin.
    db
      .from("vault_items")
      .select("id, name, mime_type, bytes, created_at, parent_id, large")
      .eq("workspace_id", workspaceId)
      .eq("kind", "file")
      .neq("storage_backend", "pending")
      .is("version_of", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(VAULT_LIMIT),
    db
      .from("attachments")
      .select("id, storage_path, mime_type, bytes, created_at, pages!inner(id, title, deleted_at)")
      .eq("workspace_id", workspaceId)
      .is("pages.deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(VAULT_LIMIT),
    db
      .from("task_files")
      .select("id, name, mime_type, bytes, created_at, tasks!inner(number, title, deleted_at, task_projects!inner(key))")
      .eq("workspace_id", workspaceId)
      .neq("storage_backend", "pending")
      .is("tasks.deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(VAULT_LIMIT),
    db
      .from("chat_files")
      .select("id, name, mime_type, bytes, created_at, channel_id, message_id, chat_messages!inner(deleted_at, thread_root_id), chat_channels!inner(name, visibility)")
      .eq("workspace_id", workspaceId)
      .neq("storage_backend", "pending")
      .not("message_id", "is", null)
      .is("chat_messages.deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(VAULT_LIMIT),
    db
      .from("object_files")
      .select("id, name, mime_type, bytes, created_at, service_objects!inner(id, service, title, deleted_at)")
      .eq("workspace_id", workspaceId)
      .neq("storage_backend", "pending")
      .in("service_objects.service", OBJECT_SOURCES)
      .is("service_objects.deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(VAULT_LIMIT),
  ]);

  const files: VaultFile[] = [];
  // A large file's bytes were not checked, so it is never shown, only downloaded.
  for (const row of (own.data ?? []) as unknown as OwnRow[]) {
    const src = `/api/vault/files/${row.id}?ws=${shortId}`;
    files.push({ key: `files:${row.id}`, source: "files", name: row.name, mime: row.mime_type, kind: row.large ? "other" : kindOf(row.mime_type), bytes: Number(row.bytes), createdAt: row.created_at, src, download: `${src}&download`, where: { label: "", href: base(row.parent_id ? `/files?folder=${row.parent_id}` : "/files"), own: true } });
  }
  for (const row of (wiki.data ?? []) as unknown as WikiRow[]) {
    const page = one(row.pages);
    if (!page) continue;
    const src = `/api/files/${row.storage_path}`;
    files.push({ key: `wiki:${row.id}`, source: "wiki", name: "", mime: row.mime_type, kind: kindOf(row.mime_type), bytes: row.bytes, createdAt: row.created_at, src, download: src, where: { label: page.title, href: base(`/p/${page.id}`) } });
  }
  for (const row of (tasks.data ?? []) as unknown as TaskRow[]) {
    const task = one(row.tasks);
    const project = one(task?.task_projects);
    if (!task || !project) continue;
    const src = `/api/tasks/files/${row.id}?ws=${shortId}`;
    files.push({ key: `tasks:${row.id}`, source: "tasks", name: row.name, mime: row.mime_type, kind: kindOf(row.mime_type), bytes: row.bytes, createdAt: row.created_at, src, download: `${src}&download`, where: { label: `${project.key}-${task.number} ${task.title}`, href: base(`/tasks/${project.key}/${task.number}`) } });
  }
  for (const row of (chat.data ?? []) as unknown as ChatRow[]) {
    const channel = one(row.chat_channels);
    const message = one(row.chat_messages);
    if (!channel || !message) continue;
    const src = `/api/chat/files/${row.id}?ws=${shortId}`;
    const thread = message.thread_root_id ? `&t=${message.thread_root_id}` : "";
    const direct = channel.visibility === "direct";
    files.push({ key: `chat:${row.id}`, source: "chat", name: row.name, mime: row.mime_type, kind: kindOf(row.mime_type), bytes: row.bytes, createdAt: row.created_at, src, download: `${src}&download`, where: { label: direct ? "" : `# ${channel.name}`, href: base(`/chat?c=${row.channel_id}${thread}&m=${row.message_id}`), direct } });
  }
  for (const row of (objects.data ?? []) as unknown as ObjectRow[]) {
    const object = one(row.service_objects);
    if (!object || !OBJECT_SOURCES.includes(object.service as VaultSource)) continue;
    const source = object.service as VaultSource;
    // Survey answers' files are always handed over as downloads by their own route.
    const src = source === "surveys" ? `/api/surveys/files/${row.id}?ws=${shortId}` : `/api/boards/files/${row.id}?ws=${shortId}`;
    files.push({ key: `${source}:${row.id}`, source, name: row.name, mime: row.mime_type, kind: kindOf(row.mime_type), bytes: row.bytes, createdAt: row.created_at, src, download: src, where: { label: object.title, href: base(`/${source}/${object.id}`) } });
  }
  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Vault's own folders and files (VAULT-2), as vault_list returns them.
export type VaultRole = "owner" | "editor" | "viewer";
export type VaultItem = {
  id: string;
  kind: "folder" | "file";
  name: string;
  mime_type: string | null;
  bytes: number | null;
  parent_id: string | null;
  owner_id: string | null;
  updated_at: string;
  deleted_at: string | null;
  // VAULT-6: the current version's number (1: never replaced).
  version?: number;
  // VAULT-7: a link to a file on the team's Drive (no copy; no versions).
  link?: boolean;
  role: VaultRole;
  // Nobody in the workspace has it from "general access" (only the people listed).
  restricted: boolean;
  // Given to people or units.
  shared: boolean;
};
export type VaultListing = {
  folder: { id: string; name: string; role: VaultRole } | null;
  path: { id: string; name: string }[];
  items: VaultItem[];
};
export type VaultSharing = {
  role: VaultRole;
  owner_id: string | null;
  inherit: boolean;
  workspace_role: "viewer" | "editor" | null;
  inherited_workspace_role: "viewer" | "editor" | null;
  people: { user_id: string; role: "viewer" | "editor" }[];
  units: { group_id: string; role: "viewer" | "editor" }[];
};
export const canEditVault = (role: VaultRole | null | undefined) => role === "owner" || role === "editor";
export const vaultFileSrc = (shortId: string, id: string) => `/api/vault/files/${id}?ws=${shortId}`;
