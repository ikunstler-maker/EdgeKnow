"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { syncWorkspaceNow, writeClient } from "@/lib/team-db/data";

type Result = { ok: true } | { ok: false; error: string };

// Who sees the person's statistics in this workspace: only them, or every member.
export async function setProfileVisibility(ws: string, visibility: "private" | "workspace") {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_my_profile_visibility", { ws, visibility });
  if (error || !data?.ok) return { ok: false as const };
  await syncWorkspaceNow(ws);
  revalidatePath("/w/[wid]/profile", "page");
  return { ok: true as const };
}

async function done(workspaceId: string): Promise<Result> {
  // Names and pictures live centrally; a team database gets them with its next copy.
  await syncWorkspaceNow(workspaceId);
  revalidatePath("/w/[wid]/profile", "page");
  revalidatePath("/w/[wid]/profile/[uid]", "page");
  return { ok: true };
}

// One's own name; empty goes back to the name from sign-in.
export async function saveMyName(workspaceId: string, name: string): Promise<Result> {
  if (typeof name !== "string" || name.length > 200) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_my_name", { new_name: name });
  if (error || !data?.ok) return { ok: false, error: data?.error ?? "unknown" };
  return done(workspaceId);
}

const AVATAR_TYPES = ["image/webp", "image/png", "image/jpeg"];
const AVATAR_MAX = 512 * 1024;

// One's own picture: the browser crops it to a small square first.
export async function uploadMyAvatar(workspaceId: string, form: FormData): Promise<Result> {
  const file = form.get("file");
  if (!(file instanceof File) || !AVATAR_TYPES.includes(file.type) || file.size === 0 || file.size > AVATAR_MAX) {
    return { ok: false, error: "invalid" };
  }
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  const admin = createAdminClient();
  if (!userId || !admin) return { ok: false, error: "unknown" };
  const { error: uploadError } = await admin.storage
    .from("avatars")
    .upload(`${userId}/avatar`, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
  if (uploadError) return { ok: false, error: "unknown" };
  const { data, error } = await supabase.rpc("set_my_avatar", { version: Date.now().toString(36) });
  if (error || !data?.ok) return { ok: false, error: "unknown" };
  return done(workspaceId);
}

// Back to the picture from sign-in (or none); the uploaded file goes.
export async function removeMyAvatar(workspaceId: string): Promise<Result> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { ok: false, error: "unknown" };
  const { data, error } = await supabase.rpc("set_my_avatar", { version: null });
  if (error || !data?.ok) return { ok: false, error: "unknown" };
  await createAdminClient()?.storage.from("avatars").remove([`${userId}/avatar`]).catch(() => null);
  return done(workspaceId);
}

async function call(shortId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc(fn, args);
  if (error || !data?.ok) return { ok: false, error: data?.error ?? "unknown" };
  revalidatePath("/w/[wid]/profile", "page");
  revalidatePath("/w/[wid]/profile/[uid]", "page");
  return { ok: true };
}

// The person's job title: themselves, or the owner and admins; empty clears it.
export async function saveJobTitle(shortId: string, workspaceId: string, person: string, title: string): Promise<Result> {
  if (typeof title !== "string" || title.length > 200) return { ok: false, error: "invalid" };
  return call(shortId, "set_member_job_title", { ws: workspaceId, person, title });
}

// Who manages time off sets a member's birthday from their profile: day and month only.
export async function saveMemberBirthdayDate(shortId: string, workspaceId: string, person: string, month: number | null, day: number | null): Promise<Result> {
  const valid = (n: number | null) => n === null || Number.isInteger(n);
  if (!valid(month) || !valid(day)) return { ok: false, error: "invalid" };
  return call(shortId, "set_member_birthday_date", { ws: workspaceId, person, month, day });
}
