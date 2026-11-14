"use client";

import { ServiceSwitcher } from "@/components/services/service-switcher";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/i18n";
import type { CurrentUser } from "@/lib/auth";
import { ancestorsOf } from "@/lib/pages";
import { workspacePath } from "@/lib/paths";
import type { WorkspaceSummary } from "@/lib/workspace";
import type { BoardSummary, ObjectSummary, ProjectSummary } from "@/lib/tasks";
import { usePages } from "@/components/pages/pages-provider";
import { expandAll } from "./expanded-store";
import { HeadingList, useActiveHeading, type Heading } from "@/components/editor/table-of-contents";
import { setSidebarShowsTree, useSidebarToc } from "@/components/editor/toc-store";
import { SearchButton } from "@/components/search/search-dialog";
import { PageTree } from "./page-tree";
import { TaskProjects } from "./task-tree";
import { ServiceCollections, type Collections } from "./collections";
import { WorkspaceMenu } from "./workspace-menu";
import { Icon } from "@/components/ui/icon";
import { OPEN_APUS_EVENT } from "@/components/apus/apus-events";
import { AnglerGuide } from "@/components/angler/angler-guide";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useAppearance } from "@/components/angler/appearance";

export function currentPageId(pathname: string): string | null {
  return pathname.match(/^\/w\/[a-z0-9]{8}\/p\/([0-9a-f-]{36})/)?.[1] ?? null;
}

// Which service the sidebar shows: the one the person is in (the wiki elsewhere).
const OBJECT_SERVICES = ["boards", "nodes", "sheets", "slides", "surveys", "apps"] as const;
type Section = "wiki" | "tasks" | "calendar" | "chat" | "files" | (typeof OBJECT_SERVICES)[number];
export function sectionOf(pathname: string, shortId: string): Section {
  const rest = pathname.slice(workspacePath(shortId).length);
  const first = rest.split("/")[1] ?? "";
  if (first === "tasks") return "tasks";
  // The calendar keeps everything on its own screen: the panel shows no list there.
  if (first === "calendar") return "calendar";
  // So does the chat (its channels are its own left column).
  if (first === "chat") return "chat";
  // Vault: its filters are on its own screen.
  if (first === "files") return "files";
  return (OBJECT_SERVICES as readonly string[]).includes(first) ? (first as Section) : "wiki";
}

export function Sidebar({
  user,
  workspaces,
  projects,
  boards,
  objects,
  collections,
  canCreatePages = true,
  onNavigate,
  onCollapse,
}: {
  user: CurrentUser;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  boards: BoardSummary[];
  objects: ObjectSummary[];
  collections: Collections;
  canCreatePages?: boolean;
  onNavigate?: () => void;
  // Desktop only: hides the panel (the shell shows a slim rail instead).
  onCollapse?: () => void;
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

  const trashHref = workspacePath(workspace.shortId, "/trash");
  const row = "flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted hover:bg-hover hover:text-foreground md:min-h-8";

  return (
    <nav
      ref={navRef}
      data-angler-on={appearance.showMascot ? "" : undefined}
      className="relative flex h-full flex-col gap-1 p-2"
      aria-label={t.sidebar.pagesHeading}
    >
      <AnglerGuide containerRef={navRef} />
      <WorkspaceMenu
        user={user}
        workspaces={workspaces}
        pathname={pathname}
        onNavigate={onNavigate}
        trailing={
          onCollapse && (
            <button type="button" onClick={onCollapse} aria-label={t.sidebar.hidePanel} title={`${t.sidebar.hidePanel} (Ctrl+\\)`} className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-foreground md:flex" data-sidebar-collapse>
              <Icon name="sidebar" size={18} />
            </button>
          )
        }
      />
      <ServiceSwitcher shortId={workspace.shortId} userId={user.id} pathname={pathname} onNavigate={onNavigate} />

      <SearchButton currentPageId={currentId} onNavigate={onNavigate} />
      <NotificationBell onNavigate={onNavigate} />

      {section === "wiki" && canCreatePages && (
      <button
        type="button"
        onClick={() => {
          create(null);
          onNavigate?.();
        }}
        disabled={pending}
        className={`${row} disabled:opacity-60`}
      >
        <Icon name="plus" />
        {t.sidebar.newPage}
      </button>
      )}

      <div className="mt-1 min-h-0 flex-1 overflow-y-auto border-t border-border pt-1" data-angler-scroll>
        {section === "tasks" && <TaskProjects projects={projects} boards={boards} pathname={pathname} onNavigate={onNavigate} />}
        {section !== "wiki" && section !== "tasks" && section !== "calendar" && section !== "chat" && section !== "files" && (
          <ServiceObjects service={section} objects={objects.filter((o) => o.service === section)} collections={collections} pathname={pathname} onNavigate={onNavigate} />
        )}
        {section === "wiki" && sidebarToc && (
          <button
            type="button"
            onClick={() => setSidebarShowsTree(!sidebarToc.showTree)}
            className={`${row} mb-1 w-full text-left`}
          >
            <Icon name={sidebarToc.showTree ? "list" : "file-text"} />
            {sidebarToc.showTree ? t.toc.showToc : t.toc.showTree}
          </button>
        )}
        {section === "wiki" &&
          (sidebarToc && !sidebarToc.showTree ? (
            <SidebarContents headings={sidebarToc.headings} onPick={onNavigate} />
          ) : (
            <PageTree userId={user.id} currentId={currentId} onNavigate={onNavigate} canCreate={canCreatePages} />
          ))}
      </div>

      {/* A slim bottom bar: the bin and Apus. Everything else lives in the workspace menu. */}
      <div className="flex items-center gap-1 border-t border-border pt-1.5" data-sidebar-bottom>
        {!guest && (
          <Link
            prefetch={false}
            href={trashHref}
            onClick={onNavigate}
            aria-label={t.sidebar.trash}
            aria-current={pathname === trashHref ? "page" : undefined}
            data-angler-here={pathname === trashHref ? "" : undefined}
            className={`${row} min-w-0 flex-1 ${pathname === trashHref ? "bg-hover text-foreground" : ""}`}
          >
            <Icon name="trash" />
            <span className="truncate">{t.sidebar.trash}</span>
          </Link>
        )}
        {appearance.lure !== "hidden" && (
          <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_APUS_EVENT))} className={`${row} ${guest ? "flex-1" : ""}`} data-sidebar-apus>
            <Icon name="sparkle" />
            <span className="truncate">{t.apus.name}</span>
          </button>
        )}
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


// Tables, whiteboards, maps, surveys: the list of the service's objects.
function ServiceObjects({ service, objects, collections, pathname, onNavigate }: { service: string; objects: ObjectSummary[]; collections: Collections; pathname: string; onNavigate?: () => void }) {
  const { workspace } = usePages();
  const base = workspacePath(workspace.shortId, `/${service}`);
  const name = t.services.items[service as keyof typeof t.services.items]?.name ?? service;
  return (
    <section aria-label={name} className="mb-2" data-sidebar-section={service}>
      <Link prefetch={false} href={base} onClick={onNavigate} data-angler-here={pathname === base ? "" : undefined} className="block px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted hover:text-foreground">
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
