import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeConnection } from "./storage";
import { TASK_FILE_COLUMNS, filesHome, isAt, moveTaskFile, projectDrive, readTaskFile, spaceAt, type Destination, type TaskFileRow } from "./task-files";
import { zipStream } from "@/lib/zip-stream";

// Task files a person keeps on their own Google Drive, in one workspace. When
// they leave, these would disappear with their Drive access, so the workspace's
// owner or admins copy them first: to the wiki's Drive, to EdgeKnow's storage,
// to each project's Drive, or as an archive to their computer.

export type MemberDestination = "wiki" | "edgeknow" | "project";
type MemberFile = TaskFileRow & { task: { number: number; project: { id: string; key: string } | null } | null };

export async function memberFiles(admin: SupabaseClient, workspaceId: string, userId: string) {
  const { rows, team } = await filesHome(admin, workspaceId);
  const { data } = await rows
    .from("task_files")
    .select(`${TASK_FILE_COLUMNS}, task:tasks(number, project:task_projects(id, key))`)
    .eq("workspace_id", workspaceId)
    .eq("uploaded_by", userId)
    .eq("storage_backend", "drive")
    .eq("drive_source", "personal")
    .order("created_at")
    .overrideTypes<MemberFile[], { merge: false }>();
  return { files: data ?? [], rows, team };
}

const sizeOf = (files: TaskFileRow[]) => files.reduce((sum, f) => sum + f.bytes, 0);

export type Space = { limit: number | null; used: number } | null;
export type MemberFilesOverview = {
  count: number;
  bytes: number;
  wiki: { email: string; space: Space } | null;
  edgeknow: { team: boolean; space: Space };
  // Each project's own Drive, for the files of that project.
  projects: { key: string; email: string; count: number; bytes: number; space: Space }[];
  // Files of projects without their own Drive (for "to each project's Drive").
  withoutProjectDrive: number;
};

export async function memberFilesOverview(admin: SupabaseClient, workspaceId: string, userId: string): Promise<MemberFilesOverview> {
  const { files, team } = await memberFiles(admin, workspaceId, userId);
  const wiki = await activeConnection(admin, workspaceId);
  const wikiOk = wiki?.status === "ok" ? wiki : null;
  const byProject = new Map<string, MemberFile[]>();
  for (const file of files) {
    const id = file.task?.project?.id;
    if (id) byProject.set(id, [...(byProject.get(id) ?? []), file]);
  }
  const projects: MemberFilesOverview["projects"] = [];
  let withoutProjectDrive = 0;
  for (const [projectId, list] of byProject) {
    const drive = await projectDrive(admin, workspaceId, projectId);
    if (!drive || drive.status !== "ok") {
      withoutProjectDrive += list.length;
      continue;
    }
    projects.push({
      key: list[0].task!.project!.key,
      email: drive.account_email,
      count: list.length,
      bytes: sizeOf(list),
      space: await spaceAt(admin, { kind: "drive", source: "project", connection: drive }, workspaceId, team),
    });
  }
  return {
    count: files.length,
    bytes: sizeOf(files),
    wiki: wikiOk ? { email: wikiOk.account_email, space: await spaceAt(admin, { kind: "drive", source: "wiki", connection: wikiOk }, workspaceId, team) } : null,
    edgeknow: { team, space: await spaceAt(admin, { kind: "storage" }, workspaceId, team) },
    projects,
    withoutProjectDrive,
  };
}

// Copies the person's files for up to `budgetMs`; the rest on the next call.
export async function moveMemberFiles(admin: SupabaseClient, workspaceId: string, userId: string, to: MemberDestination, budgetMs = 20_000) {
  const { files, rows } = await memberFiles(admin, workspaceId, userId);
  const wiki = to === "wiki" ? await activeConnection(admin, workspaceId) : null;
  const drives = new Map<string, Destination | null>();
  const started = Date.now();
  let moved = 0;
  let failed = 0;
  let skipped = 0;
  for (const file of files) {
    if (Date.now() - started > budgetMs) break;
    let destination: Destination | null = null;
    if (to === "edgeknow") destination = { kind: "storage" };
    else if (to === "wiki") destination = wiki?.status === "ok" ? { kind: "drive", source: "wiki", connection: wiki } : null;
    else {
      const projectId = file.task?.project?.id ?? "";
      if (!drives.has(projectId)) {
        const drive = projectId ? await projectDrive(admin, workspaceId, projectId) : null;
        drives.set(projectId, drive?.status === "ok" ? { kind: "drive", source: "project", connection: drive } : null);
      }
      destination = drives.get(projectId)!;
    }
    if (!destination || isAt(file, destination)) {
      skipped += 1;
      continue;
    }
    try {
      await moveTaskFile(admin, rows, file, destination, true);
      moved += 1;
    } catch {
      failed += 1;
    }
  }
  return { moved, failed, remaining: Math.max(0, files.length - moved - failed - skipped) };
}

// The person's files as one archive: "MAR-12 brief.pdf" in a folder per project.
export async function memberFilesZip(admin: SupabaseClient, workspaceId: string, userId: string) {
  const { files, rows } = await memberFiles(admin, workspaceId, userId);
  return zipStream(
    files.map((file) => ({
      name: `${file.task?.project?.key ?? "tasks"}/${file.task?.project ? `${file.task.project.key}-${file.task.number} ` : ""}${file.name}`,
      date: new Date(file.created_at),
      read: () => readTaskFile(admin, rows, file),
    })),
  );
}
