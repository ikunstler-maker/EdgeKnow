"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { withPaths } from "@/lib/groups";
import { dataClient, writeClient } from "@/lib/team-db/data";
import type { AckLabel, AckPerson, AckRevision } from "@/lib/page-acks";

// Rights and the frozen page are enforced by the database functions; these only forward.
async function call<T extends object = object>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const db = await writeClient();
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc(fn, args);
  if (error || !data) return { ok: false, error: error?.message?.includes("page_frozen") ? "page_frozen" : "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

export async function setPageAck(pageId: string, label: AckLabel, groups: string[]) {
  return call<{ revision: number }>("set_page_ack", { target_page: pageId, new_label: label, new_groups: groups });
}

export async function disablePageAck(pageId: string) {
  return call("disable_page_ack", { target_page: pageId });
}

export async function pageAckEdition(pageId: string, step: "start" | "publish" | "cancel") {
  return call<{ revision?: number }>("page_ack_edition", { target_page: pageId, step });
}

export async function ackPage(pageId: string) {
  return call<{ revision: number; signed_at: string }>("ack_page", { target_page: pageId });
}

export type AckStats = { revision: number; signed: (AckPerson & { signed_at: string })[]; pending: AckPerson[]; any_signed: boolean };

// For the owner and admins: who signed a revision, who still should, the revisions and units.
export async function pageAckDetails(
  pageId: string,
  revision: number | null,
): Promise<ActionResult<{ stats: AckStats; revisions: AckRevision[]; units: { id: string; name: string }[] }>> {
  const db = await dataClient();
  const { data, error } = await db.rpc("page_ack_stats", { target_page: pageId, target_revision: revision });
  if (error || !data) return { ok: false, error: "unknown" };
  const stats = data as ActionResult<AckStats>;
  if (!stats.ok) return stats;
  const [{ data: revisions }, { data: units }] = await Promise.all([
    db.from("page_ack_revisions").select("revision, label, content_hash, published_at").eq("page_id", pageId).order("revision", { ascending: false }),
    db.from("workspace_groups").select("id, name, parent_id"),
  ]);
  return {
    ok: true,
    stats,
    revisions: (revisions ?? []) as AckRevision[],
    units: withPaths((units ?? []) as { id: string; name: string; parent_id: string | null }[])
      .map((u) => ({ id: u.id, name: u.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
