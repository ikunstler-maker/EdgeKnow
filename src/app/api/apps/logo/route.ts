import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { writeClient } from "@/lib/team-db/data";
import { APP_LIMITS, LOGO_TYPES } from "@/lib/apps";
import { OBJECT_FILE_COLUMNS, filesHome, storeTaskFile, taskFileLooksLike, workspaceDestination, type StoredFile } from "@/lib/drive/task-files";

// A company app's logo (Obriy, step O-1): ?ws=<short id>&app=<id>&name=<file name>, the
// bytes as the body with their type. The database checks the right to change the app
// (owner and admins only), the type, the 2 MB cap and the storage limit
// (register_object_file, with the person's own session); the server then checks the
// first bytes really are that picture and stores it in the workspace's one storage.
export async function POST(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ws = params.get("ws") ?? "";
  const app = params.get("app") ?? "";
  const name = (params.get("name") ?? "").trim().slice(0, 200) || "logo";
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!/^[a-z0-9]{4,16}$/.test(ws) || !/^[0-9a-f-]{36}$/.test(app) || !LOGO_TYPES.includes(type)) return NextResponse.json({ ok: false, error: "invalid_file" }, { status: 400 });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > APP_LIMITS.logoBytes) return NextResponse.json({ ok: false, error: "too_large" }, { status: 400 });

  const central = await createClient();
  const { data: claims } = await central.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (await overLimit(central, "upload")) return tooManyRequests();
  const admin = createAdminClient();
  const db = await writeClient(ws);
  if (!admin || !db) return NextResponse.json({ ok: false, error: "team_setup" }, { status: 503 });

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > APP_LIMITS.logoBytes) return NextResponse.json({ ok: false, error: "too_large" }, { status: 400 });
  if (!taskFileLooksLike(type, bytes)) return NextResponse.json({ ok: false, error: "invalid_file" }, { status: 400 });

  const { data: registered } = await db.rpc("register_object_file", { target_object: app, file_name: name, file_type: type, file_bytes: bytes.length });
  const reg = registered as { ok: boolean; error?: string; id?: string; workspace_id?: string } | null;
  if (!reg?.ok || !reg.id) return NextResponse.json({ ok: false, error: reg?.error ?? "unknown" }, { status: 403 });

  const { rows } = await filesHome(admin, reg.workspace_id!);
  const forget = () => rows.from("object_files").delete().eq("id", reg.id!);
  const to = await workspaceDestination(admin, reg.workspace_id!);
  if ("error" in to) {
    await forget();
    return NextResponse.json({ ok: false, error: to.error }, { status: 409 });
  }
  const { data: row } = await rows.from("object_files").select(OBJECT_FILE_COLUMNS).eq("id", reg.id).single();
  try {
    await storeTaskFile(admin, rows, row as StoredFile, bytes, to);
  } catch {
    await forget();
    return NextResponse.json({ ok: false, error: "upload_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, id: reg.id });
}
