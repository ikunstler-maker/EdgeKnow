import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { filesHome } from "@/lib/drive/task-files";
import { fail, readBytes, readUpload, storeRegistered } from "@/lib/survey-uploads";

// A file for an answer through the link for anyone (step О3): ?ws=<short id>&token=<link>&name=<file name>.
// Only for someone signed in to EdgeKnow (the form says so to everyone else);
// the database checks the link is on and the survey open.
export async function POST(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ws = params.get("ws") ?? "";
  const token = params.get("token") ?? "";
  const upload = readUpload(request);
  if (!/^[a-z0-9]{4,16}$/.test(ws) || !/^[0-9a-f]{32}$/.test(token) || !upload.ok) return fail("invalid_file", 400);

  const central = await createClient();
  const { data: claims } = await central.auth.getClaims();
  if (!claims?.claims?.sub) return fail("sign_in", 401);
  if (await overLimit(central, "upload")) return tooManyRequests();
  const admin = createAdminClient();
  if (!admin) return fail("team_setup", 503);
  const { data: workspace } = await admin.from("workspaces").select("id").eq("short_id", ws).maybeSingle();
  if (!workspace) return fail("not_found", 404);

  const bytes = await readBytes(request, upload.type);
  if (!(bytes instanceof Uint8Array)) return bytes;
  const { rows } = await filesHome(admin, workspace.id);
  const { data } = await rows.rpc("register_public_survey_file", { token, file_name: upload.name, file_type: upload.type, file_bytes: bytes.length });
  const reg = data as { ok: boolean; error?: string; id?: string; workspace_id?: string } | null;
  if (!reg?.ok || !reg.id || reg.workspace_id !== workspace.id) return fail(reg?.error ?? "unknown", 403);
  return storeRegistered(admin, { id: reg.id, workspace_id: workspace.id }, bytes);
}
