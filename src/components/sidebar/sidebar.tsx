"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/i18n";
import type { CurrentUser } from "@/lib/auth";
import { ancestorsOf } from "@/lib/pages";
import { workspacePath } from "@/lib/paths";
import type { WorkspaceSummary } from "@/lib/workspace";
import { usePages } from "@/components/pages/pages-provider";
import { SignOutButton } from "@/components/sign-out-button";
import { expandAll } from "./expanded-store";
import { PageTree } from "./page-tree";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function currentPageId(pathname: string): string | null {
  return pathname.match(/^\/w\/[a-z0-9]{8}\/p\/([0-9a-f-]{36})/)?.[1] ?? null;
}

export function Sidebar({
  user,
  workspaces,
  onNavigate,
}: {
  user: CurrentUser;
  workspaces: WorkspaceSummary[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { workspace, pages, create, pending } = usePages();
  const currentId = currentPageId(pathname);

  // Open the branches leading to the page being viewed.
  useEffect(() => {
    if (!currentId) return;
    expandAll(ancestorsOf(pages, currentId).slice(0, -1).map((p) => p.id));
  }, [currentId, pages]);

  const navLink = (href: string, label: string, icon: string) => (
    <Link
      href={href}
      onClick={onNavigate}
      className={`flex min-h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface md:min-h-9 ${
        pathname === href ? "bg-surface font-medium" : ""
      }`}
    >
      <span>{icon}</span>
      {label}
    </Link>
  );

  return (
    <nav className="flex h-full flex-col gap-2 p-2" aria-label={t.sidebar.pagesHeading}>
      <WorkspaceSwitcher workspaces={workspaces} onNavigate={onNavigate} />

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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">
          {t.sidebar.pagesHeading}
        </p>
        <PageTree currentId={currentId} onNavigate={onNavigate} />
      </div>

      <div className="border-t border-border pt-2">
        {navLink(workspacePath(workspace.shortId, "/trash"), t.sidebar.trash, "🗑️")}
        {navLink(workspacePath(workspace.shortId, "/settings"), t.workspace.settings, "⚙️")}
        {user.isPlatformAdmin && navLink("/admin", t.platform.link, "🛰️")}
        <div className="mt-2 flex items-center gap-2 px-3">
          <span className="min-w-0 flex-1 truncate text-xs text-muted" title={user.email}>
            {user.email}
          </span>
          <SignOutButton />
        </div>
      </div>
    </nav>
  );
}
