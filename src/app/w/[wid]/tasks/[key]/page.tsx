import type { Metadata } from "next";
import { withPaths } from "@/lib/groups";
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
import { Suspense } from "react";
import { Icon } from "@/components/ui/icon";
import { buttonClass } from "@/components/ui/button";
import { SERVICE_BRANDS } from "@/lib/services";
import { TaskPanel } from "@/components/tasks/task-panel";
import { TaskView } from "@/components/tasks/task-view";

export async function generateMetadata({ params, searchParams }: PageProps<"/w/[wid]/tasks/[key]">): Promise<Metadata> {
  const { key } = await params;
  const open = (await searchParams).task;
  const name = typeof open === "string" && /^\d{1,7}$/.test(open) ? `${key.toUpperCase()}-${open}` : key.toUpperCase();
  return { title: `${name} · ${SERVICE_BRANDS.tasks.name}` };
}

// One project: its tasks as a list with filters, and a quick way to add one.
export default async function ProjectPage({ params, searchParams }: PageProps<"/w/[wid]/tasks/[key]">) {
  const { wid, key } = await params;
  const query = await searchParams;
  const mode = query.view === "list" ? "list" : "board";
  const board = typeof query.board === "string" ? query.board : null;
  // A task opened over the board or the list (?task=N); its own page is /tasks/KEY/N.
  const openTask = typeof query.task === "string" && /^\d{1,7}$/.test(query.task) ? query.task : null;
  const [view, user] = await Promise.all([loadProject(wid, key), getCurrentUser()]);
  if (!view) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
        <p className="text-muted">{t.tasks.projectNotFound}</p>
      </main>
    );
  }
  const db = await dataClient(wid);
  // What the person may do on the board by the project's permissions (a database a step behind has no such function: the role decides).
  const { data: allowed } = await db.rpc("my_project_permissions", { target_project: view.project.id });
  const may = allowed && typeof allowed === "object" ? (allowed as { create?: boolean; transition?: boolean }) : null;
  // The project's tasks in one pass (project_tasks works the access out once). Where the
  // function isn't there yet — the site is a moment ahead of the database — the same rows
  // come from the table, each checked by its rule.
  // Read a thousand at a time (the database answers with at most that many rows at once),
  // so a project with thousands of tasks shows all of them.
  const everything = async <T,>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<{ rows: T[]; code?: string }> => {
    const rows: T[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await page(from, from + 999);
      if (error) return { rows, code: error.code };
      rows.push(...((data ?? []) as T[]));
      if (((data ?? []) as T[]).length < 1000) break;
    }
    return { rows };
  };
  const fast = await everything<TaskRow>((from, to) =>
    db.rpc("project_tasks", { target_project: view.project.id }).select(TASK_COLUMNS).is("deleted_at", null).order("number", { ascending: false }).range(from, to),
  );
  const tasks =
    fast.code === "PGRST202"
      ? (await everything<TaskRow>((from, to) => db.from("tasks").select(TASK_COLUMNS).eq("project_id", view.project.id).is("deleted_at", null).order("number", { ascending: false }).range(from, to))).rows
      : fast.rows;
  // Which tasks are blocked by an unfinished one (step Z3).
  const doneStatuses = new Set(view.statuses.filter((s) => s.category === "done").map((s) => s.id));
  const blocked = [...(await blockedIn(db, view.workspace.id, new Map((tasks ?? []).map((task) => [task.id, doneStatuses.has(task.status_id)]))))];

  // What the access dialog shows (only for those who manage the project).
  let access: ProjectAccess | null = null;
  if (view.role === "owner") {
    const [{ data: people }, { data: groupGrants }, { data: groups }] = await Promise.all([
      db.from("task_project_access").select("user_id, role").eq("project_id", view.project.id),
      db.from("task_project_group_access").select("group_id, role").eq("project_id", view.project.id),
      db.from("workspace_groups").select("id, name, parent_id").eq("workspace_id", view.workspace.id).order("name"),
    ]);
    access = {
      workspaceRole: view.project.workspace_role,
      people: (people ?? []) as ProjectAccess["people"],
      groupGrants: (groupGrants ?? []) as ProjectAccess["groupGrants"],
      groups: withPaths((groups ?? []) as { id: string; name: string; parent_id: string | null }[]),
    };
  }

  return (
    <main className={`mx-auto w-full flex-1 px-4 py-4 md:py-5 ${mode === "board" ? "max-w-none" : "max-w-7xl"}`} data-project-main>
      {/* One header row: the project and its views on the left, its tools on the right. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold tracking-tight">
          {view.project.icon ? <span>{view.project.icon}</span> : <Icon name="folder" size={20} className="text-muted" />}
          <span className="truncate">{view.project.name}</span>
          <span className="font-mono text-xs font-normal text-muted">{view.project.key}</span>
        </h1>
        <nav className="inline-flex rounded-lg border border-border bg-hover p-0.5" aria-label={t.tasks.views.label}>
          {(["board", "list"] as const).map((value) => (
            <Link
              key={value}
              href={`${workspacePath(view.workspace.shortId, `/tasks/${view.project.key}`)}${value === "list" ? "?view=list" : ""}`}
              aria-current={mode === value ? "page" : undefined}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium md:h-7 md:min-h-0 ${mode === value ? "bg-background text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
            >
              <Icon name={value === "board" ? "columns" : "list"} />
              {t.tasks.views[value]}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {access && (
            <Link href={workspacePath(view.workspace.shortId, `/tasks/${view.project.key}/fields`)} className={buttonClass("subtle")}>
              <Icon name="sliders" />
              {t.tasks.customFields.link}
            </Link>
          )}
          {canEdit(view.role) && <TemplatesButton projectId={view.project.id} isOwner={view.role === "owner"} />}
          {access && <ProjectAccessButton project={view.project} access={access} members={view.members} />}
        </div>
      </div>
      {!canEdit(view.role) && <p className="mt-2 text-sm text-muted">{t.tasks.readOnly}</p>}
      <PrivateOthers items={((await db.rpc("private_task_people", { target_project: view.project.id })).data ?? []) as { id: string; key: string; people: string[] | null }[]} members={view.members} />
      {mode === "board" ? (
        <TaskBoard
          key={board ?? "main"}
          initialBoard={board}
          shortId={view.workspace.shortId}
          project={view.project}
          statuses={view.statuses}
          boards={view.boards}
          groups={view.groups}
          placements={(await everything<TaskPlacement>((from, to) => db.from("task_placements").select("task_id, board_id, status_id, frozen_at, snapshot, updated_at").in("status_id", view.statuses.map((s) => s.id)).order("task_id").order("board_key").range(from, to))).rows}
          tasks={tasks ?? []}
          members={view.members}
          fields={view.fields}
          blocked={blocked}
          me={user.id}
          canEdit={canEdit(view.role)}
          canMove={may?.transition ?? canEdit(view.role)}
          canCreate={may?.create ?? canEdit(view.role)}
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
          isOwner={view.role === "owner"}
        />
      )}
      <TaskPanel number={openTask} pageBase={workspacePath(view.workspace.shortId, `/tasks/${view.project.key}`)}>
        {openTask && (
          <Suspense key={openTask} fallback={<p className="py-12 text-center text-sm text-muted">{t.tasks.card.loading}</p>}>
            <TaskView wid={wid} view={view} number={openTask} userId={user.id} inPanel />
          </Suspense>
        )}
      </TaskPanel>
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
    <details className="mt-3 rounded-xl border border-border bg-surface px-3 py-2 text-sm" data-private-others>
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
