"use server";

import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";

// Active sessions (devices). The database gives only the kind of device and times:
// no IP address, no full browser string.
export type SessionItem = {
  id: string;
  kind: "phone" | "tablet" | "computer" | "unknown";
  signedInAt: string;
  activeAt: string;
  current: boolean;
};
type SessionRow = { id: string; kind: SessionItem["kind"]; signed_in_at: string; active_at: string; current: boolean };

const toItems = (rows: SessionRow[] | undefined): SessionItem[] =>
  (rows ?? []).map((r) => ({ id: r.id, kind: r.kind, signedInAt: r.signed_in_at, activeAt: r.active_at, current: r.current }));

async function call<T extends object>(fn: string, args: Record<string, unknown> = {}): Promise<ActionResult<T>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<T>;
}

// Owner and admins: a member's devices.
export async function memberSessions(ws: string, member: string): Promise<ActionResult<{ sessions: SessionItem[] }>> {
  const result = await call<{ sessions: SessionRow[] }>("member_sessions", { ws, member });
  return result.ok ? { ok: true, sessions: toItems(result.sessions) } : result;
}

// Owner and admins: sign a member out everywhere (logged in the workspace's journal).
export async function endMemberSessions(ws: string, member: string) {
  return call<{ ended: number }>("end_member_sessions", { ws, member });
}

export async function mySessions(): Promise<ActionResult<{ sessions: SessionItem[] }>> {
  const result = await call<{ sessions: SessionRow[] }>("my_sessions");
  return result.ok ? { ok: true, sessions: toItems(result.sessions) } : result;
}

// One of my other devices, or (null) all but this one.
export async function endMySessions(target: string | null) {
  return call<{ ended: number }>("end_my_sessions", { target });
}
