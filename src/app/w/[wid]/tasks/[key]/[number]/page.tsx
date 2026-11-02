import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { canComment, canEdit, loadProject } from "@/lib/tasks-server";
import { TASK_COLUMNS, taskKey, type TaskRow } from "@/lib/tasks";
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
  const [{ data: comments }, { data: events }] = await Promise.all([
    db.from("task_comments").select("id, author_id, body, mentions, created_at, edited_at").eq("task_id", task.id).order("created_at"),
    db.from("task_events").select("id, actor_id, field, old_value, new_value, created_at").eq("task_id", task.id).order("created_at", { ascending: false }).limit(100),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <Link href={workspacePath(view.workspace.shortId, `/tasks/${view.project.key}`)} className="text-sm text-muted hover:text-foreground hover:underline">
        {t.tasks.backToProject(view.project.name)}
      </Link>
      <TaskDetail
        key={task.id}
        taskKey={taskKey(view.project.key, task.number)}
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
