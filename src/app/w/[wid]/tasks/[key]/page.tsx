import type { Metadata } from "next";
import Link from "next/link";
import { workspacePath } from "@/lib/paths";
import { t } from "@/i18n";
import { dataClient } from "@/lib/team-db/data";
import { blockedIn, canEdit, loadProject } from "@/lib/tasks-server";
import { TASK_COLUMNS, personLabel, type Person, type TaskPlacement, type TaskRow } from "@/lib/tasks";
import { getCurrentUser } from "@/lib/auth";
import { TaskList } from "@/components/tasks/task-list";
import { TemplatesButton } from "@/components/tasks/task-templates";
import { TaskBoard } from "@/components/tasks/task-board";
import { ProjectAccessButton, type ProjectAccess } from "@/components/tasks/project-access";

export async function generateMetadata({ params }: PageProps<"/w/[wid]/tasks/[key]">): Promise<Metadata> {
  const { key } = await params;
  return { title: `${key.toUpperCase()} · ${t.app.name}` };
}

// One project: its tasks as a list with filters, and a quick way to add one.
export default async function ProjectPage({ params, searchParams }: PageProps<"/w/[wid]/tasks/[key]">) {
  const { wid, key } = await params;
  const mode = (await searchParams).view === "list" ? "list" : "board";
  const [view, user] = await Promise.all([loadProject(wid, key), getCurrentUser()]);
  if (!view) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
        <p className="text-muted">{t.tasks.projectNotFound}</p>
      </main>
    );
  }
  const db = await dataClient(wid);
  const { data: tasks } = await db
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("project_id", view.project.id)
    .is("deleted_at", null)
    .order("number", { ascending: false })
    .overrideTypes<TaskRow[], { merge: false }>();
  // Which tasks are blocked by an unfinished one (step Z3).
  const doneStatuses = new Set(view.statuses.filter((s) => s.category === "done").map((s) => s.id));
  const blocked = [...(await blockedIn(db, view.workspace.id, new Map((tasks ?? []).map((task) => [task.id, doneStatuses.has(task.status_id)]))))];

  // What the access dialog shows (only for those who manage the project).
  let access: ProjectAccess | null = null;
  if (view.role === "owner") {
    const [{ data: people }, { data: groupGrants }, { data: groups }] = await Promise.all([
      db.from("task_project_access").select("user_id, role").eq("project_id", view.project.id),
      db.from("task_project_group_access").select("group_id, role").eq("project_id", view.project.id),
      db.from("workspace_groups").select("id, name").eq("workspace_id", view.workspace.id).order("name"),
    ]);
    access = {
      workspaceRole: view.project.workspace_role,
      people: (people ?? []) as ProjectAccess["people"],
      groupGrants: (groupGrants ?? []) as ProjectAccess["groupGrants"],
      groups: (groups ?? []) as ProjectAccess["groups"],
    };
  }

  return (
    <main className={`mx-auto w-full flex-1 px-4 py-8 ${mode === "board" ? "max-w-none" : "max-w-7xl"}`} data-project-main>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold">
          {view.project.icon ?? "📋"} {view.project.name} <span className="font-mono text-base text-muted">{view.project.key}</span>
        </h1>
        {access && (
          <Link
            href={workspacePath(view.workspace.shortId, `/tasks/${view.project.key}/fields`)}
            className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9"
          >
            {t.tasks.customFields.link}
          </Link>
        )}
        {canEdit(view.role) && <TemplatesButton projectId={view.project.id} isOwner={view.role === "owner"} />}
        {access && <ProjectAccessButton project={view.project} access={access} members={view.members} />}
      </div>
      {!canEdit(view.role) && <p className="mt-2 text-sm text-muted">{t.tasks.readOnly}</p>}
      <nav className="mt-4 flex gap-1 border-b border-border" aria-label={t.tasks.views.label}>
        {(["board", "list"] as const).map((value) => (
          <Link
            key={value}
            href={`${workspacePath(view.workspace.shortId, `/tasks/${view.project.key}`)}${value === "list" ? "?view=list" : ""}`}
            aria-current={mode === value ? "page" : undefined}
            className={`min-h-11 border-b-2 px-3 py-2 text-sm ${mode === value ? "border-accent font-medium" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {t.tasks.views[value]}
          </Link>
        ))}
      </nav>
      <PrivateOthers items={((await db.rpc("private_task_people", { target_project: view.project.id })).data ?? []) as { id: string; key: string; people: string[] | null }[]} members={view.members} />
      {mode === "board" ? (
        <TaskBoard
          shortId={view.workspace.shortId}
          project={view.project}
          statuses={view.statuses}
          boards={view.boards}
          groups={view.groups}
          placements={((await db.from("task_placements").select("task_id, board_id, status_id, frozen_at, snapshot").in("status_id", view.statuses.map((s) => s.id))).data ?? []) as TaskPlacement[]}
          tasks={tasks ?? []}
          members={view.members}
          fields={view.fields}
          blocked={blocked}
          me={user.id}
          canEdit={canEdit(view.role)}
          isOwner={view.role === "owner"}
        />
      ) : (
        <TaskList
          shortId={view.workspace.shortId}
          project={view.project}
          statuses={view.statuses}
          tasks={tasks ?? []}
          members={view.members}
          fields={view.fields}
          blocked={blocked}
          me={user.id}
          canEdit={canEdit(view.role)}
        />
      )}
    </main>
  );
}

// For the workspace's owner and admins: others' private tasks, only their key and people.
function PrivateOthers({ items, members }: { items: { id: string; key: string; people: string[] | null }[]; members: Person[] }) {
  if (!items.length) return null;
  const name = (id: string) => {
    const m = members.find((p) => p.id === id);
    return m ? personLabel(m) : "—";
  };
  return (
    <details className="mt-3 rounded-lg border border-border px-3 py-2 text-sm" data-private-others>
      <summary className="min-h-9 cursor-pointer py-1 text-muted">{t.tasks.privacy.othersPrivate(items.length)}</summary>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <span className="font-mono">{item.key}</span> · {(item.people ?? []).map(name).join(", ")}
          </li>
        ))}
      </ul>
    </details>
  );
}
