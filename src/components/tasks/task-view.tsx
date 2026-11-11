import { t } from "@/i18n";
import { dataClient } from "@/lib/team-db/data";
import { canComment, canEdit, linkedTasks, type ProjectView } from "@/lib/tasks-server";
import { TASK_COLUMNS, columnTimes, taskKey, type StatusMove, type TaskLink, type TaskRow } from "@/lib/tasks";
import type { ProjectTask, TaskLinkView } from "./task-relations";
import type { TaskFileView } from "./task-files";
import { TaskDetail, type TaskComment, type TaskEvent, type TaskOrigin } from "./task-detail";
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
    />
  );
}
