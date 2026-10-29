"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { examplePages } from "@/lib/example-pages";
import { workspaceData } from "@/lib/team-db/data";

// "Add example pages" on a new workspace's home: made with the person's own
// rights, in whatever database the workspace uses.
export async function addExamplePages(shortId: string): Promise<ActionResult> {
  const data = await workspaceData(shortId);
  if (!data) return { ok: false, error: "forbidden" };
  if (data.location === "setup" || data.location === "returning") return { ok: false, error: "team_setup" };
  for (const page of examplePages()) {
    const { data: created, error } = await data.client.rpc("create_page", { ws: data.workspaceId, parent: null, new_title: page.title });
    const result = created as ActionResult<{ id: string }> | null;
    if (error || !result) return { ok: false, error: "unknown" };
    if (!result.ok) return result;
    await data.client.rpc("set_page_icon", { target_page: result.id, new_icon: page.icon });
    await data.client.rpc("save_page_content", { target_page: result.id, new_content: page.blocks, base_version: 1 });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
