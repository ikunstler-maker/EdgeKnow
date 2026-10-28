import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/drive/owner";
import { sign } from "@/lib/drive/secret-box";
import { authorizeUrl, pkcePair, supabaseCallbackUrl, supabaseOAuthConfigured } from "@/lib/team-db/supabase-api";

// Step 1 of connecting the team's own Supabase (workspace owner only): off to
// Supabase's consent screen with a signed state and a PKCE challenge.
export async function GET(request: NextRequest) {
  const ws = request.nextUrl.searchParams.get("ws") ?? "";
  if (!supabaseOAuthConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const owner = await requireOwner(ws);
  if (!owner) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { verifier, challenge } = pkcePair();
  const state = sign({ ws, u: owner.userId, exp: Date.now() + 10 * 60 * 1000, n: randomUUID() });
  (await cookies()).set("ek-sb-pkce", sign({ v: verifier, ws }), {
    path: "/api/supabase",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
  });
  return NextResponse.redirect(authorizeUrl(supabaseCallbackUrl(request.nextUrl.origin), state, challenge));
}
