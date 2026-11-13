import { NextResponse, type NextRequest } from "next/server";
import { driveApi, DriveError } from "@/lib/drive/google-drive";
import { noteDriveError, refreshTokenOf } from "@/lib/drive/storage";
import { browseContext } from "@/lib/drive/vault-browse";

// VAULT-7: a folder of the team's Drive (?ws=<short id>&folder=<id>|root[&page=<token>]),
// for members while the owner keeps the switch on.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ws = params.get("ws") ?? "";
  const folder = params.get("folder") || "root";
  const page = params.get("page");
  if (!/^[a-z0-9]{4,16}$/.test(ws) || !/^[a-zA-Z0-9_-]{1,200}$/.test(folder) || (page && page.length > 2000)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const context = await browseContext(ws);
  if (!context) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!context.state.ok || !context.connection) return NextResponse.json({ ok: false, error: context.state.ok ? "no_drive" : context.state.error }, { status: 403 });
  try {
    const { entries, next } = await driveApi().list(refreshTokenOf(context.connection), folder, page);
    return NextResponse.json({ ok: true, entries, next }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DriveError && error.status === 401) await noteDriveError(context.admin, context.connection, error);
    return NextResponse.json({ ok: false, error: error instanceof DriveError && error.status === 404 ? "not_found" : "drive_error" }, { status: 502 });
  }
}
