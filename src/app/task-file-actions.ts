"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { dataClient, writeClient } from "@/lib/team-db/data";
import { activeConnection } from "@/lib/drive/storage";
import {
  TASK_FILE_COLUMNS,
  destinationFor,
  filesHome,
  isAt,
  moveTaskFile,
  personalDrive,
  projectDrive,
  spaceAt,
  type Destination,
  type FilesTarget,
  type TaskFileRow,
} from "@/lib/drive/task-files";
import { createClient } from "@/lib/supabase/server";

// Task files: removing one, and (for those who manage the project) where the
// project keeps its files, how much there is and moving it.

export async function deleteTaskFile(fileId: string): Promise<ActionResult> {
  const db = await writeClient();
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc("delete_task_file", { target_file: fileId });
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult;
}

export type FilesOverview = {
  target: FilesTarget;
  drives: { personal: string | null; wiki: string | null; project: string | null };
  files: { count: number; bytes: number };
  // Files not yet where the project keeps them now (and those that can't go: their author has no Drive connected).
  toMove: { count: number; bytes: number; waiting: number };
  space: { limit: number | null; used: number } | null;
};

async function managed(shortId: string, projectId: string) {
  const db = await dataClient(shortId);
  const admin = createAdminClient();
  const [{ data: role }, { data: project }, { data: claims }] = await Promise.all([
    db.rpc("task_project_role", { target_project: projectId }),
    db.from("task_projects").select("id, workspace_id, files_target").eq("id", projectId).maybeSingle(),
    (await createClient()).auth.getClaims(),
  ]);
  if (role !== "owner" || !project || !admin) return null;
  return { db, admin, project: project as { id: string; workspace_id: string; files_target: FilesTarget }, userId: (claims?.claims?.sub as string) ?? null };
}

async function projectFiles(db: Awaited<ReturnType<typeof dataClient>>, projectId: string) {
  const { data: tasks } = await db.from("tasks").select("id").eq("project_id", projectId);
  const ids = (tasks ?? []).map((t) => t.id as string);
  const files: TaskFileRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("task_files").select(TASK_FILE_COLUMNS).in("task_id", ids.slice(i, i + 200)).neq("storage_backend", "pending");
    files.push(...((data ?? []) as TaskFileRow[]));
  }
  return files;
}

// Where each file should be now; personal Drives are each author's own.
async function plan(admin: NonNullable<ReturnType<typeof createAdminClient>>, project: { id: string; workspace_id: string; files_target: FilesTarget }, files: TaskFileRow[]) {
  const destinations = new Map<string, Destination | null>();
  const destinationOf = async (file: TaskFileRow) => {
    const key = project.files_target === "personal" ? `p:${file.uploaded_by}` : project.files_target;
    if (!destinations.has(key)) {
      const to = await destinationFor(admin, project.files_target, project.workspace_id, project.id, file.uploaded_by);
      destinations.set(key, "error" in to ? null : to);
    }
    return destinations.get(key)!;
  };
  const moves: { file: TaskFileRow; to: Destination }[] = [];
  let waiting = 0;
  for (const file of files) {
    const to = await destinationOf(file);
    if (!to) waiting += 1;
    else if (!isAt(file, to)) moves.push({ file, to });
  }
  return { moves, waiting };
}

export async function taskFilesOverview(shortId: string, projectId: string): Promise<ActionResult<{ overview: FilesOverview }>> {
  const access = await managed(shortId, projectId);
  if (!access) return { ok: false, error: "forbidden" };
  const { admin, db, project, userId } = access;
  const [mine, wiki, own] = await Promise.all([
    userId ? personalDrive(admin, project.workspace_id, userId) : null,
    activeConnection(admin, project.workspace_id),
    projectDrive(admin, project.workspace_id, project.id),
  ]);
  const files = await projectFiles(db, project.id);
  const { moves, waiting } = await plan(admin, project, files);
  const { team } = await filesHome(admin, project.workspace_id);
  const shared = project.files_target === "personal" ? null : await destinationFor(admin, project.files_target, project.workspace_id, project.id, null);
  return {
    ok: true,
    overview: {
      target: project.files_target,
      drives: { personal: mine?.account_email ?? null, wiki: wiki?.account_email ?? null, project: own?.account_email ?? null },
      files: { count: files.length, bytes: files.reduce((sum, f) => sum + f.bytes, 0) },
      toMove: { count: moves.length, bytes: moves.reduce((sum, m) => sum + m.file.bytes, 0), waiting },
      space: shared && !("error" in shared) ? await spaceAt(admin, shared, project.workspace_id, team) : null,
    },
  };
}

// Moves files to where the project keeps them now, for up to ~20 seconds per call.
export async function moveTaskFiles(shortId: string, projectId: string): Promise<ActionResult<{ moved: number; failed: number; remaining: number }>> {
  const access = await managed(shortId, projectId);
  if (!access) return { ok: false, error: "forbidden" };
  if (!(await writeClient(shortId))) return { ok: false, error: "team_setup" };
  const { admin, db, project } = access;
  const { rows } = await filesHome(admin, project.workspace_id);
  const { moves } = await plan(admin, project, await projectFiles(db, project.id));
  const started = Date.now();
  let moved = 0;
  let failed = 0;
  for (const { file, to } of moves) {
    if (Date.now() - started > 20_000) break;
    try {
      await moveTaskFile(admin, rows, file, to);
      moved += 1;
    } catch {
      failed += 1;
    }
  }
  if (moved) {
    await admin.from("audit_log").insert({ workspace_id: project.workspace_id, actor_id: access.userId, action: "task_files_moved", details: { project: project.id, moved, to: project.files_target } });
  }
  revalidatePath("/", "layout");
  return { ok: true, moved, failed, remaining: moves.length - moved - failed };
}
