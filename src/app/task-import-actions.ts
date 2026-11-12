"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/lib/auth";
import { decrypt, encrypt } from "@/lib/drive/secret-box";
import { filesHome } from "@/lib/drive/task-files";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Person } from "@/lib/tasks";
import { dataClient, writeClient } from "@/lib/team-db/data";
import { TrackerError, trackerApi, type TrackerAccess } from "@/lib/tracker/api";
import type { ImportOutline, ImportPlan, ImportPreview, ImportProgress, ImportState } from "@/lib/tracker/types";
import { moveFilesStep, newFileWork, type FileWork } from "@/lib/tracker/files";
import { OUR_ROLES, matchPeople, parseTrackerLink, personRoles, suggestPriority, toActivityItem, toImportItem, toPersonItems, type OurRole, type ImportItem, type ImportMapping, type ImportRelation, type OurFieldKind, type TrackerIssue, type TrackerStatus } from "@/lib/tracker-convert";
import { getWorkspace, isWorkspaceAdmin } from "@/lib/workspace";

// Moving tasks in from another tracker (Rukh Р-3а). Only the workspace's owner and
// admins; the tracker's key is kept encrypted in a table only the server reads, and is
// never sent back to the browser. The tracker is only read, never changed.

const PAGE = 50;
const KEY = /^[A-Z][A-Z0-9]{1,9}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Row = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  site: string;
  source_project: string;
  account: string;
  secret_encrypted: string;
  mode: "new" | "merge";
  mapping: ImportMapping;
  state: ImportState["state"];
  progress: ImportProgress;
  last_error: string | null;
  created_at: string;
};
type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

async function gate(shortId: string) {
  const workspace = await getWorkspace(shortId);
  const admin = createAdminClient();
  if (!workspace || !isWorkspaceAdmin(workspace) || !admin) return null;
  return { workspace, admin, user: await getCurrentUser() };
}

async function rowOf(admin: SupabaseClient, workspaceId: string, importId: string): Promise<Row | null> {
  if (!UUID.test(importId)) return null;
  const { data } = await admin.from("task_imports").select("*").eq("id", importId).eq("workspace_id", workspaceId).maybeSingle();
  return (data as Row | null) ?? null;
}

const accessOf = (row: Row): TrackerAccess => ({ site: row.site, account: row.account, token: decrypt(row.secret_encrypted) });
const trackerFail = (error: unknown): Fail => fail(error instanceof TrackerError ? `tracker_${error.code}` : "unknown");

// Step 1: the address, the account and its key are checked against the tracker and kept.
export async function trackerConnect(shortId: string, link: string, projectKey: string, account: string, token: string): Promise<ActionResult<{ importId: string }>> {
  const ctx = await gate(shortId);
  if (!ctx) return fail("forbidden");
  const parsed = parseTrackerLink(link);
  const key = (projectKey.trim() || parsed?.project || "").toUpperCase();
  if (!parsed) return fail("bad_address");
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(key)) return fail("bad_project");
  if (!account.trim() || token.trim().length < 8 || token.length > 500) return fail("bad_account");
  const access = { site: parsed.site, account: account.trim(), token: token.trim() };
  let secret: string;
  try {
    secret = encrypt(access.token);
  } catch {
    return fail("not_configured");
  }
  try {
    await trackerApi().me(access);
    await trackerApi().project(access, key);
  } catch (error) {
    return trackerFail(error);
  }
  // One unfinished attempt per workspace: an older draft (and its key) is replaced.
  await ctx.admin.from("task_imports").delete().eq("workspace_id", ctx.workspace.id).eq("state", "draft");
  const { data, error } = await ctx.admin
    .from("task_imports")
    .insert({ workspace_id: ctx.workspace.id, source: "jira_cloud", site: access.site, source_project: key, account: access.account, secret_encrypted: secret, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error || !data) return fail("unknown");
  return { ok: true, importId: data.id as string };
}

async function ourSide(shortId: string, workspaceId: string) {
  const db = await dataClient(shortId);
  const [{ data: projects }, { data: columns }, { data: memberRows }] = await Promise.all([
    db.from("task_projects").select("id, key, name").eq("workspace_id", workspaceId).is("archived_at", null).order("name"),
    db.from("task_statuses").select("id, project_id, name, category, position, board_id").eq("workspace_id", workspaceId).is("board_id", null).order("position"),
    db
      .from("workspace_members")
      .select("user_id, role, profile:profiles!workspace_members_user_id_fkey(name, email)")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .overrideTypes<{ user_id: string; role: string; profile: { name: string | null; email: string } | null }[], { merge: false }>(),
  ]);
  const members: Person[] = (memberRows ?? [])
    .flatMap((m) => (m.profile ? [{ id: m.user_id, name: m.profile.name, email: m.profile.email, guest: m.role === "guest" }] : []))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  type Column = { id: string; project_id: string; name: string; category: string };
  return {
    members,
    projects: ((projects ?? []) as { id: string; key: string; name: string }[]).map((p) => ({
      ...p,
      columns: ((columns ?? []) as Column[]).filter((c) => c.project_id === p.id).map((c) => ({ id: c.id, name: c.name, category: c.category })),
    })),
  };
}

// Step 2–3: what the tracker has (statuses, types, people, fields) next to what we have.
export async function trackerOutline(shortId: string, importId: string): Promise<ActionResult<{ outline: ImportOutline }>> {
  const ctx = await gate(shortId);
  const row = ctx && (await rowOf(ctx.admin, ctx.workspace.id, importId));
  if (!ctx || !row) return fail("forbidden");
  try {
    const api = trackerApi();
    const access = accessOf(row);
    const [project, statuses, priorities, users, total, allFields, roles] = await Promise.all([
      api.project(access, row.source_project),
      api.statuses(access, row.source_project),
      api.priorities(access),
      api.users(access, row.source_project),
      api.count(access, row.source_project),
      api.fields(access),
      // Roles are a help, not a need: a key that may not read them still imports.
      api.roles(access, row.source_project).catch(() => []),
    ]);
    // Of the site's many custom fields, only those the first tasks actually fill.
    const sample = await api.issues(access, row.source_project, null, PAGE, allFields.map((f) => f.id));
    const filled = (id: string) => sample.issues.some((issue) => issue.raw[id] !== null && issue.raw[id] !== undefined && issue.raw[id] !== "");
    const ours = await ourSide(shortId, ctx.workspace.id);
    return {
      ok: true,
      outline: {
        importId: row.id,
        site: row.site,
        project: { key: project.key, name: project.name },
        total,
        statuses,
        types: project.types,
        priorities,
        users,
        roles: roles.filter((r) => r.users.length > 0),
        fields: allFields.filter((f) => filled(f.id)).slice(0, 30),
        ours: { ...ours, people: matchPeople(users, ours.members) },
      },
    };
  } catch (error) {
    return trackerFail(error);
  }
}

function checkedPlan(plan: ImportPlan, members: Person[]): ImportPlan | null {
  const memberIds = new Set(members.map((m) => m.id));
  const target = plan.target;
  if (target.kind === "merge" ? !UUID.test(target.projectId) : !KEY.test(target.key) || !target.name.trim() || target.name.length > 80) return null;
  if (target.kind === "rename" && (!UUID.test(target.projectId) || !KEY.test(target.otherKey) || target.otherKey === target.key)) return null;
  const people: Record<string, string | null> = {};
  for (const [id, member] of Object.entries(plan.people ?? {})) people[id] = member && memberIds.has(member) ? member : null;
  const roles: Record<string, OurRole | null> = {};
  for (const [name, role] of Object.entries(plan.roles ?? {}).slice(0, 30)) roles[name] = role && OUR_ROLES.includes(role) ? role : null;
  return { ...plan, people, roles, fields: [...new Set(plan.fields ?? [])].slice(0, 30) };
}

// Step 4: the first three tasks as they will look here (nothing is written yet).
export async function trackerPreview(shortId: string, importId: string, plan: ImportPlan): Promise<ActionResult<{ preview: ImportPreview }>> {
  const ctx = await gate(shortId);
  const row = ctx && (await rowOf(ctx.admin, ctx.workspace.id, importId));
  if (!ctx || !row) return fail("forbidden");
  const ours = await ourSide(shortId, ctx.workspace.id);
  const checked = checkedPlan(plan, ours.members);
  if (!checked) return fail("invalid");
  try {
    const api = trackerApi();
    const access = accessOf(row);
    const [statuses, fields, page] = await Promise.all([api.statuses(access, row.source_project), api.fields(access), api.issues(access, row.source_project, null, 3, checked.fields)]);
    const columns = ours.projects.flatMap((p) => p.columns);
    const statusName = (id: string) => columns.find((c) => c.id === checked.statuses[id])?.name ?? statuses.find((s) => s.id === id)?.name ?? "—";
    const personName = (id: string | null) => {
      const member = ours.members.find((m) => m.id === id);
      return member ? member.name || member.email : null;
    };
    // The preview needs no real ids yet: every status counts as mapped.
    const mapping: ImportMapping = {
      statuses: Object.fromEntries(statuses.map((s) => [s.id, s.id])),
      types: checked.types,
      priorities: checked.priorities,
      people: checked.people,
      fields: Object.fromEntries(checked.fields.flatMap((id) => (fields.find((f) => f.id === id) ? [[id, { id, kind: fields.find((f) => f.id === id)!.kind }]] : []))),
      startField: checked.startField,
    };
    const preview: ImportPreview = page.issues.flatMap((issue) => {
      const made = toImportItem(issue, mapping);
      if ("error" in made) return [];
      const { item } = made;
      return [
        {
          key: issue.key,
          title: item.title,
          status: statusName(issue.status),
          type: item.type,
          priority: item.priority,
          assignee: personName(item.assignee_id) ?? item.imported_assignee,
          reporter: personName(item.reporter_id) ?? item.imported_reporter,
          labels: item.labels,
          due: item.due_date,
          description: item.description,
        },
      ];
    });
    return { ok: true, preview };
  } catch (error) {
    return trackerFail(error);
  }
}

const newProgress = (total: number): ImportProgress => ({ phase: "tasks", cursor: null, total, seen: 0, created: 0, updated: 0, parents: 0, links: 0, missing: 0, skipped: [], notes: {} });

// The project the tasks go to, with a column for every status of the tracker and a field
// for every chosen custom field. Everything here is done as the person (their rights).
async function prepareProject(db: SupabaseClient, workspaceId: string, plan: ImportPlan, statuses: TrackerStatus[], fields: { id: string; name: string; kind: OurFieldKind }[]) {
  const target = plan.target;
  type Result<T> = { data: (T & { ok: boolean; error?: string }) | null };
  let projectId: string;
  if (target.kind === "merge") {
    projectId = target.projectId;
  } else {
    if (target.kind === "rename") {
      const { data } = (await db.rpc("set_task_project_key", { target_project: target.projectId, new_key: target.otherKey })) as Result<object>;
      if (!data?.ok) return fail(data?.error ?? "unknown");
    }
    // The new project starts with the tracker's first "to do", "in progress" and "done" names.
    const first = (category: string, fallback: string) => (statuses.find((s) => s.category === category)?.name ?? fallback).slice(0, 40);
    const names = [first("todo", t.tasks.defaultStatuses.todo), first("doing", t.tasks.defaultStatuses.doing), first("done", t.tasks.defaultStatuses.done)];
    const { data } = (await db.rpc("create_task_project", { ws: workspaceId, new_name: target.name.trim(), new_key: target.key, new_icon: null, status_names: names })) as Result<{ id: string }>;
    if (!data?.ok) return fail(data?.error ?? "unknown");
    projectId = data.id;
  }
  const { data: columnRows } = await db.from("task_statuses").select("id, name, category, position").eq("project_id", projectId).is("board_id", null).order("position");
  const columns = (columnRows ?? []) as { id: string; name: string; category: string; position: number }[];
  if (!columns.length) return fail("forbidden");
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const statusMap: Record<string, string> = {};
  for (const status of statuses) {
    const chosen = plan.statuses[status.id];
    const column = target.kind === "merge" && chosen && chosen !== "new" ? columns.find((c) => c.id === chosen) : columns.find((c) => same(c.name, status.name.slice(0, 40)));
    if (column) {
      statusMap[status.id] = column.id;
      continue;
    }
    const { data } = (await db.rpc("save_task_status", { target_project: projectId, target_status: null, new_name: status.name.slice(0, 40), new_category: status.category, new_wip_limit: null, new_position: null })) as Result<{ id: string }>;
    if (!data?.ok) return fail(data?.error ?? "unknown");
    columns.push({ id: data.id, name: status.name.slice(0, 40), category: status.category, position: columns.length + 1 });
    statusMap[status.id] = data.id;
  }
  if (target.kind !== "merge") {
    // A new project's columns stand in the tracker's order.
    const order = statuses.map((s) => statusMap[s.id]).filter((id, i, all) => all.indexOf(id) === i);
    for (const [index, id] of order.entries()) {
      const column = columns.find((c) => c.id === id)!;
      await db.rpc("save_task_status", { target_project: projectId, target_status: id, new_name: column.name, new_category: column.category, new_wip_limit: null, new_position: index + 1 });
    }
  }
  const { data: fieldRows } = await db.from("task_fields").select("id, name, kind").eq("project_id", projectId);
  const existing = (fieldRows ?? []) as { id: string; name: string; kind: string }[];
  const fieldMap: ImportMapping["fields"] = {};
  for (const field of fields) {
    const found = existing.find((f) => same(f.name, field.name) && f.kind === field.kind);
    if (found) {
      fieldMap[field.id] = { id: found.id, kind: field.kind, options: {} };
      continue;
    }
    const { data } = (await db.rpc("save_task_field", { target_project: projectId, field_id: null, definition: { name: field.name, kind: field.kind, options: [] } })) as Result<{ id: string }>;
    if (data?.ok) fieldMap[field.id] = { id: data.id, kind: field.kind, options: {} };
  }
  return { ok: true as const, projectId, statusMap, fieldMap };
}

// Step 5: the plan is applied (project, columns, fields) and the move starts.
export async function trackerStart(shortId: string, importId: string, plan: ImportPlan): Promise<ActionResult<{ projectKey: string }>> {
  const ctx = await gate(shortId);
  const row = ctx && (await rowOf(ctx.admin, ctx.workspace.id, importId));
  if (!ctx || !row) return fail("forbidden");
  if (row.state !== "draft") return fail("already_started");
  const db = await writeClient(shortId);
  if (!db) return fail("team_setup");
  const ours = await ourSide(shortId, ctx.workspace.id);
  const checked = checkedPlan(plan, ours.members);
  if (!checked) return fail("invalid");
  try {
    const api = trackerApi();
    const access = accessOf(row);
    const [statuses, allFields, total, last, users, roles] = await Promise.all([
      api.statuses(access, row.source_project),
      api.fields(access),
      api.count(access, row.source_project),
      api.lastNumber(access, row.source_project),
      api.users(access, row.source_project),
      api.roles(access, row.source_project).catch(() => []),
    ]);
    const prepared = await prepareProject(db, ctx.workspace.id, checked, statuses, allFields.filter((f) => checked.fields.includes(f.id)));
    if (!prepared.ok) return prepared;
    const home = await filesHome(ctx.admin, ctx.workspace.id);
    if (checked.target.kind === "merge") {
      // The project's own tasks step aside for the tracker's numbers.
      const { data } = await home.rows.rpc("make_room_for_import", { target_project: prepared.projectId, last_number: Math.max(1, last) });
      if (!(data as { ok?: boolean } | null)?.ok) return fail("unknown");
    }
    const mapping: ImportMapping = {
      statuses: prepared.statusMap,
      types: checked.types,
      priorities: Object.fromEntries(Object.entries(checked.priorities).map(([name, value]) => [name, value ?? suggestPriority(name)])),
      people: checked.people,
      fields: prepared.fieldMap,
      startField: checked.startField,
      since: null,
      runStarted: new Date().toISOString(),
    };
    // The tracker's people come first, as seats: by email or the wizard's choice a seat
    // is tied to a member at once, the rest wait for the project's owner.
    const held = personRoles(roles, Object.fromEntries(roles.map((r) => [r.name, checked.roles?.[r.name] ?? null])));
    mapping.personRoles = held.ours;
    mapping.trackerRoles = held.theirs;
    const progress = newProgress(total);
    for (let at = 0; at < users.length; at += 400) {
      const { data } = await home.rows.rpc("import_people", { target_project: prepared.projectId, items: toPersonItems(users.slice(at, at + 400), mapping) });
      const result = data as { ok?: boolean; people?: number; seated?: number } | null;
      if (!result?.ok) return fail("unknown");
      progress.people = (progress.people ?? 0) + (result.people ?? 0);
      progress.seated = (progress.seated ?? 0) + (result.seated ?? 0);
    }
    const { error } = await ctx.admin
      .from("task_imports")
      .update({ project_id: prepared.projectId, mode: checked.target.kind === "merge" ? "merge" : "new", mapping, state: "running", progress, last_error: null, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) return fail("unknown");
    revalidatePath("/", "layout");
    const { data: project } = await db.from("task_projects").select("key").eq("id", prepared.projectId).maybeSingle();
    return { ok: true, projectKey: (project?.key as string | undefined) ?? "" };
  } catch (error) {
    return trackerFail(error);
  }
}

// New values of "one of a list" fields get an option in our field as they turn up.
async function growOptions(db: SupabaseClient, projectId: string, mapping: ImportMapping, issues: TrackerIssue[]) {
  let changed = false;
  for (const [trackerId, field] of Object.entries(mapping.fields)) {
    if (field.kind !== "select" && field.kind !== "multiselect") continue;
    const labels = new Set<string>();
    for (const issue of issues) {
      const raw = issue.raw[trackerId];
      for (const value of Array.isArray(raw) ? raw : raw ? [raw] : []) {
        const label = String((value as { value?: unknown; name?: unknown })?.value ?? (value as { name?: unknown })?.name ?? "").trim().slice(0, 60);
        if (label && !field.options?.[label]) labels.add(label);
      }
    }
    if (!labels.size) continue;
    const { data: current } = await db.from("task_fields").select("name, options").eq("id", field.id).maybeSingle();
    const options = ((current?.options ?? []) as { id: string; label: string; color?: string | null }[]).slice();
    field.options ??= {};
    for (const label of labels) {
      const known = options.find((o) => o.label === label);
      if (!known && options.length >= 100) continue;
      const id = known?.id ?? `imp${Math.random().toString(36).slice(2, 10)}`;
      if (!known) options.push({ id, label, color: null });
      field.options[label] = id;
      changed = true;
    }
    await db.rpc("save_task_field", { target_project: projectId, field_id: field.id, definition: { name: current?.name ?? "—", options } });
  }
  return changed;
}

// One page of the move; the wizard calls it until the phase is "done". Safe to call
// again after a failure: tasks already here are updated, never doubled.
export async function trackerStep(shortId: string, importId: string): Promise<ActionResult<{ progress: ImportProgress; state: ImportState["state"] }>> {
  const ctx = await gate(shortId);
  const row = ctx && (await rowOf(ctx.admin, ctx.workspace.id, importId));
  if (!ctx || !row) return fail("forbidden");
  if (row.state !== "running" || !row.project_id) return { ok: true, progress: row.progress, state: row.state };
  const db = await writeClient(shortId);
  if (!db) return fail("team_setup");
  const progress = { ...row.progress };
  const save = async (changes: Record<string, unknown>) => void (await ctx.admin.from("task_imports").update({ progress, updated_at: new Date().toISOString(), ...changes }).eq("id", row.id));
  try {
    const api = trackerApi();
    const access = accessOf(row);
    const home = await filesHome(ctx.admin, ctx.workspace.id);
    if (progress.phase === "activity") {
      // Comments and the way through the columns, with the tracker's dates and people.
      const page = await api.activity(access, row.source_project, progress.cursor, PAGE, row.mapping.since);
      const made = page.items.map((activity) => toActivityItem(activity, row.mapping));
      for (const one of made) for (const note of new Set(one.problems)) progress.notes[note] = (progress.notes[note] ?? 0) + 1;
      const items = made.map((one) => one.item).filter((item) => item.comments.length || item.moves.length);
      if (items.length) {
        const authors = page.items.flatMap((a) => [...a.comments.map((c) => c.author), ...a.moves.map((m) => m.author)].flatMap((u) => (u ? [u] : [])));
        const people = toPersonItems(authors, row.mapping);
        if (people.length) await home.rows.rpc("import_people", { target_project: row.project_id, items: people });
        // Tasks with long histories go in small portions.
        for (let at = 0; at < items.length; at += 10) {
          const { data, error } = await home.rows.rpc("import_task_activity", { target_project: row.project_id, items: items.slice(at, at + 10) });
          const result = data as { ok?: boolean; error?: string; comments?: number; moves?: number } | null;
          if (error || !result?.ok) {
            await save({ last_error: result?.error ?? "unknown" });
            return fail(result?.error ?? "unknown");
          }
          progress.comments = (progress.comments ?? 0) + (result.comments ?? 0);
          progress.moves = (progress.moves ?? 0) + (result.moves ?? 0);
        }
      }
      progress.cursor = page.next;
      if (!page.next) {
        progress.phase = "files";
        row.mapping.fileWork = newFileWork();
        await save({ mapping: row.mapping });
        return { ok: true, progress, state: "running" };
      }
      await save({});
      return { ok: true, progress, state: "running" };
    }
    if (progress.phase === "files") {
      // The files go to the team's Google Drive, a large one over several steps.
      const work = (row.mapping.fileWork as FileWork | undefined) ?? newFileWork();
      let done = false;
      try {
        ({ done } = await moveFilesStep({ admin: ctx.admin, rows: home.rows, api, access, workspaceId: ctx.workspace.id, projectId: row.project_id, sourceProject: row.source_project, mapping: row.mapping, work, progress }));
      } finally {
        // Whatever happened, where the work stands is kept: nothing is sent twice.
        row.mapping.fileWork = work;
        await save({ mapping: row.mapping });
      }
      if (done) {
        progress.phase = "done";
        row.mapping.fileWork = undefined;
        await save({ state: "done", report: progress, finished_at: new Date().toISOString(), mapping: row.mapping, ...(row.mapping.runStarted ? { synced_at: row.mapping.runStarted } : {}) });
        revalidatePath("/", "layout");
        return { ok: true, progress, state: "done" };
      }
      return { ok: true, progress, state: "running" };
    }
    const page = await api.issues(access, row.source_project, progress.cursor, PAGE, progress.phase === "tasks" ? [...Object.keys(row.mapping.fields), ...(row.mapping.startField ? [row.mapping.startField] : [])] : [], row.mapping.since);
    if (progress.phase === "tasks") {
      const mappingGrew = await growOptions(db, row.project_id, row.mapping, page.issues);
      const items: ImportItem[] = [];
      for (const issue of page.issues) {
        const made = toImportItem(issue, row.mapping);
        if ("error" in made) {
          if (progress.skipped.length < 200) progress.skipped.push({ key: issue.key, reason: made.error });
          continue;
        }
        items.push(made.item);
        for (const note of new Set(made.problems)) progress.notes[note] = (progress.notes[note] ?? 0) + 1;
      }
      if (items.length) {
        // People of these tasks the project's list didn't have (left the tracker, for one).
        const people = toPersonItems(page.issues.flatMap((issue) => [issue.assignee, issue.reporter].flatMap((u) => (u ? [u] : []))), row.mapping);
        if (people.length) await home.rows.rpc("import_people", { target_project: row.project_id, items: people });
        const { data, error } = await home.rows.rpc("import_tasks", { target_project: row.project_id, items });
        const result = data as { ok?: boolean; error?: string; created?: number; updated?: number; number?: number } | null;
        if (error || !result?.ok) {
          await save({ state: "failed", last_error: result?.error === "number_taken" ? `number_taken:${result.number}` : (result?.error ?? "unknown") });
          return fail(result?.error ?? "unknown");
        }
        progress.created += result.created ?? 0;
        progress.updated += result.updated ?? 0;
      }
      progress.seen += page.issues.length;
      progress.cursor = page.next;
      if (!page.next) progress.phase = "relations";
      await save(mappingGrew ? { mapping: row.mapping } : {});
    } else if (progress.phase === "relations") {
      const relations: ImportRelation[] = page.issues.flatMap((issue) => {
        const made = toImportItem(issue, row.mapping);
        return "error" in made || (!made.relation.parent_key && !made.relation.links.length) ? [] : [made.relation];
      });
      if (relations.length) {
        const { data } = await home.rows.rpc("import_task_relations", { target_project: row.project_id, items: relations });
        const result = data as { ok?: boolean; parents?: number; links?: number; missing?: number } | null;
        if (result?.ok) {
          progress.parents += result.parents ?? 0;
          progress.links += result.links ?? 0;
          progress.missing += result.missing ?? 0;
        }
      }
      progress.cursor = page.next;
      if (!page.next) progress.phase = "activity";
      await save({});
    }
    return { ok: true, progress, state: "running" };
  } catch (error) {
    const failure = trackerFail(error);
    await save({ last_error: failure.error });
    return failure;
  }
}

// «Оновити з трекера»: one way, the tracker → us. Only what changed there since the last
// run is read again: new tasks come in, changed ones are changed (with the tracker's
// values), their comments, history and files follow. Nothing is doubled.
export async function trackerRefresh(shortId: string, importId: string): Promise<ActionResult> {
  const ctx = await gate(shortId);
  const row = ctx && (await rowOf(ctx.admin, ctx.workspace.id, importId));
  if (!ctx || !row) return fail("forbidden");
  if (row.state !== "done" || !row.project_id) return fail("already_started");
  try {
    const since = (row as Row & { synced_at?: string | null }).synced_at ?? row.created_at;
    const total = await trackerApi().count(accessOf(row), row.source_project, since);
    const { error } = await ctx.admin
      .from("task_imports")
      .update({ state: "running", progress: newProgress(total), mapping: { ...row.mapping, since, runStarted: new Date().toISOString(), fileWork: undefined }, last_error: null, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return error ? fail("unknown") : { ok: true };
  } catch (error) {
    return trackerFail(error);
  }
}

// Where a task with this old key (or a link to it in the tracker) is now: the address of
// our task, or null. Read with the person's own rights.
export async function findTaskByOldKey(shortId: string, input: string): Promise<{ projectKey: string; number: number } | null> {
  const key = /([A-Za-z][A-Za-z0-9_]{1,19}-\d{1,7})(?![A-Za-z0-9-])/.exec(input.trim().slice(0, 600))?.[1];
  const workspace = key ? await getWorkspace(shortId) : null;
  if (!key || !workspace) return null;
  const db = await dataClient(shortId);
  const { data } = await db.rpc("find_task_by_key", { ws: workspace.id, wanted: key });
  const found = data as { project_key?: string; number?: number } | null;
  return found?.project_key && found.number ? { projectKey: found.project_key, number: found.number } : null;
}

// «Дотягнути»: the files that could not come are tried again (those already on the Drive
// are left alone). The import's connection must still be there.
export async function trackerRetryFiles(shortId: string, importId: string): Promise<ActionResult> {
  const ctx = await gate(shortId);
  const row = ctx && (await rowOf(ctx.admin, ctx.workspace.id, importId));
  if (!ctx || !row) return fail("forbidden");
  if (row.state !== "done" || !row.project_id) return fail("already_started");
  const progress: ImportProgress = { ...row.progress, phase: "files", cursor: null, filesMissed: 0, filesKept: 0 };
  const { error } = await ctx.admin
    .from("task_imports")
    .update({ state: "running", progress, mapping: { ...row.mapping, fileWork: newFileWork() }, last_error: null, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  return error ? fail("unknown") : { ok: true };
}

// What an import could not bring into this project (its owners and workspace admins see it).
export type ImportGap = { id: string; task: string; name: string; bytes: number | null; reason: string };
export async function trackerGaps(shortId: string, projectKey: string): Promise<ImportGap[]> {
  const ctx = await gate(shortId);
  if (!ctx || !KEY.test(projectKey)) return [];
  const db = await dataClient(shortId);
  const { data: project } = await db.from("task_projects").select("id").eq("workspace_id", ctx.workspace.id).eq("key", projectKey).maybeSingle();
  if (!project) return [];
  const { data } = await db
    .from("task_import_gaps")
    .select("id, name, bytes, reason, task:tasks(number)")
    .eq("project_id", project.id)
    .is("resolved_at", null)
    .order("created_at")
    .limit(500)
    .overrideTypes<{ id: string; name: string; bytes: number | null; reason: string; task: { number: number } | null }[], { merge: false }>();
  return (data ?? []).map((g) => ({ id: g.id, task: g.task ? `${projectKey}-${g.task.number}` : projectKey, name: g.name, bytes: g.bytes, reason: g.reason }));
}

// The latest import of the workspace, for coming back to the wizard (no key in it).
export async function trackerState(shortId: string): Promise<ImportState | null> {
  const ctx = await gate(shortId);
  if (!ctx) return null;
  const { data } = await ctx.admin
    .from("task_imports")
    .select("id, state, site, source_project, project_id, progress, last_error, created_at")
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as Pick<Row, "id" | "state" | "site" | "source_project" | "project_id" | "progress" | "last_error" | "created_at">;
  const { data: project } = row.project_id ? await (await dataClient(shortId)).from("task_projects").select("key").eq("id", row.project_id).maybeSingle() : { data: null };
  return {
    id: row.id,
    state: row.state,
    site: row.site,
    sourceProject: row.source_project,
    projectKey: (project?.key as string | undefined) ?? null,
    progress: row.state === "draft" ? null : row.progress,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

// Forgets an import with the tracker's key (the tasks already moved stay).
export async function trackerForget(shortId: string, importId: string): Promise<ActionResult> {
  const ctx = await gate(shortId);
  if (!ctx || !UUID.test(importId)) return fail("forbidden");
  const { error } = await ctx.admin.from("task_imports").delete().eq("id", importId).eq("workspace_id", ctx.workspace.id);
  return error ? fail("unknown") : { ok: true };
}

// A project's key changes (to free it, or just to rename): the database checks the rights.
export async function setTaskProjectKey(projectId: string, key: string): Promise<ActionResult<{ key: string }>> {
  const db = await writeClient();
  if (!db) return fail("team_setup");
  const { data, error } = await db.rpc("set_task_project_key", { target_project: projectId, new_key: key });
  if (error || !data) return fail("unknown");
  revalidatePath("/", "layout");
  return data as ActionResult<{ key: string }>;
}
