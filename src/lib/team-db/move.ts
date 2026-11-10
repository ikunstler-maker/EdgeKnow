import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Moving a workspace's existing data into its team's own database (path C,
// step 1.7b), and back to the central database (1.7c, "in" and "back" below).
// Runs as two steps, a little at a time (each call has under a minute):
//   copy   — table by table, in portions; every portion is an "insert or
//            overwrite", so a repeated or interrupted portion is harmless;
//   verify — row counts of every table and every page's title and contents must
//            match exactly; otherwise nothing switches.
// The side copied from is only read, never changed.

const BATCH = 200;
const FILE_BATCH = 20;

export type CopyProgress = { stage: number; offset: number };

type Stage = {
  name: string;
  table: string;
  columns: string;
  order: string;
  onConflict: string;
  // Pages and tasks go in twice: first without their parent (so a child never
  // comes before its parent), then with it.
  flatten?: boolean;
  merge?: boolean;
  // Storage bucket of the rows' files (true: the wiki's "attachments").
  files?: boolean | string;
  // The team database fills these itself when pages arrive (from what it can see
  // so far), so its own rows are cleared first and the central ones taken as they are.
  replace?: boolean;
};

const TASK_COLUMNS =
  "id, workspace_id, project_id, number, title, description, status_id, type, priority, assignee_id, reporter_id, labels, start_date, due_date, estimate, parent_id, position, created_at, updated_at, updated_by, done_at, deleted_at, deleted_by, custom, private";

const PAGE_COLUMNS =
  "id, parent_id, owner_id, title, icon, position, content, version, created_at, updated_at, updated_by, deleted_at, deleted_by, trashed_with, workspace_id, created_by, inherit, workspace_role, cover, ack_label, ack_revision, ack_editing, ack_groups, published_at";

const STAGES: Stage[] = [
  { name: "pages", table: "pages", columns: PAGE_COLUMNS, order: "id", onConflict: "id", flatten: true },
  { name: "page tree", table: "pages", columns: "id, parent_id, workspace_id", order: "id", onConflict: "id", merge: true },
  // Confirmations of reading: what each revision showed, then who signed it.
  {
    name: "confirmation revisions",
    table: "page_ack_revisions",
    columns: "page_id, workspace_id, revision, label, title, content, content_hash, published_by, published_at",
    order: "page_id,revision",
    onConflict: "page_id,revision",
  },
  {
    name: "confirmations",
    table: "page_acks",
    columns: "page_id, workspace_id, revision, user_id, label, content_hash, signed_at",
    order: "page_id,revision,user_id",
    onConflict: "page_id,revision,user_id",
  },
  { name: "access", table: "page_access", columns: "id, workspace_id, page_id, user_id, role, granted_by, created_at", order: "id", onConflict: "id" },
  {
    // The groups themselves come with the member sync (they live centrally).
    name: "group access",
    table: "page_group_access",
    columns: "workspace_id, page_id, group_id, role, granted_by, created_at",
    order: "page_id,group_id",
    onConflict: "page_id,group_id",
    replace: true,
  },
  {
    name: "threads",
    table: "comment_threads",
    columns: "id, workspace_id, page_id, quoted_text, status, created_by, created_at, resolved_by, resolved_at",
    order: "id",
    onConflict: "id",
  },
  { name: "comments", table: "comments", columns: "id, workspace_id, thread_id, author_id, body, mentions, created_at, edited_at", order: "id", onConflict: "id" },
  {
    name: "files",
    table: "attachments",
    columns: "id, workspace_id, page_id, storage_path, mime_type, bytes, width, height, uploaded_by, created_at, storage_backend, drive_connection_id, drive_file_id",
    order: "id",
    onConflict: "id",
    files: true,
  },
  {
    name: "mentions",
    table: "page_mentions",
    columns: "workspace_id, page_id, user_id, mentioned_by, created_at",
    order: "page_id,user_id",
    onConflict: "page_id,user_id",
    replace: true,
  },
  {
    name: "statistics",
    table: "page_contributions",
    columns: "workspace_id, page_id, user_id, chars_added, chars_removed, saves, last_saved_at",
    order: "page_id,user_id",
    onConflict: "page_id,user_id",
  },
  // Tasks (stage 2a): projects, their columns and access, tasks (flat, then the
  // tree of subtasks), comments, and the history (the target writes its own
  // while tasks arrive, so the source's replaces it).
  {
    name: "task projects",
    table: "task_projects",
    columns: "id, workspace_id, key, name, icon, workspace_role, sprints, next_number, card_fields, files_target, time_last_column, frozen_moves_admin, created_by, created_at, archived_at",
    order: "id",
    onConflict: "id",
  },
  {
    name: "task fields",
    table: "task_fields",
    columns: "id, project_id, workspace_id, name, kind, options, required, task_types, position, hint, created_at",
    order: "id",
    onConflict: "id",
  },
  { name: "task boards", table: "task_boards", columns: "id, workspace_id, project_id, name, group_id, position, created_by, created_at", order: "id", onConflict: "id" },
  { name: "board access", table: "task_board_access", columns: "board_id, workspace_id, group_id", order: "board_id,group_id", onConflict: "board_id,group_id" },
  { name: "task columns", table: "task_statuses", columns: "id, project_id, workspace_id, name, category, position, wip_limit, board_id, freezes, created_at", order: "id", onConflict: "id" },
  {
    name: "task rules",
    table: "task_rules",
    columns: "id, workspace_id, project_id, event, category, status_id, notify_roles, notify_users, notify_groups, move_to_status, created_by, created_at",
    order: "id",
    onConflict: "id",
  },
  {
    name: "task templates",
    table: "task_templates",
    columns: "id, workspace_id, project_id, owner_id, name, data, is_default, created_by, created_at, updated_at",
    order: "id",
    onConflict: "id",
  },
  {
    name: "project access",
    table: "task_project_access",
    columns: "project_id, workspace_id, user_id, role, granted_by, created_at",
    order: "project_id,user_id",
    onConflict: "project_id,user_id",
    replace: true,
  },
  {
    name: "project group access",
    table: "task_project_group_access",
    columns: "project_id, workspace_id, group_id, role, granted_by, created_at",
    order: "project_id,group_id",
    onConflict: "project_id,group_id",
    replace: true,
  },
  // Objects of the services (node space…) and who may open them.
  {
    name: "service objects",
    table: "service_objects",
    columns: "id, workspace_id, service, kind, title, icon, data, search_text, version, owner_id, created_by, workspace_role, created_at, updated_at, updated_by, deleted_at, deleted_by",
    order: "id",
    onConflict: "id",
  },
  {
    name: "object access",
    table: "service_object_access",
    columns: "object_id, workspace_id, user_id, role, granted_by, created_at",
    order: "object_id,user_id",
    onConflict: "object_id,user_id",
    replace: true,
  },
  {
    name: "object group access",
    table: "service_object_group_access",
    columns: "object_id, workspace_id, group_id, role, granted_by, created_at",
    order: "object_id,group_id",
    onConflict: "object_id,group_id",
    replace: true,
  },
  // Surveys: how each takes answers, the answers and who answered (copied whole each time).
  {
    name: "survey settings",
    table: "survey_settings",
    columns: "object_id, workspace_id, anonymous, once, editable, accepting, closes_at, max_responses, sheet_id, sheet_name, sheet_columns, sheet_labels, sheet_full, updated_by, updated_at, public_enabled, public_token",
    order: "object_id",
    onConflict: "object_id",
    replace: true,
  },
  { name: "collections", table: "object_collections", columns: "id, workspace_id, service, name, position, created_by, created_at", order: "id", onConflict: "id" },
  {
    name: "collection entries",
    table: "object_collection_items",
    columns: "collection_id, object_id, workspace_id, position",
    order: "collection_id,object_id",
    onConflict: "collection_id,object_id",
  },
  {
    // Board pictures and files in survey answers: before the answers that name them.
    name: "object files",
    table: "object_files",
    columns: "id, workspace_id, object_id, name, mime_type, bytes, storage_path, storage_backend, drive_source, drive_account_id, drive_file_id, uploaded_by, created_at",
    order: "id",
    onConflict: "id",
    files: "task-files",
  },
  {
    name: "board sessions",
    table: "board_sessions",
    columns: "object_id, workspace_id, votes_per_person, voting_open, timer_ends_at, timer_seconds, updated_by, updated_at",
    order: "object_id",
    onConflict: "object_id",
  },
  {
    name: "board votes",
    table: "board_votes",
    columns: "object_id, workspace_id, element_id, user_id, created_at",
    order: "object_id,element_id,user_id",
    onConflict: "object_id,element_id,user_id",
  },
  {
    name: "survey answers",
    table: "survey_responses",
    columns: "id, object_id, workspace_id, user_id, answers, sheet_row, created_at, updated_at, public, respondent_name, respondent_email",
    order: "id",
    onConflict: "id",
    replace: true,
  },
  {
    name: "who answered surveys",
    table: "survey_respondents",
    columns: "object_id, workspace_id, user_id",
    order: "object_id,user_id",
    onConflict: "object_id,user_id",
    replace: true,
  },
  { name: "tasks", table: "tasks", columns: TASK_COLUMNS, order: "id", onConflict: "id", flatten: true },
  { name: "task tree", table: "tasks", columns: "id, parent_id, workspace_id", order: "id", onConflict: "id", merge: true },
  // Pages that mention tasks (after both are there; the pages' own trigger can't see tasks yet).
  {
    name: "task mentions on pages",
    table: "task_page_links",
    columns: "workspace_id, page_id, task_id, created_at",
    order: "page_id,task_id",
    onConflict: "page_id,task_id",
    replace: true,
  },
  { name: "task places on boards", table: "task_placements", columns: "task_id, workspace_id, board_key, board_id, status_id, frozen_at, snapshot, updated_at", order: "task_id,board_key", onConflict: "task_id,board_key" },
  { name: "task participants", table: "task_participants", columns: "task_id, workspace_id, user_id, role, added_by, added_at", order: "task_id,user_id", onConflict: "task_id,user_id" },
  { name: "task links", table: "task_links", columns: "id, workspace_id, source_id, target_id, kind, created_by, created_at", order: "id", onConflict: "id" },
  {
    name: "task files",
    table: "task_files",
    columns: "id, workspace_id, task_id, name, mime_type, bytes, storage_path, storage_backend, drive_source, drive_account_id, drive_file_id, uploaded_by, created_at",
    order: "id",
    onConflict: "id",
    files: "task-files",
  },
  { name: "task comments", table: "task_comments", columns: "id, workspace_id, task_id, author_id, body, mentions, created_at, edited_at", order: "id", onConflict: "id" },
  {
    name: "task history",
    table: "task_events",
    columns: "id, workspace_id, task_id, actor_id, field, old_value, new_value, created_at",
    order: "id",
    onConflict: "id",
    replace: true,
  },
  {
    name: "calendar events",
    table: "calendar_events",
    columns: "id, workspace_id, title, description, location, meeting_url, starts_at, ends_at, all_day, time_zone, visibility, recurrence, repeat_freq, repeat_interval, repeat_days, repeat_until, repeat_count, reminder_minutes, invited_group_ids, organizer_id, created_by, created_at, updated_at, deleted_at, deleted_by",
    order: "id",
    onConflict: "id",
  },
  // People of events have no id of their own: the other side's rows are cleared and taken again.
  {
    name: "people of events",
    table: "calendar_event_attendees",
    columns: "event_id, workspace_id, user_id, status, invited_by, created_at, responded_at",
    order: "event_id,user_id",
    onConflict: "event_id,user_id",
    replace: true,
  },
  {
    name: "changed days of series",
    table: "calendar_event_exceptions",
    columns: "event_id, workspace_id, occurrence_date, cancelled, starts_at, ends_at, title, description, location, meeting_url, updated_by, updated_at",
    order: "event_id,occurrence_date",
    onConflict: "event_id,occurrence_date",
    replace: true,
  },
  { name: "calendar settings", table: "calendar_settings", columns: "workspace_id, work_days, time_zone, updated_by, updated_at", order: "workspace_id", onConflict: "workspace_id" },
  { name: "time-off policies", table: "leave_policies", columns: "id, workspace_id, name, kind, days_per_year, carry_over_max, count_days, requires_approval, requires_deputy, show_kind, allow_negative, unlimited, active, accrual, position, created_by, created_at, updated_at", order: "id", onConflict: "id" },
  { name: "holidays", table: "leave_holidays", columns: "id, workspace_id, day, name, created_by, created_at", order: "id", onConflict: "id" },
  { name: "calendar feeds", table: "calendar_feeds", columns: "workspace_id, user_id, token_hash, created_at", order: "user_id", onConflict: "workspace_id,user_id" },
  { name: "start dates", table: "leave_member_settings", columns: "workspace_id, user_id, started_on, updated_by, updated_at", order: "user_id", onConflict: "workspace_id,user_id" },
  { name: "time-off ledger", table: "leave_balances", columns: "id, workspace_id, policy_id, user_id, year, kind, month, days, note, created_by, created_at", order: "id", onConflict: "id" },
  {
    name: "time-off requests",
    table: "leave_requests",
    columns: "id, workspace_id, user_id, policy_id, start_date, end_date, half, days, comment, deputy_id, status, group_ids, decided_by, decided_at, decision_note, cancelled_by, cancelled_at, created_at, updated_at",
    order: "id",
    onConflict: "id",
  },
  { name: "notification settings", table: "notification_prefs", columns: "workspace_id, user_id, muted, updated_at", order: "user_id", onConflict: "workspace_id,user_id" },
  {
    name: "notifications",
    table: "notifications",
    columns: "id, workspace_id, user_id, kind, actor_id, task_id, page_id, status_id, event_id, event_at, leave_request_id, created_at, read_at",
    order: "id",
    onConflict: "id",
  },
];

// Tables compared row for row in "verify" (audit log entries get new ids, so they are only copied).
const COUNTED = ["service_objects", "object_collections", "object_collection_items", "service_object_access", "service_object_group_access", "survey_settings", "survey_responses", "survey_respondents", "object_files", "board_sessions", "board_votes", "task_projects", "task_fields", "task_boards", "task_board_access", "task_placements", "task_statuses", "task_project_access", "task_project_group_access", "tasks", "task_links", "task_page_links", "task_files", "task_comments", "task_events", "task_participants", "task_rules", "task_templates", "calendar_events", "calendar_event_attendees", "calendar_event_exceptions", "calendar_settings", "leave_policies", "leave_holidays", "leave_member_settings", "leave_balances", "leave_requests", "notification_prefs", "notifications", "pages", "page_access", "page_group_access", "comment_threads", "comments", "attachments", "page_mentions", "page_contributions", "page_ack_revisions", "page_acks"];

export type CopyResult = { done: boolean; stage: string; copied: number };

export type Direction = "in" | "back";

// One portion of the copy: "in" from the central database (`admin`) into the
// team database (`team`, with its secret key), "back" the other way.
export async function copyPortion(
  admin: SupabaseClient,
  team: SupabaseClient,
  ws: string,
  progress: CopyProgress | null,
  direction: Direction = "in",
  // Moving back: when the workspace moved in (its log entries from then on are new).
  movedAt: string | null = null,
): Promise<{ result: CopyResult; next: CopyProgress | null }> {
  const [from, to] = direction === "in" ? [admin, team] : [team, admin];
  const at = progress ?? { stage: -1, offset: 0 };

  if (at.stage === -1) {
    // Whatever is gone on the side copied from (trash emptied overnight, a
    // page deleted in the team) goes on the other side too, so the counts can match.
    await prune(from, to, ws);
    if (direction === "back") {
      // People live centrally anyway; only the log entries written in the team
      // since the move, each once (a repeated copy skips what is already back).
      let teamLog = team.from("audit_log").select("workspace_id, actor_id, action, details, created_at").eq("workspace_id", ws).order("created_at").limit(5000);
      let centralLog = admin.from("audit_log").select("actor_id, action, created_at").eq("workspace_id", ws).limit(10000);
      if (movedAt) {
        teamLog = teamLog.gt("created_at", movedAt);
        centralLog = centralLog.gt("created_at", movedAt);
      }
      const [{ data: entries, error: readError }, { data: present }] = await Promise.all([teamLog, centralLog]);
      if (readError) throw new Error(`log: ${readError.message}`);
      const key = (row: Record<string, unknown>) => `${Date.parse(String(row.created_at))}|${row.action}|${row.actor_id}`;
      const already = new Set((present ?? []).map(key));
      const log = (entries ?? []).filter((row) => !already.has(key(row)));
      if (log.length) {
        const { error: logError } = await admin.from("audit_log").insert(log);
        if (logError) throw new Error(`log: ${logError.message}`);
      }
      return { result: { done: false, stage: "log", copied: log.length }, next: { stage: 0, offset: 0 } };
    }
    // Moving in: the people all that data points to, then the (recent) workspace log.
    const { data: people, error } = await admin.rpc("team_move_people", { ws });
    if (error) throw new Error(`people: ${error.message}`);
    const rows = (people ?? []) as Record<string, unknown>[];
    if (rows.length) {
      const { error: insertError } = await team.from("profiles").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (insertError) throw new Error(`people: ${insertError.message}`);
    }
    const { count } = await team.from("audit_log").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    if (!count) {
      const { data: log } = await admin
        .from("audit_log")
        .select("workspace_id, actor_id, action, details, created_at")
        .eq("workspace_id", ws)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (log?.length) {
        const { error: logError } = await team.from("audit_log").insert(log);
        if (logError) throw new Error(`log: ${logError.message}`);
      }
    }
    return { result: { done: false, stage: "people", copied: rows.length }, next: { stage: 0, offset: 0 } };
  }

  const stage = STAGES[at.stage];
  if (!stage) return { result: { done: true, stage: "done", copied: 0 }, next: null };
  const size = stage.files ? FILE_BATCH : BATCH;
  if (stage.replace && at.offset === 0) {
    const { error: clearError } = await to.from(stage.table).delete().eq("workspace_id", ws);
    if (clearError) throw new Error(`${stage.name}: ${clearError.message}`);
  }
  // Every key column in order, so batches never skip or repeat rows.
  const ordered = stage.order.split(",").reduce((q, column) => q.order(column), from.from(stage.table).select(stage.columns).eq("workspace_id", ws));
  const { data, error } = await ordered.range(at.offset, at.offset + size - 1);
  if (error) throw new Error(`${stage.name}: ${error.message}`);
  let rows = (data ?? []) as unknown as Record<string, unknown>[];

  if (rows.length) {
    if (stage.flatten) rows = rows.map((row) => ({ ...row, parent_id: null }));
    if (stage.merge) {
      // Parents are all in place now; only pages that have one need the update.
      for (const row of rows.filter((r) => r.parent_id)) {
        const { error: updateError } = await to.from(stage.table).update({ parent_id: row.parent_id }).eq("id", row.id as string);
        if (updateError) throw new Error(`${stage.name}: ${updateError.message}`);
      }
    } else {
      if (stage.files) await copyFiles(from, to, rows, stage.files === true ? "attachments" : stage.files);
      const { error: insertError } = await to.from(stage.table).upsert(rows, { onConflict: stage.onConflict });
      if (insertError) throw new Error(`${stage.name}: ${insertError.message}`);
    }
  }

  const next = rows.length < size ? { stage: at.stage + 1, offset: 0 } : { stage: at.stage, offset: at.offset + size };
  return { result: { done: next.stage >= STAGES.length, stage: stage.name, copied: rows.length }, next: next.stage >= STAGES.length ? null : next };
}

// Tables whose rows are copied by id; the rest go with their page.
const BY_ID = ["notifications", "leave_requests", "leave_balances", "leave_holidays", "leave_policies", "calendar_events", "task_rules", "task_templates", "object_collections", "service_objects", "comments", "comment_threads", "attachments", "page_access", "pages", "task_events", "task_comments", "task_files", "task_links", "tasks", "task_statuses", "task_boards", "task_fields", "task_projects"];

async function idsOf(client: SupabaseClient, table: string, ws: string) {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from(table).select("id").eq("workspace_id", ws).order("id").range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const row of data ?? []) ids.add(row.id as string);
    if (!data || data.length < 1000) return ids;
  }
}

async function prune(from: SupabaseClient, to: SupabaseClient, ws: string) {
  for (const table of BY_ID) {
    const there = await idsOf(to, table, ws);
    if (!there.size) continue;
    const kept = await idsOf(from, table, ws);
    // Never empty the other side because the source came back empty (a wrong or
    // reset project): that is stopped, not copied.
    if (table === "pages" && !kept.size) throw new Error("source_empty");
    const extra = [...there].filter((id) => !kept.has(id));
    // A page that is still there but now under another parent mustn't go with
    // its old one (deleting a page takes its subpages); the tree is copied again anyway.
    if (table === "pages") {
      for (let i = 0; i < extra.length; i += 100) {
        const { error } = await to.from("pages").update({ parent_id: null }).eq("workspace_id", ws).in("parent_id", extra.slice(i, i + 100));
        if (error) throw new Error(`pages: ${error.message}`);
      }
    }
    for (let i = 0; i < extra.length; i += 100) {
      const { error } = await to.from(table).delete().in("id", extra.slice(i, i + 100));
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }
}

// Files kept in Supabase Storage go to the other side's storage under the same
// path (files on Google Drive stay where they are).
async function copyFiles(from: SupabaseClient, to: SupabaseClient, rows: Record<string, unknown>[], bucket = "attachments") {
  for (const row of rows.filter((r) => r.storage_backend === "supabase")) {
    const path = row.storage_path as string;
    const { data: there } = await to.storage.from(bucket).exists(path);
    if (there) continue;
    const { data: file, error } = await from.storage.from(bucket).download(path);
    // A file that is already gone at the source (deleted, never uploaded) has nothing to copy.
    if (error || !file) continue;
    const { error: uploadError } = await to.storage
      .from(bucket)
      .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: row.mime_type as string, upsert: true });
    if (uploadError) throw new Error(`file ${path}: ${uploadError.message}`);
  }
}

export type VerifyReport = { ok: boolean; counts: Record<string, { central: number; team: number }>; mismatchedPages: string[]; missingFiles: string[] };

async function countOf(client: SupabaseClient, table: string, ws: string) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function allPages(client: SupabaseClient, ws: string) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("pages")
      .select("id, parent_id, title, icon, content, version, deleted_at, position, owner_id, cover")
      .eq("workspace_id", ws)
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error(`pages: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 500) return rows;
  }
}

// Both databases store page contents as jsonb, so equal contents print equally.
// Files must be on the side copied to.
export async function verifyMove(admin: SupabaseClient, team: SupabaseClient, ws: string, direction: Direction = "in"): Promise<VerifyReport> {
  const [from, to] = direction === "in" ? [admin, team] : [team, admin];
  const counts: VerifyReport["counts"] = {};
  for (const table of COUNTED) counts[table] = { central: await countOf(admin, table, ws), team: await countOf(team, table, ws) };
  const [central, copied] = await Promise.all([allPages(admin, ws), allPages(team, ws)]);
  const byId = new Map(copied.map((row) => [row.id as string, JSON.stringify(row)]));
  const mismatchedPages = central.filter((row) => byId.get(row.id as string) !== JSON.stringify(row)).map((row) => row.id as string);

  const missingFiles: string[] = [];
  const { data: files } = await from.from("attachments").select("storage_path").eq("workspace_id", ws).eq("storage_backend", "supabase");
  const { data: taskFiles } = await from.from("task_files").select("storage_path").eq("workspace_id", ws).eq("storage_backend", "supabase");
  const { data: objectFiles } = await from.from("object_files").select("storage_path").eq("workspace_id", ws).eq("storage_backend", "supabase");
  const checks = [
    ...(files ?? []).map((f) => ({ ...f, bucket: "attachments" })),
    ...[...(taskFiles ?? []), ...(objectFiles ?? [])].map((f) => ({ ...f, bucket: "task-files" })),
  ];
  for (const file of checks) {
    const { data: atSource } = await from.storage.from(file.bucket).exists(file.storage_path);
    if (!atSource) continue;
    const { data: there } = await to.storage.from(file.bucket).exists(file.storage_path);
    if (!there) missingFiles.push(file.storage_path);
  }

  const ok = Object.values(counts).every((c) => c.central === c.team) && !mismatchedPages.length && !missingFiles.length;
  return { ok, counts, mismatchedPages: mismatchedPages.slice(0, 20), missingFiles: missingFiles.slice(0, 20) };
}
