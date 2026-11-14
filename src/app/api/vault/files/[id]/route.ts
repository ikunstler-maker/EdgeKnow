import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dataClient } from "@/lib/team-db/data";
import { STREAM_FROM_BYTES, VAULT_FILE_COLUMNS, VAULT_VERSION_COLUMNS, filesHome, readTaskFile, streamTaskFile, type StoredFile } from "@/lib/drive/task-files";
import { linkResponse } from "@/lib/drive/vault-browse";
import { vaultShowsInline } from "@/lib/vault-files";

// A Vault file (?ws=<short id>[&download]). The record is read with the person's own
// session, so the database decides: no role on the file (or a guest), no file. The
// bytes come through our server; nothing is shared from storage or the Drive itself,
// and nothing in a file can run on our site.
export async function GET(request: NextRequest, { params }: RouteContext<"/api/vault/files/[id]">) {
  const { id } = await params;
  const ws = request.nextUrl.searchParams.get("ws") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[a-z0-9]{4,16}$/.test(ws)) return new NextResponse(null, { status: 404 });
  const version = request.nextUrl.searchParams.get("version");
  if (version && !/^[0-9a-f-]{36}$/.test(version)) return new NextResponse(null, { status: 404 });
  const db = await dataClient(ws);
  // VAULT-6: an earlier version of the file (whoever sees the file sees its versions).
  const { data } = version
    ? await db.from("vault_versions").select(VAULT_VERSION_COLUMNS).eq("id", version).eq("item_id", id).maybeSingle()
    : await db.from("vault_items").select(VAULT_FILE_COLUMNS).eq("id", id).eq("kind", "file").is("version_of", null).maybeSingle();
  const found = data as unknown as (StoredFile & { large: boolean }) | null;
  const admin = createAdminClient();
  if (!found || !admin || found.storage_backend === "pending") return new NextResponse(null, { status: 404 });
  // VAULT-7: a link to a file on the team's Drive is read from the Drive as it is now.
  if ((found.storage_backend as string) === "drive_link" && !version) {
    return linkResponse(admin, found, request.nextUrl.searchParams.get("download") === null, request.headers.get("range"));
  }
  const row: StoredFile = { ...found, vault: true };
  const inline = vaultShowsInline(row.mime_type, found.large) && request.nextUrl.searchParams.get("download") === null;
  const headers = {
    "Content-Type": inline ? row.mime_type : "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    // Never kept by the browser: access taken away takes effect at once.
    "Cache-Control": "private, no-store",
  };
  try {
    // A large file is passed on as it arrives from the Drive; the browser may ask for a part.
    if (Number(row.bytes) > STREAM_FROM_BYTES) {
      const stream = await streamTaskFile(admin, row, request.headers.get("range"));
      return new NextResponse(stream.body, { status: stream.status === 206 ? 206 : 200, headers: { ...headers, ...stream.headers } });
    }
    const { rows } = await filesHome(admin, row.workspace_id);
    const bytes = await readTaskFile(admin, rows, row);
    return new NextResponse(Buffer.from(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
