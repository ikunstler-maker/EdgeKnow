import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_TASK_FILE_BYTES, OBJECT_FILE_COLUMNS, filesHome, storeTaskFile, taskFileLooksLike, workspaceDestination, type StoredFile } from "@/lib/drive/task-files";

// Files in survey answers (step О3), stored like board pictures: the database
// registers the file (checking the survey, the type, the size and the limit),
// then the bytes go to the workspace's one storage. Shared by the route for
// members and the one for the link for anyone.

export const SURVEY_FILE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

export const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export function readUpload(request: NextRequest) {
  const name = (request.nextUrl.searchParams.get("name") ?? "").trim().slice(0, 200) || "file";
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  return { name, type, ok: SURVEY_FILE_TYPES.includes(type) };
}

export async function readBytes(request: NextRequest, type: string): Promise<Uint8Array | NextResponse> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_TASK_FILE_BYTES) return fail("too_large_file", 400);
  if (!taskFileLooksLike(type, bytes)) return fail("invalid_file", 400);
  return bytes;
}

// After `register_*_survey_file`: the bytes go where the workspace keeps its files.
export async function storeRegistered(admin: SupabaseClient, reg: { id: string; workspace_id: string }, bytes: Uint8Array) {
  const { rows } = await filesHome(admin, reg.workspace_id);
  const forget = () => rows.from("object_files").delete().eq("id", reg.id);
  const to = await workspaceDestination(admin, reg.workspace_id);
  if ("error" in to) {
    await forget();
    return fail(to.error, 409);
  }
  const { data: row } = await rows.from("object_files").select(OBJECT_FILE_COLUMNS).eq("id", reg.id).single();
  try {
    await storeTaskFile(admin, rows, row as StoredFile, bytes, to);
  } catch {
    await forget();
    return fail("upload_failed", 502);
  }
  return NextResponse.json({ ok: true, id: reg.id });
}
