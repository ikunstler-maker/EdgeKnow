import { NextResponse, type NextRequest } from "next/server";
import { driveApi, DriveError } from "@/lib/drive/google-drive";
import { noteDriveError, refreshTokenOf } from "@/lib/drive/storage";
import { browseContext, driveFileResponse } from "@/lib/drive/vault-browse";

// VAULT-7: a file of the team's Drive (?ws=<short id>&id=<Drive id>[&show]): a download,
// or a picture or PDF shown in place. Google's documents come as a PDF.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ws = params.get("ws") ?? "";
  const id = params.get("id") ?? "";
  if (!/^[a-z0-9]{4,16}$/.test(ws) || !/^[a-zA-Z0-9_-]{1,200}$/.test(id)) return new NextResponse(null, { status: 404 });
  const context = await browseContext(ws);
  if (!context?.state.ok || !context.connection) return new NextResponse(null, { status: 403 });
  try {
    const entry = await driveApi().entry(refreshTokenOf(context.connection), id);
    if (entry.folder || entry.trashed) return new NextResponse(null, { status: 404 });
    return driveFileResponse(context.admin, context.connection, id, entry, params.has("show"), request.headers.get("range"));
  } catch (error) {
    if (error instanceof DriveError && error.status === 401) await noteDriveError(context.admin, context.connection, error);
    return new NextResponse(null, { status: error instanceof DriveError && error.status === 404 ? 404 : 502 });
  }
}
