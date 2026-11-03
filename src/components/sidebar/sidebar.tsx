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
import type { ProjectSummary } from "@/lib/tasks";
import { usePages } from "@/components/pages/pages-provider";
import { SignOutButton } from "@/components/sign-out-button";
import { expandAll } from "./expanded-store";
import { HeadingList, useActiveHeading, type Heading } from "@/components/editor/table-of-contents";
import { setSidebarShowsTree, useSidebarToc } from "@/components/editor/toc-store";
import { PreferencesSwitch } from "@/components/prefs/preferences-switch";
import { SearchButton } from "@/components/search/search-dialog";
import { PageTree } from "./page-tree";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { AnglerGuide } from "@/components/angler/angler-guide";
import { useAppearance } from "@/components/angler/appearance";

export function currentPageId(pathname: string): string | null {
  return pathname.match(/^\/w\/[a-z0-9]{8}\/p\/([0-9a-f-]{36})/)?.[1] ?? null;
}

export function Sidebar({
  user,
  workspaces,
  projects,
  onNavigate,
}: {
  user: CurrentUser;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { workspace, pages, create, pending } = usePages();
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

      <div className="min-h-0 flex-1 overflow-y-auto" data-angler-scroll>
        {sidebarToc && (
          <button
            type="button"
            onClick={() => setSidebarShowsTree(!sidebarToc.showTree)}
            className="mb-1 flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-muted hover:bg-surface hover:text-foreground md:min-h-9"
          >
            {sidebarToc.showTree ? `☰ ${t.toc.showToc}` : `🗂 ${t.toc.showTree}`}
          </button>
        )}
        {sidebarToc && !sidebarToc.showTree ? (
          <SidebarContents headings={sidebarToc.headings} onPick={onNavigate} />
        ) : (
          <PageTree userId={user.id} currentId={currentId} onNavigate={onNavigate} />
        )}
        <TaskProjects projects={projects} pathname={pathname} onNavigate={onNavigate} />
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
        <div className="px-1">
          <PreferencesSwitch compact />
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

// Task projects (stage 2a): the section heading opens all projects; the current one is marked for the fish.
function TaskProjects({ projects, pathname, onNavigate }: { projects: ProjectSummary[]; pathname: string; onNavigate?: () => void }) {
  const { workspace } = usePages();
  const base = workspacePath(workspace.shortId, "/tasks");
  return (
    <section aria-label={t.tasks.section} className="mb-2">
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
          const here = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={project.id}>
              <Link
                href={href}
                onClick={onNavigate}
                data-angler-here={here ? "" : undefined}
                className={`flex min-h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface md:min-h-9 ${here ? "bg-surface font-medium" : ""}`}
              >
                <span className="shrink-0">{project.icon ?? "📋"}</span>
                <span className="truncate">{project.name}</span>
                <span className="ml-auto font-mono text-xs text-muted">{project.key}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
