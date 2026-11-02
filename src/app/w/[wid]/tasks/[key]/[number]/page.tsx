import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { canComment, canEdit, linkedTasks, loadProject } from "@/lib/tasks-server";
import { TASK_COLUMNS, taskKey, type TaskLink, type TaskRow } from "@/lib/tasks";
import type { ProjectTask, TaskLinkView } from "@/components/tasks/task-relations";
import type { TaskFileView } from "@/components/tasks/task-files";
import { getCurrentUser } from "@/lib/auth";
import { TaskDetail, type TaskComment, type TaskEvent } from "@/components/tasks/task-detail";

export async function generateMetadata({ params }: PageProps<"/w/[wid]/tasks/[key]/[number]">): Promise<Metadata> {
  const { key, number } = await params;
  return { title: `${key.toUpperCase()}-${number} · ${t.app.name}` };
}

export default async function TaskPage({ params }: PageProps<"/w/[wid]/tasks/[key]/[number]">) {
  const { wid, key, number } = await params;
  const [view, user] = await Promise.all([loadProject(wid, key), getCurrentUser()]);
  const notFound = (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <p className="text-muted">{t.tasks.notFound}</p>
    </main>
  );
  if (!view || !/^\d{1,7}$/.test(number)) return notFound;
  const db = await dataClient(wid);
  const { data: task } = await db
    .from("tasks")
    .select(`${TASK_COLUMNS}, description, deleted_at`)
    .eq("project_id", view.project.id)
    .eq("number", Number(number))
    .maybeSingle()
    .overrideTypes<TaskRow & { description: unknown; deleted_at: string | null }, { merge: false }>();
  if (!task) return notFound;
  const [{ data: comments }, { data: events }, { data: projectTasks }, { data: links }, { data: files }, { data: mentions }] = await Promise.all([
    db.from("task_comments").select("id, author_id, body, mentions, created_at, edited_at").eq("task_id", task.id).order("created_at"),
    db.from("task_events").select("id, actor_id, field, old_value, new_value, created_at").eq("task_id", task.id).order("created_at", { ascending: false }).limit(100),
    db.from("tasks").select("id, number, title, status_id, parent_id, type").eq("project_id", view.project.id).is("deleted_at", null).neq("id", task.id),
    db.from("task_links").select("id, source_id, target_id, kind").or(`source_id.eq.${task.id},target_id.eq.${task.id}`).order("created_at"),
    db.from("task_files").select("id, name, mime_type, bytes, uploaded_by, created_at").eq("task_id", task.id).neq("storage_backend", "pending").order("created_at"),
    // Pages with a chip of this task (only those the reader can open).
    db.from("task_page_links").select("page:pages(id, title, icon)").eq("task_id", task.id).overrideTypes<{ page: { id: string; title: string; icon: string | null } | null }[], { merge: false }>(),
  ]);
  // The other task of each link, as this reader may see it.
  const linkRows = (links ?? []) as TaskLink[];
  const others = await linkedTasks(db, [...new Set(linkRows.map((l) => (l.source_id === task.id ? l.target_id : l.source_id)))]);
  const linkViews: TaskLinkView[] = linkRows.map((l) => {
    const outgoing = l.source_id === task.id;
    return { id: l.id, kind: l.kind, outgoing, other: others.get(outgoing ? l.target_id : l.source_id)! };
  });

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <Link href={workspacePath(view.workspace.shortId, `/tasks/${view.project.key}`)} className="text-sm text-muted hover:text-foreground hover:underline">
        {t.tasks.backToProject(view.project.name)}
      </Link>
      <TaskDetail
        key={task.id}
        taskKey={taskKey(view.project.key, task.number)}
        shortId={view.workspace.shortId}
        project={{ id: view.project.id, key: view.project.key }}
        projectTasks={(projectTasks ?? []) as ProjectTask[]}
        links={linkViews}
        files={(files ?? []) as TaskFileView[]}
        mentionedOn={(mentions ?? []).flatMap((m) => (m.page ? [m.page] : []))}
        task={task}
        statuses={view.statuses}
        fields={view.fields}
        members={view.members}
        comments={(comments ?? []) as TaskComment[]}
        events={(events ?? []) as TaskEvent[]}
        me={user.id}
        canEdit={canEdit(view.role)}
        canComment={canComment(view.role)}
        isOwner={view.role === "owner"}
      />
    </main>
  );
}
