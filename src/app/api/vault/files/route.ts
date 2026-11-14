import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { writeClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { VAULT_FILE_COLUMNS, chatFileLooksLike, filesHome, storeTaskFile, workspaceDestination, type StoredFile } from "@/lib/drive/task-files";
import { VAULT_SMALL_BYTES, vaultChecked } from "@/lib/vault-files";
import { syncVaultSharesLater } from "@/lib/drive/vault-shares";

// Adds a file of up to 4 MB to Vault: ?ws=<short id>&folder=<id or empty>&name=<file name>,
// the bytes as the body with their type. The database checks the right to add there,
// the admin's limit and the storage (begin_vault_file, with the person's own session);
// the server then checks that a picture, PDF or document really is one and stores the
// bytes in the workspace's one storage. Larger files go in parts (./large).
export async function POST(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ws = params.get("ws") ?? "";
  const folder = params.get("folder") || null;
  // VAULT-6: a new version of this file instead of a new file.
  const replace = params.get("replace") || null;
  const name = (params.get("name") ?? "").trim().slice(0, 200);
  const declared = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!/^[a-z0-9]{4,16}$/.test(ws) || (folder && !/^[0-9a-f-]{36}$/.test(folder)) || (replace && !/^[0-9a-f-]{36}$/.test(replace)) || !name) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const central = await createClient();
  const { data: claims } = await central.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (await overLimit(central, "upload")) return tooManyRequests();
  const [admin, db, workspace] = [createAdminClient(), await writeClient(ws), await getWorkspace(ws)];
  if (!admin || !db || !workspace) return NextResponse.json({ ok: false, error: "team_setup" }, { status: 503 });

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > VAULT_SMALL_BYTES) return NextResponse.json({ ok: false, error: "too_large" }, { status: 400 });
  const type = vaultChecked(declared, bytes, chatFileLooksLike);
  if (!type) return NextResponse.json({ ok: false, error: "invalid_file" }, { status: 400 });

  const { data: registered } = replace
    ? await db.rpc("begin_vault_version", { target: replace, file_name: name, file_type: type, file_bytes: bytes.length })
    : await db.rpc("begin_vault_file", { ws: workspace.id, folder, file_name: name, file_type: type, file_bytes: bytes.length });
  const reg = registered as { ok: boolean; error?: string; id?: string; workspace_id?: string } | null;
  if (!reg?.ok || !reg.id) return NextResponse.json({ ok: false, error: reg?.error ?? "unknown" }, { status: 403 });

  const { rows } = await filesHome(admin, workspace.id);
  const forget = () => rows.from("vault_items").delete().eq("id", reg.id!);
  const to = await workspaceDestination(admin, workspace.id);
  if ("error" in to) {
    await forget();
    return NextResponse.json({ ok: false, error: to.error }, { status: 409 });
  }
  const { data: row } = await rows.from("vault_items").select(VAULT_FILE_COLUMNS).eq("id", reg.id).single();
  try {
    await storeTaskFile(admin, rows, { ...(row as unknown as StoredFile), vault: true }, bytes, to);
  } catch {
    await forget();
    return NextResponse.json({ ok: false, error: "upload_failed" }, { status: 502 });
  }
  if (replace) {
    // The stored bytes become the file's current version (with the person's own session).
    const { data: done } = await db.rpc("vault_finish_version", { upload: reg.id });
    const result = done as { ok: boolean; error?: string } | null;
    if (!result?.ok) {
      await forget();
      return NextResponse.json({ ok: false, error: result?.error ?? "unknown" }, { status: 403 });
    }
    if (to.kind === "drive") syncVaultSharesLater(workspace.id);
    return NextResponse.json({ ok: true, id: replace });
  }
  if (to.kind === "drive") syncVaultSharesLater(workspace.id);
  return NextResponse.json({ ok: true, id: reg.id });
}
