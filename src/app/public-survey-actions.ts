"use server";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { filesHome } from "@/lib/drive/task-files";
import type { Answers } from "@/lib/surveys";

// Surveys, step О3: answering through the link for anyone. Nothing of it is open
// to the browser's own database key: this server passes the "not a robot" check
// (when it is set up), counts the visitor by a one-way hash (no address is kept)
// and asks the workspace's database with the secret key, which checks the rest.

const fail = (error: string) => ({ ok: false as const, error });

export async function turnstileOn() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

async function passedTurnstile(token: string | null, ip: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body }).catch(() => null);
  const result = (await response?.json().catch(() => null)) as { success?: boolean } | null;
  return result?.success === true;
}

export async function submitPublicSurvey(shortId: string, token: string, answers: Answers, turnstile: string | null) {
  if (!/^[a-z0-9]{4,16}$/.test(shortId) || !/^[0-9a-f]{32}$/.test(token)) return fail("not_found");
  const admin = createAdminClient();
  if (!admin) return fail("team_setup");
  const head = await headers();
  const ip = (head.get("x-forwarded-for") ?? "").split(",")[0].trim() || head.get("x-real-ip") || "";
  if (!(await passedTurnstile(turnstile, ip))) return fail("robot");
  const { data: workspace } = await admin.from("workspaces").select("id").eq("short_id", shortId).maybeSingle();
  if (!workspace) return fail("not_found");

  // Someone signed in to EdgeKnow is named (unless the survey is anonymous); nobody else is.
  const central = await createClient();
  const { data: claims } = await central.auth.getClaims();
  let person: { name: string | null; email: string } | null = null;
  if (claims?.claims?.sub) {
    const { data } = await admin.from("profiles").select("name, email").eq("id", String(claims.claims.sub)).maybeSingle();
    person = data ?? null;
  }
  const visitor = createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "edgeknow")
    .update(`${claims?.claims?.sub ?? ip}|${head.get("user-agent") ?? ""}`)
    .digest("hex");
  const { rows } = await filesHome(admin, workspace.id);
  const { data, error } = await rows.rpc("submit_public_survey_response", {
    token,
    answers,
    visitor,
    person_name: person?.name ?? null,
    person_email: person?.email ?? null,
  });
  if (error || !data) return fail("unknown");
  return data as { ok: true } | { ok: false; error: string; question?: string };
}
