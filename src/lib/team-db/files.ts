import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/drive/secret-box";
import { createAdminClient } from "@/lib/supabase/admin";
import { teamDatabase, teamReady, type TeamDatabase } from "./sync";
import { dataClient } from "./data";

// Files of a team workspace (path C, step 1.6): the attachment rows are in the
// team database, the bytes in the team's own Supabase Storage. Reads of the row
// go with the person's EdgeKnow token (the team's RLS decides); the bytes are
// handled with the team's secret key, on our server only.

export const TEAM_BUCKET = "attachments";

// The team database behind a file path (<workspace id>/<page>/<file>), or null
// when the workspace keeps its files centrally.
export async function teamOfPath(path: string): Promise<{ db: TeamDatabase; shortId: string } | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const workspaceId = path.split("/")[0];
  const db = await teamDatabase(admin, workspaceId);
  if (!db || !teamReady(db)) return null;
  const { data } = await admin.from("workspaces").select("short_id").eq("id", workspaceId).maybeSingle();
  return data ? { db, shortId: data.short_id } : null;
}

// The team's storage with its secret key.
export function teamStorage(db: TeamDatabase): SupabaseClient {
  return createSupabaseClient(db.project_url!, decrypt(db.secret_key_encrypted!), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The person's own view of the team database (null if they aren't a member).
export const teamDataFor = (shortId: string) => dataClient(shortId);
