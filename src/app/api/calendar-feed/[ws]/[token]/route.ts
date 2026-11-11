import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { buildFeed, isFeedToken, type FeedData } from "@/lib/calendar-feed";
import { createAdminClient } from "@/lib/supabase/admin";
import { teamAdmin } from "@/lib/team-db/files";
import { teamDatabase, teamReady } from "@/lib/team-db/sync";

// Doba, phase 3a: a person's calendar feed for calendar apps. Open without a session
// (src/lib/supabase/proxy.ts): the secret in the address is the key, and only its hash
// is known to the database. Every failure looks the same from outside.
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest, { params }: RouteContext<"/api/calendar-feed/[ws]/[token]">) {
  const { ws, token: raw } = await params;
  const token = raw.replace(/\.ics$/, "");
  if (!/^[a-z0-9]{8}$/.test(ws) || !isFeedToken(token)) return notFound();
  const admin = createAdminClient();
  if (!admin) return notFound();
  const { data: workspace } = await admin.from("workspaces").select("id, name").eq("short_id", ws).maybeSingle();
  if (!workspace) return notFound();
  const team = await teamDatabase(admin, workspace.id);
  // While a team database is being connected the data is still central.
  const source = team && teamReady(team) ? teamAdmin(team) : admin;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await source.rpc("calendar_feed", { ws: workspace.id, hash });
  if (error || !data) return notFound();
  const body = buildFeed(data as FeedData, { name: workspace.name, host: request.nextUrl.host });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="calendar.ics"',
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
