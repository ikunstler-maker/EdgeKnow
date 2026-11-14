import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { driveApi, driveConfigured } from "@/lib/drive/google-drive";
import { requireOwner } from "@/lib/drive/owner";
import { sign } from "@/lib/drive/secret-box";

// Step 1 of connecting Google Drive (workspace owner only): off to Google's
// consent screen with a signed, short-lived "state" naming the workspace and person.
// `browse=1` (VAULT-7): the same Drive again, now also allowed to be read in Vault.
export async function GET(request: NextRequest) {
  const ws = request.nextUrl.searchParams.get("ws") ?? "";
  if (!driveConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const owner = await requireOwner(ws);
  if (!owner) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const browse = request.nextUrl.searchParams.get("browse") === "1";
  const state = sign({ ws, u: owner.userId, exp: Date.now() + 10 * 60 * 1000, n: randomUUID(), ...(browse ? { b: 1 } : {}) });
  return NextResponse.redirect(driveApi().authUrl(`${request.nextUrl.origin}/api/drive/callback`, state, browse));
}
