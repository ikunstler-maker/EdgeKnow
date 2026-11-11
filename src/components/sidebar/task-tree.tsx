"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import type { BoardSummary, ProjectSummary, SidebarBoard } from "@/lib/tasks";
import { sidebarProjectTasks } from "@/app/task-actions";
import { usePages } from "@/components/pages/pages-provider";
import { Icon } from "@/components/ui/icon";
import { PriorityIcon, StatusDot } from "@/components/tasks/task-icons";
import { openingTask } from "@/components/tasks/task-panel";

const s = t.sidebar;
const rowClass = (here: boolean) => `flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-sm hover:bg-hover md:min-h-8 ${here ? "bg-hover font-medium" : ""}`;
const toggleClass = "flex h-11 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-foreground md:h-8 md:w-5";

function Toggle({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-label={label} title={label} className={toggleClass}>
      <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
    </button>
  );
}

// Tasks as a tree: projects → their boards → the tasks on each board. Every level folds.
// A task shows the colour of its column on the left and its priority on the right, and
// opens over its board. The open project is unfolded by itself; its lists follow every
// change made on the site.
export function TaskProjects({ projects, boards, pathname, onNavigate }: { projects: ProjectSummary[]; boards: BoardSummary[]; pathname: string; onNavigate?: () => void }) {
  const { workspace } = usePages();
  const params = useSearchParams();
  const base = workspacePath(workspace.shortId, "/tasks");
  const openKey = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split("/")[0] : null;
  const openProject = projects.find((p) => p.key === openKey) ?? null;
  const boardParam = params.get("board");
  const openNumber = params.get("task") ?? (openKey ? (pathname.slice(base.length + 1).split("/")[1] ?? null) : null);
  // What the person folded or unfolded by hand; otherwise the open project is unfolded
  // and so are its boards.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [lists, setLists] = useState<Record<string, SidebarBoard[]>>({});
  const unfolded = (id: string, byDefault: boolean) => toggled[id] ?? byDefault;
  const flip = (id: string, byDefault: boolean) => setToggled((before) => ({ ...before, [id]: !(before[id] ?? byDefault) }));
  const wanted = projects.filter((p) => unfolded(p.id, p.id === openProject?.id)).map((p) => p.id).join(",");

  // Unfolded projects are read again whenever the site's data refreshes (`projects`
  // arrives anew with every change), so the tree keeps up with the board.
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    const timer = setTimeout(() => {
      for (const id of wanted.split(",")) {
        void sidebarProjectTasks(id)
          .then((list) => live && setLists((before) => ({ ...before, [id]: list })))
          .catch(() => {});
      }
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [wanted, projects]);

  return (
    <section aria-label={t.tasks.section} className="mb-2" data-sidebar-section="tasks">
      <Link prefetch={false} href={base} onClick={onNavigate} data-angler-here={pathname === base ? "" : undefined} className="block px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted hover:text-foreground">
        {t.tasks.section}
      </Link>
      <ul role="tree" aria-label={t.tasks.section}>
        {projects.map((project) => {
          const href = `${base}/${project.key}`;
          const here = project.id === openProject?.id;
          const open = unfolded(project.id, here);
          const loaded = lists[project.id];
          const own = [{ id: null as string | null, name: s.mainBoard }, ...boards.filter((b) => b.project_id === project.id)];
          return (
            <li key={project.id} role="treeitem" aria-expanded={open} aria-selected={here} data-sidebar-project={project.key}>
              <div className="flex items-center">
                <Toggle open={open} label={open ? s.fold(project.name) : s.unfold(project.name)} onClick={() => flip(project.id, here)} />
                <Link prefetch={false} href={href} onClick={onNavigate} data-angler-here={pathname === href ? "" : undefined} className={rowClass(here && !open)}>
                  {project.icon ? <span className="shrink-0">{project.icon}</span> : <Icon name="folder" className="shrink-0 text-muted" />}
                  <span className="truncate">{project.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted">{project.key}</span>
                </Link>
              </div>
              {open && (
                <ul role="group" className="ml-3 border-l border-border pl-1">
                  {own.map((board) => {
                    const id = `${project.id}:${board.id ?? "main"}`;
                    const boardHref = board.id ? `${href}?board=${board.id}` : href;
                    const onBoard = here && pathname === href && (boardParam ?? null) === board.id;
                    const tasks = loaded?.find((x) => x.id === board.id);
                    const boardOpen = unfolded(id, true);
                    return (
                      <li key={id} role="treeitem" aria-expanded={boardOpen} aria-selected={onBoard} data-sidebar-board={board.name}>
                        <div className="flex items-center">
                          <Toggle open={boardOpen} label={boardOpen ? s.fold(board.name) : s.unfold(board.name)} onClick={() => flip(id, true)} />
                          <Link prefetch={false} href={boardHref} onClick={onNavigate} className={rowClass(onBoard && !openNumber)}>
                            <Icon name="columns" className="shrink-0 text-muted" />
                            <span className="truncate">{board.name}</span>
                            {tasks && <span className="ml-auto shrink-0 text-xs text-muted">{tasks.tasks.length + tasks.more}</span>}
                          </Link>
                        </div>
                        {boardOpen && (
                          <ul role="group" className="ml-3 border-l border-border pl-1">
                            {!loaded && <li className="px-2 py-1.5 text-xs text-muted">…</li>}
                            {loaded && !tasks?.tasks.length && <li className="px-2 py-1.5 text-xs text-muted">{s.noTasks}</li>}
                            {tasks?.tasks.map((task) => {
                              const join = boardHref.includes("?") ? "&" : "?";
                              return (
                                <li key={task.number} role="treeitem" aria-selected={onBoard && openNumber === String(task.number)}>
                                  <Link
                                    prefetch={false}
                                    scroll={false}
                                    href={`${boardHref}${join}task=${task.number}`}
                                    onClick={(e) => {
                                      if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) && here && pathname === href) openingTask(task.number);
                                      onNavigate?.();
                                    }}
                                    title={`${project.key}-${task.number} · ${task.status}`}
                                    className={rowClass(here && openNumber === String(task.number))}
                                    data-sidebar-task={`${project.key}-${task.number}`}
                                  >
                                    <StatusDot category={task.category} />
                                    <span className={`min-w-0 flex-1 truncate ${task.category === "done" ? "text-muted" : ""}`}>{task.title}</span>
                                    <span className="shrink-0" title={`${t.tasks.fields.priority}: ${t.tasks.priorities[task.priority]}`}>
                                      <PriorityIcon priority={task.priority} />
                                    </span>
                                  </Link>
                                </li>
                              );
                            })}
                            {tasks && tasks.more > 0 && (
                              <li>
                                <Link prefetch={false} href={boardHref} onClick={onNavigate} className="block px-2 py-1.5 text-xs text-muted hover:text-foreground hover:underline">
                                  {s.moreTasks(tasks.more)}
                                </Link>
                              </li>
                            )}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
