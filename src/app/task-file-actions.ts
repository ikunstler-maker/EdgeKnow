"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { writeClient } from "@/lib/team-db/data";

// Task files: removing one. Where they are kept is the workspace's one storage
// (Settings → Storage).

export async function deleteTaskFile(fileId: string): Promise<ActionResult> {
  const db = await writeClient();
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc("delete_task_file", { target_file: fileId });
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult;
}
