import { t } from "@/i18n";
import { dataClient } from "@/lib/team-db/data";
import { canComment, canEdit, linkedTasks, type ProjectView } from "@/lib/tasks-server";
import { TASK_COLUMNS, columnTimes, taskKey, type StatusMove, type TaskLink, type TaskRow } from "@/lib/tasks";
import type { ProjectTask, TaskLinkView } from "./task-relations";
import type { TaskFileView, TaskWebLink } from "./task-files";
import type { TaskWishlistLink } from "./task-wishlists";
import { TaskDetail, type TaskComment, type TaskPermissions, type TaskEvent, type TaskOrigin } from "./task-detail";
import type { TimeEntry } from "./time-log";
import type { TaskRecurrence } from "./recurrence";
import { TaskSnapshot, type TaskSnapshotData } from "./task-snapshot";

const EVENT_COLUMNS = "id, actor_id, field, old_value, new_value, created_at";

// One task with everything its card shows, read with the reader's own access. The same
// on the task's page and in the panel over the board (`inPanel`).
export async function TaskView({ wid, view, number, userId, inPanel = false }: { wid: string; view: ProjectView; number: string; userId: string; inPanel?: boolean }) {
  const notFound = <p className="py-12 text-center text-muted" data-task-missing>{t.tasks.notFound}</p>;
  if (!/^\d{1,7}$/.test(number)) return notFound;
  const db = await dataClient(wid);
  const { data: task } = await db
    .from("tasks")
    .select(`${TASK_COLUMNS}, description, deleted_at`)
    .eq("project_id", view.project.id)
    .eq("number", Number(number))
    .maybeSingle()
    .overrideTypes<TaskRow & { description: unknown; deleted_at: string | null }, { merge: false }>();
  if (!task) {
    // Someone whose board froze the task sees it as it was then (read only).
    const { data: frozen } = await db
      .from("task_placements")
      .select("task_id, frozen_at, snapshot")
      .in("status_id", view.statuses.map((x) => x.id))
      .not("snapshot", "is", null)
      .eq("snapshot->>number", number)
      .order("frozen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!frozen?.snapshot || !frozen.frozen_at) return notFound;
    const [{ data: comments }, { data: events }, { data: files }] = await Promise.all([
      db.from("task_comments").select("id, author_id, body, mentions, created_at, edited_at").eq("task_id", frozen.task_id).order("created_at"),
      db.from("task_events").select(EVENT_COLUMNS).eq("task_id", frozen.task_id).order("created_at", { ascending: false }).limit(100),
      db.from("task_files").select("id, name, created_at").eq("task_id", frozen.task_id).neq("storage_backend", "pending").order("created_at"),
    ]);
    return (
      <TaskSnapshot
        shortId={view.workspace.shortId}
        taskKey={taskKey(view.project.key, Number(number))}
        snapshot={{ ...(frozen.snapshot as TaskSnapshotData), id: frozen.task_id }}
        frozenAt={frozen.frozen_at}
        fields={view.fields}
        members={view.members}
        comments={(comments ?? []) as TaskComment[]}
        events={(events ?? []) as TaskEvent[]}
        files={(files ?? []) as { id: string; name: string; created_at: string }[]}
      />
    );
  }
  const [{ data: comments }, { data: events }, { data: edits }, { data: projectTasks }, { data: links }, { data: files }, { data: mentions }, { data: moves }, { data: participants }] = await Promise.all([
    db.from("task_comments").select("id, author_id, body, mentions, created_at, edited_at").eq("task_id", task.id).order("created_at"),
    // Autosaves of the description are many: they are read apart, so they can't push the
    // changes of status, people and dates out of the latest hundred.
    db.from("task_events").select(EVENT_COLUMNS).eq("task_id", task.id).neq("field", "description").order("created_at", { ascending: false }).limit(100),
    db.from("task_events").select(EVENT_COLUMNS).eq("task_id", task.id).eq("field", "description").order("created_at", { ascending: false }).limit(200),
    db.from("tasks").select("id, number, title, status_id, parent_id, type, labels").eq("project_id", view.project.id).is("deleted_at", null).neq("id", task.id),
    db.from("task_links").select("id, source_id, target_id, kind").or(`source_id.eq.${task.id},target_id.eq.${task.id}`).order("created_at"),
    db.from("task_files").select("id, name, mime_type, bytes, uploaded_by, created_at").eq("task_id", task.id).neq("storage_backend", "pending").order("created_at"),
    // Pages with a chip of this task (only those the reader can open).
    db.from("task_page_links").select("page:pages(id, title, icon)").eq("task_id", task.id).overrideTypes<{ page: { id: string; title: string; icon: string | null } | null }[], { merge: false }>(),
    // Every column change (not only the latest 100 events): time spent in each column.
    db.from("task_events").select("old_value, new_value, created_at").eq("task_id", task.id).eq("field", "status_id").order("created_at"),
    db.from("task_participants").select("user_id, role").eq("task_id", task.id),
  ]);
  // Where an imported task came from. Read apart: a database a step behind the site
  // doesn't have these columns yet, and the card must still open.
  const { data: origin } = await db.from("tasks").select("external_key, external_url, imported_reporter, imported_assignee").eq("id", task.id).maybeSingle();
  // Comments and history lines that came from the tracker and whose person isn't tied to a
  // member yet show the tracker's name. Read apart for the same reason.
  const [{ data: slotComments }, { data: slotEvents }] = await Promise.all([
    db.from("task_comments").select("id, author_slot").eq("task_id", task.id).is("author_id", null).not("author_slot", "is", null),
    db.from("task_events").select("id, actor_slot").eq("task_id", task.id).is("actor_id", null).not("actor_slot", "is", null),
  ]);
  const slotOf = new Map<string, string>([
    ...((slotComments ?? []) as { id: string; author_slot: string }[]).map((c) => [c.id, c.author_slot] as const),
    ...((slotEvents ?? []) as { id: string; actor_slot: string }[]).map((e) => [e.id, e.actor_slot] as const),
  ]);
  const importedNames: Record<string, string> = {};
  if (slotOf.size) {
    const { data: seats } = await db.from("task_import_people").select("id, name").in("id", [...new Set(slotOf.values())]);
    const nameOf = new Map(((seats ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
    for (const [id, slot] of slotOf) if (nameOf.has(slot)) importedNames[id] = nameOf.get(slot)!;
  }
  // Links kept with the task (read apart: a database a step behind has no such table yet).
  const { data: webLinks } = await db.from("task_web_links").select("id, title, url, added_by").eq("task_id", task.id).order("created_at");
  const { data: wishlistLinks } = await db.from("task_wishlist_links").select("id, wishlist_id, added_by").eq("task_id", task.id).order("created_at");
  // Time entries, where the project tracks time (the database shows only those this reader may see).
  let time: TimeEntry[] | null = null;
  if (view.project.time_tracking) {
    const { data: rows } = await db.from("task_time_entries").select("id, user_id, minutes, spent_on, note, author_slot").eq("task_id", task.id).order("spent_on", { ascending: false }).order("created_at", { ascending: false });
    const list = (rows ?? []) as (TimeEntry & { author_slot: string | null })[];
    time = list.map((e) => ({ id: e.id, user_id: e.user_id, minutes: e.minutes, spent_on: e.spent_on, note: e.note }));
    const slots = list.filter((e) => !e.user_id && e.author_slot);
    if (slots.length) {
      const { data: seats } = await db.from("task_import_people").select("id, name").in("id", [...new Set(slots.map((e) => e.author_slot!))]);
      const nameOf = new Map(((seats ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
      for (const e of slots) if (nameOf.has(e.author_slot!)) importedNames[e.id] = nameOf.get(e.author_slot!)!;
    }
  }
  // How the task repeats (read apart: a database a step behind has no such table yet).
  const { data: recurrence } = await db.from("task_recurrences").select("every_n, unit, weekdays, next_on, until").eq("task_id", task.id).maybeSingle();
  // What this reader may do with the task by the project's permissions (a database a step
  // behind has no such function: then the role decides, as before).
  const { data: allowed } = await db.rpc("my_task_permissions", { target_task: task.id });
  const spent = columnTimes(task, (moves ?? []) as StatusMove[], view.statuses, view.project.time_last_column === true);
  // The other task of each link, as this reader may see it.
  const linkRows = (links ?? []) as TaskLink[];
  const others = await linkedTasks(db, [...new Set(linkRows.map((l) => (l.source_id === task.id ? l.target_id : l.source_id)))]);
  const linkViews: TaskLinkView[] = linkRows.map((l) => {
    const outgoing = l.source_id === task.id;
    return { id: l.id, kind: l.kind, outgoing, other: others.get(outgoing ? l.target_id : l.source_id)! };
  });
  const siblings = (projectTasks ?? []) as (ProjectTask & { labels: string[] | null })[];
  const allEvents = [...((events ?? []) as TaskEvent[]), ...((edits ?? []) as TaskEvent[])].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <TaskDetail
      key={task.id}
      taskKey={taskKey(view.project.key, task.number)}
      shortId={view.workspace.shortId}
      project={{ id: view.project.id, key: view.project.key }}
      projectTasks={siblings.map((x) => ({ id: x.id, number: x.number, title: x.title, status_id: x.status_id, parent_id: x.parent_id, type: x.type }))}
      projectLabels={[...new Set(siblings.flatMap((x) => x.labels ?? []))].sort((a, b) => a.localeCompare(b))}
      links={linkViews}
      files={(files ?? []) as TaskFileView[]}
      mentionedOn={(mentions ?? []).flatMap((m) => (m.page ? [m.page] : []))}
      task={task}
      statuses={view.statuses}
      boards={view.boards}
      fields={view.fields}
      members={view.members}
      comments={(comments ?? []) as TaskComment[]}
      events={allEvents}
      participants={(participants ?? []) as { user_id: string; role: "co_assignee" | "responsible" }[]}
      columnTime={view.statuses.flatMap((s) => (spent.has(s.id) ? [{ id: s.id, name: s.name, ms: spent.get(s.id)! }] : []))}
      me={userId}
      canEdit={canEdit(view.role)}
      canComment={canComment(view.role)}
      isOwner={view.role === "owner"}
      moves={view.moves}
      inPanel={inPanel}
      origin={(origin as TaskOrigin | null) ?? null}
      importedNames={importedNames}
      webLinks={(webLinks ?? []) as TaskWebLink[]}
      wishlistLinks={(wishlistLinks ?? []) as TaskWishlistLink[]}
      time={time}
      permissions={allowed && typeof allowed === "object" ? (allowed as TaskPermissions) : undefined}
      recurrence={(recurrence as TaskRecurrence | null) ?? null}
      fileLimits={{ fileMb: view.project.file_limit_mb ?? 4, zipMb: view.project.zip_limit_mb ?? 4 }}
    />
  );
}
