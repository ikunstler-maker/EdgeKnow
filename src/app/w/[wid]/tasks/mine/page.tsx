import type { Metadata } from "next";
import Link from "next/link";
import { dateLocale, t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { workspacePath } from "@/lib/paths";
import { SERVICE_BRANDS } from "@/lib/services";
import type { TaskPriority, TaskType } from "@/lib/tasks";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { Icon } from "@/components/ui/icon";
import { PriorityIcon, StatusDot, TypeIcon } from "@/components/tasks/task-icons";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.tasks.mine.title} · ${SERVICE_BRANDS.tasks.name}` };
}

type Row = {
  id: string;
  number: number;
  title: string;
  type: TaskType;
  priority: TaskPriority;
  due_date: string | null;
  assignee_id: string | null;
  status: { name: string; category: string; color?: string | null } | null;
  project: { key: string; name: string; archived_at: string | null } | null;
};
const GROUPS = ["overdue", "today", "week", "later", "none"] as const;

// The person's open tasks from every project they can see: overdue first, then today,
// the next seven days, later and those with no due date.
export default async function MyTasks({ params }: PageProps<"/w/[wid]/tasks/mine">) {
  const { wid } = await params;
  const [workspace, user] = await Promise.all([getWorkspace(wid), getCurrentUser()]);
  if (!workspace || !user) return null;
  const db = await dataClient(wid);
  const columns = "id, number, title, type, priority, due_date, assignee_id, status:task_statuses!tasks_status_id_fkey(*), project:task_projects(key, name, archived_at)";
  const { data: part } = await db.from("task_participants").select("task_id").eq("workspace_id", workspace.id).eq("user_id", user.id).limit(500);
  const partIds = ((part ?? []) as { task_id: string }[]).map((p) => p.task_id);
  const [{ data: own }, { data: joined }] = await Promise.all([
    db.from("tasks").select(columns).eq("workspace_id", workspace.id).eq("assignee_id", user.id).is("deleted_at", null).is("done_at", null).order("due_date", { nullsFirst: false }).limit(500),
    partIds.length ? db.from("tasks").select(columns).in("id", partIds).is("deleted_at", null).is("done_at", null).limit(500) : Promise.resolve({ data: [] }),
  ]);
  const seen = new Set<string>();
  const tasks = ([...(own ?? []), ...(joined ?? [])] as unknown as Row[]).filter((task) => {
    if (seen.has(task.id) || !task.project || task.project.archived_at || task.status?.category === "done") return false;
    seen.add(task.id);
    return true;
  });
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const week = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const groupOf = (task: Row) => (!task.due_date ? "none" : task.due_date < today ? "overdue" : task.due_date === today ? "today" : task.due_date <= week ? "week" : "later");
  const day = (value: string) => new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
  const m = t.tasks.mine;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 md:py-8">
      <Link href={workspacePath(wid, "/tasks")} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-foreground md:min-h-8">
        <Icon name="arrow-left" />
        {t.tasks.title}
      </Link>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">{m.title}</h1>
      {tasks.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted" data-my-tasks-none>
          {m.none}
        </p>
      ) : (
        GROUPS.map((group) => {
          const list = tasks.filter((task) => groupOf(task) === group).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
          if (!list.length) return null;
          return (
            <section key={group} className="mt-6" aria-label={m.groups[group]} data-my-tasks={group}>
              <h2 className={`text-sm font-medium ${group === "overdue" ? "text-danger" : "text-muted"}`}>
                {m.groups[group]} · {list.length}
              </h2>
              <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {list.map((task) => (
                  <li key={task.id}>
                    <Link href={workspacePath(wid, `/tasks/${task.project!.key}/${task.number}`)} className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm hover:bg-hover" data-my-task={`${task.project!.key}-${task.number}`}>
                      <TypeIcon type={task.type} />
                      <span className="shrink-0 font-mono text-xs text-muted">
                        {task.project!.key}-{task.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      {task.assignee_id !== user.id && <Icon name="users" className="shrink-0 text-muted" aria-label={m.also} />}
                      {task.status && (
                        <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted sm:flex">
                          <StatusDot category={task.status.category as never} color={task.status.color} />
                          {task.status.name}
                        </span>
                      )}
                      <PriorityIcon priority={task.priority} />
                      {task.due_date && <span className={`shrink-0 text-xs ${group === "overdue" ? "text-danger" : "text-muted"}`}>{day(task.due_date)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </main>
  );
}
