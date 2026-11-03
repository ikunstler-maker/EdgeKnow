import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { writeClient } from "@/lib/team-db/data";
import { fail, readBytes, readUpload, storeRegistered } from "@/lib/survey-uploads";

// A file for an answer inside the workspace: ?ws=<short id>&survey=<id>&name=<file name>,
// the bytes as the body with their type. The database checks (with the person's
// own session) that they may answer and that the survey is open.
export async function POST(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ws = params.get("ws") ?? "";
  const survey = params.get("survey") ?? "";
  const upload = readUpload(request);
  if (!/^[a-z0-9]{4,16}$/.test(ws) || !/^[0-9a-f-]{36}$/.test(survey) || !upload.ok) return fail("invalid_file", 400);

  const central = await createClient();
  const { data: claims } = await central.auth.getClaims();
  if (!claims?.claims?.sub) return fail("unauthorized", 401);
  if (await overLimit(central, "upload")) return tooManyRequests();
  const admin = createAdminClient();
  const db = await writeClient(ws);
  if (!admin || !db) return fail("team_setup", 503);

  const bytes = await readBytes(request, upload.type);
  if (!(bytes instanceof Uint8Array)) return bytes;
  const { data } = await db.rpc("register_survey_file", { target_object: survey, file_name: upload.name, file_type: upload.type, file_bytes: bytes.length });
  const reg = data as { ok: boolean; error?: string; id?: string; workspace_id?: string } | null;
  if (!reg?.ok || !reg.id || !reg.workspace_id) return fail(reg?.error ?? "unknown", 403);
  return storeRegistered(admin, { id: reg.id, workspace_id: reg.workspace_id }, bytes);
}
