"use client";

import { ServiceSwitcher } from "@/components/services/service-switcher";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { t } from "@/i18n";
import type { CurrentUser } from "@/lib/auth";
import { ancestorsOf } from "@/lib/pages";
import { workspacePath } from "@/lib/paths";
import type { WorkspaceSummary } from "@/lib/workspace";
import type { BoardSummary, ObjectSummary, ProjectSummary } from "@/lib/tasks";
import { sidebarTasks } from "@/app/task-actions";
import { usePages } from "@/components/pages/pages-provider";
import { SignOutButton } from "@/components/sign-out-button";
import { ChangelogLink } from "@/components/changelog/changelog-link";
import { expandAll } from "./expanded-store";
import { HeadingList, useActiveHeading, type Heading } from "@/components/editor/table-of-contents";
import { setSidebarShowsTree, useSidebarToc } from "@/components/editor/toc-store";
import { PreferencesSwitch } from "@/components/prefs/preferences-switch";
import { SearchButton } from "@/components/search/search-dialog";
import { PageTree } from "./page-tree";
import { ServiceCollections, type Collections } from "./collections";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { AnglerGuide } from "@/components/angler/angler-guide";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useAppearance } from "@/components/angler/appearance";

export function currentPageId(pathname: string): string | null {
  return pathname.match(/^\/w\/[a-z0-9]{8}\/p\/([0-9a-f-]{36})/)?.[1] ?? null;
}

// Which service the sidebar shows: the one the person is in (the wiki elsewhere).
const OBJECT_SERVICES = ["boards", "nodes", "sheets", "surveys"] as const;
type Section = "wiki" | "tasks" | (typeof OBJECT_SERVICES)[number];
export function sectionOf(pathname: string, shortId: string): Section {
  const rest = pathname.slice(workspacePath(shortId).length);
  const first = rest.split("/")[1] ?? "";
  if (first === "tasks") return "tasks";
  return (OBJECT_SERVICES as readonly string[]).includes(first) ? (first as Section) : "wiki";
}

export function Sidebar({
  user,
  workspaces,
  projects,
  boards,
  objects,
  collections,
  onNavigate,
}: {
  user: CurrentUser;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  boards: BoardSummary[];
  objects: ObjectSummary[];
  collections: Collections;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { workspace, pages, create, pending } = usePages();
  const section = sectionOf(pathname, workspace.shortId);
  const currentId = currentPageId(pathname);
  // A page with comments may ask to show its contents here instead of the tree.
  const sidebarToc = useSidebarToc();
  const navRef = useRef<HTMLElement>(null);
  const { appearance } = useAppearance();
  // A guest's pages belong to the workspace owner, so a guest has no bin.
  const guest = workspace.role === "guest";

  // Open the branches leading to the page being viewed.
  useEffect(() => {
    if (!currentId) return;
    expandAll(ancestorsOf(pages, currentId).slice(0, -1).map((p) => p.id));
  }, [currentId, pages]);

  // The bottom links are one row of icons (the name shows on hover and is read aloud).
  const iconLink = (href: string, label: string, icon: string, hint?: string) => (
    <Link
      href={href}
      onClick={onNavigate}
      title={hint ?? label}
      aria-label={label}
      aria-current={pathname === href ? "page" : undefined}
      data-angler-here={pathname === href ? "" : undefined}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg hover:bg-surface md:h-9 md:w-9 ${
        pathname === href ? "bg-surface" : ""
      }`}
    >
      {icon}
    </Link>
  );

  return (
    <nav
      ref={navRef}
      data-angler-on={appearance.showMascot ? "" : undefined}
      className="relative flex h-full flex-col gap-2 p-2"
      aria-label={t.sidebar.pagesHeading}
    >
      <AnglerGuide containerRef={navRef} />
      <WorkspaceSwitcher workspaces={workspaces} onNavigate={onNavigate} />
      <ServiceSwitcher shortId={workspace.shortId} pathname={pathname} onNavigate={onNavigate} />

      <SearchButton currentPageId={currentId} onNavigate={onNavigate} />
      <NotificationBell onNavigate={onNavigate} />

      {section === "wiki" && (
      <button
        type="button"
        onClick={() => {
          create(null);
          onNavigate?.();
        }}
        disabled={pending}
        className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted hover:bg-surface hover:text-foreground disabled:opacity-60 md:min-h-9"
      >
        <span className="w-5 text-center">＋</span>
        {t.sidebar.newPage}
      </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" data-angler-scroll>
        {section === "tasks" && <TaskProjects projects={projects} boards={boards} pathname={pathname} onNavigate={onNavigate} />}
        {section !== "wiki" && section !== "tasks" && (
          <ServiceObjects service={section} objects={objects.filter((o) => o.service === section)} collections={collections} pathname={pathname} onNavigate={onNavigate} />
        )}
        {section === "wiki" && sidebarToc && (
          <button
            type="button"
            onClick={() => setSidebarShowsTree(!sidebarToc.showTree)}
            className="mb-1 flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-muted hover:bg-surface hover:text-foreground md:min-h-9"
          >
            {sidebarToc.showTree ? `☰ ${t.toc.showToc}` : `🗂 ${t.toc.showTree}`}
          </button>
        )}
        {section === "wiki" &&
          (sidebarToc && !sidebarToc.showTree ? (
            <SidebarContents headings={sidebarToc.headings} onPick={onNavigate} />
          ) : (
            <PageTree userId={user.id} currentId={currentId} onNavigate={onNavigate} />
          ))}
      </div>

      <div className="flex flex-col gap-1 border-t border-border pt-2" data-sidebar-bottom>
        <div className="flex flex-wrap items-center gap-0.5 px-1">
          {iconLink(workspacePath(workspace.shortId, "/profile"), t.profile.link, "👤", `${t.profile.link} · ${user.email}`)}
          {!guest && iconLink(workspacePath(workspace.shortId, "/trash"), t.sidebar.trash, "🗑️")}
          {iconLink(workspacePath(workspace.shortId, "/settings"), t.workspace.settings, "⚙️")}
          {user.isPlatformAdmin && iconLink("/admin", t.platform.link, "🛰️")}
          {iconLink("/help", t.help.link, "❓")}
          <span className="ml-auto">
            <SignOutButton icon />
          </span>
        </div>
        <div className="flex items-center gap-1 px-1">
          <div className="min-w-0 flex-1">
            <PreferencesSwitch compact />
          </div>
          <ChangelogLink onNavigate={onNavigate} current={pathname === "/changelog"} />
        </div>
      </div>
    </nav>
  );
}

function SidebarContents({ headings, onPick }: { headings: Heading[]; onPick?: () => void }) {
  const active = useActiveHeading(headings);
  return (
    <section aria-label={t.toc.title}>
      <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">{t.toc.title}</p>
      <HeadingList headings={headings} active={active} onPick={onPick} />
    </section>
  );
}

const linkClass = (here: boolean) => `flex min-h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface md:min-h-9 ${here ? "bg-surface font-medium" : ""}`;

// Tasks: projects; the open project shows its boards and its tasks.
function TaskProjects({ projects, boards, pathname, onNavigate }: { projects: ProjectSummary[]; boards: BoardSummary[]; pathname: string; onNavigate?: () => void }) {
  const { workspace } = usePages();
  const base = workspacePath(workspace.shortId, "/tasks");
  const openKey = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split("/")[0] : null;
  const open = projects.find((p) => p.key === openKey) ?? null;
  const [tasks, setTasks] = useState<{ project: string; list: { id: string; number: number; title: string }[] } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    sidebarTasks(open.id).then(
      (list) => live && setTasks({ project: open.id, list }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [open, pathname]);
  const board = useSearchParams().get("board");
  return (
    <section aria-label={t.tasks.section} className="mb-2" data-sidebar-section="tasks">
      <Link
        href={base}
        onClick={onNavigate}
        data-angler-here={pathname === base ? "" : undefined}
        className="block px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted hover:text-foreground"
      >
        {t.tasks.section}
      </Link>
      <ul>
        {projects.map((project) => {
          const href = `${base}/${project.key}`;
          const here = project.id === open?.id;
          const own = boards.filter((b) => b.project_id === project.id);
          const list = tasks?.project === project.id ? tasks.list : null;
          return (
            <li key={project.id}>
              <Link href={href} onClick={onNavigate} data-angler-here={pathname === href ? "" : undefined} className={linkClass(pathname === href && !board)}>
                <span className="shrink-0">{project.icon ?? "📋"}</span>
                <span className="truncate">{project.name}</span>
                <span className="ml-auto font-mono text-xs text-muted">{project.key}</span>
              </Link>
              {here && (
                <div className="ml-4 border-l border-border pl-1">
                  {own.length > 0 && (
                    <ul aria-label={t.sidebar.mainBoard}>
                      <li>
                        <Link href={href} onClick={onNavigate} className={linkClass(pathname === href && !board)}>
                          🗂 <span className="truncate">{t.sidebar.mainBoard}</span>
                        </Link>
                      </li>
                      {own.map((b) => (
                        <li key={b.id}>
                          <Link href={`${href}?board=${b.id}`} onClick={onNavigate} className={linkClass(board === b.id)} data-sidebar-board={b.name}>
                            🗂 <span className="truncate">{b.name}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="px-3 pb-1 pt-2 text-xs text-muted">{t.sidebar.projectTasks}</p>
                  {list && list.length === 0 && <p className="px-3 text-xs text-muted">{t.sidebar.noTasks}</p>}
                  <ul>
                    {list?.map((task) => {
                      const taskHref = `${href}/${task.number}`;
                      return (
                        <li key={task.id}>
                          <Link href={taskHref} onClick={onNavigate} data-angler-here={pathname === taskHref ? "" : undefined} className={linkClass(pathname === taskHref)} data-sidebar-task>
                            <span className="shrink-0 font-mono text-xs text-muted">{project.key}-{task.number}</span>
                            <span className="truncate">{task.title}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Tables, whiteboards, maps, surveys: the list of the service's objects.
function ServiceObjects({ service, objects, collections, pathname, onNavigate }: { service: string; objects: ObjectSummary[]; collections: Collections; pathname: string; onNavigate?: () => void }) {
  const { workspace } = usePages();
  const base = workspacePath(workspace.shortId, `/${service}`);
  const name = t.services.items[service as keyof typeof t.services.items]?.name ?? service;
  return (
    <section aria-label={name} className="mb-2" data-sidebar-section={service}>
      <Link href={base} onClick={onNavigate} data-angler-here={pathname === base ? "" : undefined} className="block px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted hover:text-foreground">
        {t.sidebar.allOf(name)}
      </Link>
      <ServiceCollections
        workspaceId={workspace.id}
        service={service}
        base={base}
        objects={objects}
        collections={collections}
        canManage={workspace.role !== "guest"}
        pathname={pathname}
        onNavigate={onNavigate}
      />
      {objects.length === 0 && <p className="px-3 text-xs text-muted">{t.sidebar.noObjects}</p>}
    </section>
  );
}
