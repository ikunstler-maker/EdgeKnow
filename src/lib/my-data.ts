import "server-only";
import { activeConnection } from "@/lib/drive/storage";
import { moveMemberFiles } from "@/lib/drive/member-files";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { teamAdmin } from "@/lib/team-db/files";
import { teamReady, type TeamDatabase } from "@/lib/team-db/sync";
import { workspaceData } from "@/lib/team-db/data";

// A person's own data (GDPR): everything about them in one file, and deleting
// their account. Pages they own stay with their team (the workspace owner gets
// them); comments and history stay as "former member".

type Membership = { workspace_id: string; role: string; joined_via: string; joined_at: string; workspace: { short_id: string; name: string } | null };

export async function exportMyData(userId: string) {
  const central = await createClient();
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    central.from("profiles").select("id, email, name, avatar_url, theme, locale, created_at").eq("id", userId).maybeSingle(),
    central
      .from("workspace_members")
      .select("workspace_id, role, joined_via, joined_at, workspace:workspaces(short_id, name)")
      .eq("user_id", userId)
      .eq("status", "active")
      .overrideTypes<Membership[], { merge: false }>(),
  ]);
  const workspaces = [];
  for (const m of memberships ?? []) {
    if (!m.workspace) continue;
    const data = await workspaceData(m.workspace.short_id).catch(() => null);
    if (!data) continue;
    const rows = async (query: PromiseLike<{ data: unknown[] | null }>) => (await query).data ?? [];
    const db: SupabaseClient = data.client;
    // A guest takes nothing of the workspace with them: only that they were in it.
    if (m.role === "guest") {
      workspaces.push({ name: m.workspace.name, role: m.role, joined_via: m.joined_via, joined_at: m.joined_at });
      continue;
    }
    workspaces.push({
      name: m.workspace.name,
      role: m.role,
      joined_via: m.joined_via,
      joined_at: m.joined_at,
      pages: await rows(
        db.from("pages").select("id, title, icon, content, created_at, updated_at, deleted_at").eq("workspace_id", m.workspace_id).or(`owner_id.eq.${userId},created_by.eq.${userId}`),
      ),
      comments: await rows(db.from("comments").select("id, body, created_at, edited_at, thread_id").eq("workspace_id", m.workspace_id).eq("author_id", userId)),
      tasks: await rows(
        db.from("tasks").select("project_id, number, title, description, type, priority, due_date, created_at, updated_at").eq("workspace_id", m.workspace_id).or(`reporter_id.eq.${userId},assignee_id.eq.${userId}`),
      ),
      task_comments: await rows(db.from("task_comments").select("id, task_id, body, created_at, edited_at").eq("workspace_id", m.workspace_id).eq("author_id", userId)),
      service_objects: await rows(db.from("service_objects").select("id, service, kind, title, data, created_at, updated_at").eq("workspace_id", m.workspace_id).eq("created_by", userId)),
      task_files: await rows(db.from("task_files").select("id, task_id, name, mime_type, bytes, drive_source, created_at").eq("workspace_id", m.workspace_id).eq("uploaded_by", userId)),
      // Vault (VAULT-4): the person's own folders and files (names, sizes, dates; the bytes are downloaded from Vault).
      vault_items: await rows(db.from("vault_items").select("id, parent_id, kind, name, mime_type, bytes, created_at, updated_at, deleted_at").eq("workspace_id", m.workspace_id).eq("owner_id", userId)),
      board_pictures: await rows(db.from("object_files").select("id, object_id, name, mime_type, bytes, created_at").eq("workspace_id", m.workspace_id).eq("uploaded_by", userId)),
      // Answer tables are function-only: the database returns just this person's named answers.
      survey_answers: (await db.rpc("my_survey_answers", { ws: m.workspace_id })).data ?? [],
      page_confirmations: await rows(db.from("page_acks").select("page_id, revision, label, content_hash, signed_at").eq("workspace_id", m.workspace_id).eq("user_id", userId)),
      calendar_events: await rows(
        db.from("calendar_events").select("id, title, description, location, meeting_url, starts_at, ends_at, all_day, time_zone, visibility, repeat_freq, repeat_interval, repeat_days, repeat_until, created_at, deleted_at").eq("workspace_id", m.workspace_id).eq("organizer_id", userId),
      ),
      time_off_requests: await rows(
        db.from("leave_requests").select("policy_id, start_date, end_date, half, days, comment, status, decided_at, decision_note, cancelled_at, created_at").eq("workspace_id", m.workspace_id).eq("user_id", userId),
      ),
      time_off_start: await rows(db.from("leave_member_settings").select("started_on, birth_month, birth_day, birth_year, birthday_shown").eq("workspace_id", m.workspace_id).eq("user_id", userId)),
      time_off_ledger: await rows(db.from("leave_balances").select("policy_id, year, kind, month, days, note, created_at").eq("workspace_id", m.workspace_id).eq("user_id", userId)),
      // Busy time read from the person's outside calendar (starts and ends; the address itself is not kept readable).
      calendar_outside_busy: await rows(db.from("calendar_external_busy").select("starts_at, ends_at, all_day, title, busy").eq("workspace_id", m.workspace_id).eq("user_id", userId)),
      calendar_answers: await rows(db.from("calendar_event_attendees").select("event_id, status, created_at, responded_at").eq("workspace_id", m.workspace_id).eq("user_id", userId)),
      statistics: await rows(db.from("page_contributions").select("page_id, chars_added, chars_removed, saves, last_saved_at").eq("workspace_id", m.workspace_id).eq("user_id", userId)),
    });
  }
  const admin = createAdminClient();
  const log = admin
    ? ((await admin.from("audit_log").select("action, created_at, workspace_id").eq("actor_id", userId).order("created_at", { ascending: false }).limit(1000)).data ?? [])
    : [];
  return { format: "edgeknow-my-data/1", exported_at: new Date().toISOString(), profile, workspaces, my_actions: log };
}

export type DeleteResult = { ok: true } | { ok: false; error: string; workspaces?: string[] };

export async function deleteMyAccount(userId: string): Promise<DeleteResult> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "not_configured" };
  const { data: owned } = await admin.from("workspaces").select("name").eq("owner_id", userId).order("name");
  if (owned?.length) return { ok: false, error: "owns_workspaces", workspaces: owned.map((w) => w.name as string) };

  // Team databases first: their pages to the workspace owner, their copy of the profile out.
  const { data: memberOf } = await admin.from("workspace_members").select("workspace_id").eq("user_id", userId);
  const ids = (memberOf ?? []).map((m) => m.workspace_id as string);
  // Task files on their own Google Drive would go with the account: copied first
  // to the wiki's Drive, or else to EdgeKnow's storage (best effort).
  for (const ws of ids) {
    const wiki = await activeConnection(admin, ws).catch(() => null);
    await moveMemberFiles(admin, ws, userId, wiki?.status === "ok" ? "wiki" : "edgeknow", 15_000).catch(() => null);
  }

  if (ids.length) {
    const { data: teams } = await admin
      .from("team_databases")
      .select("workspace_id, project_url, publishable_key, secret_key_encrypted, db_url_encrypted, schema_version, status, setup_step, return_step, health")
      .in("workspace_id", ids);
    for (const db of (teams ?? []) as TeamDatabase[]) {
      if (!teamReady(db)) continue;
      try {
        const team = teamAdmin(db);
        const { data: ws } = await team.from("workspaces").select("owner_id").eq("id", db.workspace_id).maybeSingle();
        if (ws?.owner_id) {
          const { error } = await team.from("pages").update({ owner_id: ws.owner_id }).eq("workspace_id", db.workspace_id).eq("owner_id", userId);
          if (error) throw error;
        }
        const { error } = await team.from("profiles").delete().eq("id", userId);
        if (error) throw error;
      } catch {
        // Nothing is deleted centrally while a team database still holds their data.
        return { ok: false, error: "team_unreachable" };
      }
    }
  }

  const { data: cleaned, error } = await admin.rpc("account_deletion_cleanup", { person: userId });
  const result = cleaned as DeleteResult | null;
  if (error || !result) return { ok: false, error: "unknown" };
  if (!result.ok) return result;
  // Their own picture goes too (best effort).
  await admin.storage.from("avatars").remove([`${userId}/avatar`]).catch(() => null);
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) return { ok: false, error: "unknown" };
  return { ok: true };
}
