"use server";

import { after } from "next/server";
import type { ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/lib/auth";
import { connectCalendar, connectionState, disconnectCalendar, refreshNow, refreshStale, type ConnectionState } from "@/lib/calendar-external";
import type { BusySlot } from "@/lib/calendar";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";

// Doba, phase 3b: a person's own outside calendar. Everything here is about the caller
// alone: the workspace is checked for membership, the person is the signed-in one, and
// the address goes one way only — it is never sent back.

async function me(shortId: string) {
  const workspace = await getWorkspace(shortId);
  if (!workspace || workspace.role === "guest") return null;
  const user = await getCurrentUser();
  return { workspaceId: workspace.id, userId: user.id };
}

export async function loadConnection(shortId: string): Promise<ConnectionState | null> {
  const who = await me(shortId);
  return who ? connectionState(who.workspaceId, who.userId) : null;
}

export async function connectOutsideCalendar(shortId: string, url: string): Promise<ActionResult<{ state: ConnectionState }>> {
  const who = await me(shortId);
  if (!who) return { ok: false, error: "forbidden" };
  if (typeof url !== "string") return { ok: false, error: "bad_url" };
  return connectCalendar(who.workspaceId, who.userId, url);
}

export async function refreshOutsideCalendar(shortId: string): Promise<ConnectionState | null> {
  const who = await me(shortId);
  return who ? refreshNow(who.workspaceId, who.userId) : null;
}

export async function disconnectOutsideCalendar(shortId: string): Promise<ActionResult> {
  const who = await me(shortId);
  if (!who) return { ok: false, error: "forbidden" };
  return (await disconnectCalendar(who.workspaceId, who.userId)) ? { ok: true } : { ok: false, error: "unknown" };
}

// The person's own outside busy time of a period, for their calendar. What is there is
// shown at once; an address not read for an hour is read again after the response.
export async function loadMyOutsideBusy(shortId: string, from: string, to: string): Promise<BusySlot[]> {
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return [];
  const who = await me(shortId);
  if (!who) return [];
  const db = await dataClient(shortId);
  const { data } = await db
    .from("calendar_external_busy")
    .select("user_id, starts_at, ends_at, all_day")
    .eq("workspace_id", who.workspaceId)
    .eq("user_id", who.userId)
    .lt("starts_at", to)
    .gt("ends_at", from)
    .order("starts_at")
    .limit(2000);
  after(() => refreshStale(who.workspaceId, [who.userId]).catch(() => {}));
  return (data ?? []) as BusySlot[];
}
