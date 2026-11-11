"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { t } from "@/i18n";
import type { CurrentUser } from "@/lib/auth";
import { workspacePath } from "@/lib/paths";
import type { WorkspaceSummary } from "@/lib/workspace";
import { usePages } from "@/components/pages/pages-provider";
import { Popover } from "@/components/ui/popover";
import { Icon, type IconName } from "@/components/ui/icon";
import { PreferencesSwitch } from "@/components/prefs/preferences-switch";
import { changelogIsFresh, subscribeChangelog } from "@/components/changelog/changelog-link";

const itemClass = "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-hover md:min-h-8";

// The workspace's name at the top of the left panel opens one menu for the
// workspace and the account: other workspaces, profile, settings, theme,
// language, what's new, help and sign-out.
export function WorkspaceMenu({ user, workspaces, pathname, onNavigate, trailing }: { user: CurrentUser; workspaces: WorkspaceSummary[]; pathname: string; onNavigate?: () => void; trailing?: ReactNode }) {
  const { workspace } = usePages();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // A dot on the name until the reader opens «What's new» after a release.
  const fresh = useSyncExternalStore(subscribeChangelog, changelogIsFresh, () => false);
  const close = () => {
    setAnchor(null);
    onNavigate?.();
  };
  const link = (href: string, label: string, icon: IconName, extra?: ReactNode) => (
    <Link prefetch={false} href={href} onClick={close} aria-current={pathname === href ? "page" : undefined} className={`${itemClass} ${pathname === href ? "bg-hover" : ""}`}>
      <Icon name={icon} className="text-muted" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra}
    </Link>
  );

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        aria-label={t.workspace.menu}
        aria-expanded={Boolean(anchor)}
        title={t.workspace.menu}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left hover:bg-hover"
        data-workspace-menu-button
      >
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-white">
          {workspace.name.slice(0, 1).toUpperCase()}
          {fresh && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger ring-2 ring-shell" data-changelog-dot />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight">{workspace.name}</span>
          <span className="block truncate text-xs text-muted">{t.workspace.roles[workspace.role]}</span>
        </span>
        <Icon name="chevrons-up-down" size={14} className="text-muted" />
      </button>
      {trailing}

      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={280}>
          <div data-workspace-menu>
            <p className="truncate px-2.5 pb-1 pt-1.5 text-xs text-muted">{user.email}</p>
            {workspaces.map((w) => (
              <Link prefetch={false} key={w.id} href={workspacePath(w.shortId)} onClick={close} className={`${itemClass} ${w.id === workspace.id ? "font-medium" : ""}`}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/15 text-[11px] font-semibold text-accent">{w.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === workspace.id && <Icon name="check" className="text-accent" />}
              </Link>
            ))}
            {link("/new", t.workspace.create, "plus")}
            <div className="my-1 border-t border-border" />
            {link(workspacePath(workspace.shortId, "/profile"), t.profile.link, "user")}
            {link(workspacePath(workspace.shortId, "/settings"), t.workspace.settings, "settings")}
            {user.isPlatformAdmin && link("/admin", t.platform.link, "shield")}
            <div className="my-1 border-t border-border" />
            <div className="flex flex-wrap items-center gap-2 px-1.5 py-1.5">
              <PreferencesSwitch compact />
            </div>
            <div className="my-1 border-t border-border" />
            {link("/changelog", t.changelog.title, "sparkle", fresh ? <span className="rounded-full bg-accent/15 px-1.5 text-[11px] font-medium text-accent">{t.changelog.newBadge}</span> : undefined)}
            {link("/help", t.help.link, "help")}
            <div className="my-1 border-t border-border" />
            <form action="/auth/signout" method="post">
              <button type="submit" className={itemClass}>
                <Icon name="sign-out" className="text-muted" />
                {t.common.signOut}
              </button>
            </form>
          </div>
        </Popover>
      )}
    </div>
  );
}
