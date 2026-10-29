import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// How often one person may call the expensive parts of the site: [calls, per seconds].
// Counted in the central database (public.hit_rate_limit), whatever database the
// workspace uses.
const LIMITS = {
  preview: [30, 60],
  youtube: [60, 60],
  upload: [60, 60],
  save: [240, 60],
  feedback: [10, 3600],
  team_token: [240, 60],
  setup: [240, 60],
  domain_check: [30, 3600],
} as const;

export type LimitKind = keyof typeof LIMITS;

// True when this call is over the limit. If the counter can't be reached the
// call goes ahead: a limit must never take the site down.
export async function overLimit(central: SupabaseClient, kind: LimitKind): Promise<boolean> {
  const [max, window] = LIMITS[kind];
  const { data, error } = await central.rpc("hit_rate_limit", { kind, max_hits: max, window_seconds: window });
  return !error && data === false;
}

export const tooManyRequests = () =>
  NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
