import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encryptTeam, encryptWithOldKey, isTeamKeyed, needsTeamRekey } from "@/lib/drive/secret-box";

// Moving the team databases' secrets onto TEAM_DB_KEY ("v2.team…") — or back onto
// DRIVE_TOKEN_KEY ("v1…") for a rollback. A new value is written only after it is
// read back to the same secret, and only if nobody changed the old one meanwhile.
const COLUMNS = ["secret_key_encrypted", "db_url_encrypted", "management_token_encrypted"] as const;
const SELECT = "workspace_id, secret_key_encrypted, db_url_encrypted, management_token_encrypted";
type Row = { workspace_id: string } & Partial<Record<(typeof COLUMNS)[number], string | null>>;

export type RekeyResult = { changed: number; failed: number };

export async function rekeyTeamSecrets(admin: SupabaseClient, direction: "new" | "old" = "new"): Promise<RekeyResult> {
  const { data, error } = await admin.from("team_databases").select(SELECT);
  if (error) return { changed: 0, failed: 1 };
  let changed = 0;
  let failed = 0;
  for (const row of (data ?? []) as unknown as Row[]) {
    for (const column of COLUMNS) {
      const value = row[column];
      if (!value || !(direction === "new" ? needsTeamRekey(value) : isTeamKeyed(value))) continue;
      try {
        const plain = decrypt(value);
        const next = direction === "new" ? encryptTeam(plain) : encryptWithOldKey(plain);
        if (decrypt(next) !== plain) throw new Error("check failed");
        const { data: updated, error: updateError } = await admin
          .from("team_databases")
          .update({ [column]: next })
          .eq("workspace_id", row.workspace_id)
          .eq(column, value)
          .select("workspace_id");
        if (updateError) throw updateError;
        if (updated?.length) changed += 1;
      } catch {
        failed += 1;
      }
    }
  }
  return { changed, failed };
}

// For the platform panel: how many team databases have every secret on the new key.
export async function teamKeyStatus(admin: SupabaseClient) {
  const { data } = await admin.from("team_databases").select(SELECT);
  const rows = (data ?? []) as unknown as Row[];
  const onNewKey = rows.filter((row) => COLUMNS.every((column) => !row[column] || isTeamKeyed(row[column]))).length;
  return { configured: (process.env.TEAM_DB_KEY ?? "").length >= 24, total: rows.length, onNewKey };
}
