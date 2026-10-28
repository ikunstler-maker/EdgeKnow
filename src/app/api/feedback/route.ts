import { NextResponse, type NextRequest } from "next/server";
import { FEEDBACK_MAX, FEEDBACK_TYPES, type FeedbackType } from "@/lib/feedback";
import { createClient } from "@/lib/supabase/server";

// Sends a feedback row to the owner's Google Sheet through a Google Apps Script
// web app (scripts/google-apps-script/feedback.gs). The script's address and the
// shared secret are server-only environment variables; the browser never sees them.
const recent = new Map<string, number[]>();
const LIMIT = 10; // per person per 10 minutes
const WINDOW_MS = 10 * 60 * 1000;

function rateLimited(userId: string) {
  const now = Date.now();
  const list = (recent.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (list.length >= LIMIT) return true;
  list.push(now);
  recent.set(userId, list);
  return false;
}

function deviceOf(userAgent: string) {
  const phone = /iPhone|Android.+Mobile|Mobile Safari/i.test(userAgent);
  const tablet = !phone && /iPad|Android|Tablet/i.test(userAgent);
  const browser =
    /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "інший";
  const os = /iPhone|iPad|Mac OS/i.test(userAgent) ? (/iPhone|iPad/.test(userAgent) ? "iOS" : "macOS") : /Android/.test(userAgent) ? "Android" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : "";
  return `${phone ? "Телефон" : tablet ? "Планшет" : "Комп'ютер"} · ${os} · ${browser}`;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { type?: unknown; text?: unknown; page?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const type = FEEDBACK_TYPES.includes(body.type as FeedbackType) ? (body.type as FeedbackType) : null;
  const text = typeof body.text === "string" ? body.text.trim().slice(0, FEEDBACK_MAX) : "";
  // Only a path inside the site, never a full address someone made up.
  const page = typeof body.page === "string" && body.page.startsWith("/") && !body.page.startsWith("//") ? body.page.slice(0, 300) : "";
  if (!type || !text) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const url = process.env.FEEDBACK_SCRIPT_URL;
  const secret = process.env.FEEDBACK_SECRET;
  if (!url || !secret || !url.startsWith("https://script.google.com/")) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }
  if (rateLimited(String(claims.sub))) return NextResponse.json({ ok: false, error: "too_many" }, { status: 429 });

  const origin = request.nextUrl.origin;
  const row = {
    secret,
    date: new Date().toISOString(),
    email: typeof claims.email === "string" ? claims.email : "",
    type,
    text,
    page: page ? `${origin}${page}` : "",
    device: deviceOf(request.headers.get("user-agent") ?? ""),
  };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    const result = (await response.json().catch(() => null)) as { ok?: boolean } | null;
    if (!response.ok || !result?.ok) return NextResponse.json({ ok: false, error: "sheet_failed" }, { status: 502 });
  } catch {
    return NextResponse.json({ ok: false, error: "sheet_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
