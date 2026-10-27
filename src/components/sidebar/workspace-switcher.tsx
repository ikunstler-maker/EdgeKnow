"use client";

import { useState } from "react";
import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import type { WorkspaceSummary } from "@/lib/workspace";
import { usePages } from "@/components/pages/pages-provider";
import { Popover } from "@/components/ui/popover";

export function WorkspaceSwitcher({
  workspaces,
  onNavigate,
}: {
  workspaces: WorkspaceSummary[];
  onNavigate?: () => void;
}) {
  const { workspace } = usePages();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => {
    setAnchor(null);
    onNavigate?.();
  };

  const itemClass =
    "flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-surface";

  return (
    <>
      <button
        type="button"
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        aria-label={t.workspace.switcher}
        title={t.workspace.switcher}
        className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left hover:bg-surface"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold text-white">
          {workspace.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{workspace.name}</span>
          <span className="block text-xs text-muted">{t.workspace.roles[workspace.role]}</span>
        </span>
        <span className="text-xs text-muted">▾</span>
      </button>

      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={256}>
          {workspaces.map((w) => (
            <Link
              key={w.id}
              href={workspacePath(w.shortId)}
              onClick={close}
              className={`${itemClass} ${w.id === workspace.id ? "font-semibold" : ""}`}
            >
              <span className="w-4 text-center">{w.id === workspace.id ? "✓" : ""}</span>
              <span className="truncate">{w.name}</span>
            </Link>
          ))}
          <div className="my-1 border-t border-border" />
          <Link href={workspacePath(workspace.shortId, "/settings")} onClick={close} className={itemClass}>
            <span className="w-4 text-center">⚙️</span>
            {t.workspace.settings}
          </Link>
          <Link href="/new" onClick={close} className={itemClass}>
            <span className="w-4 text-center">＋</span>
            {t.workspace.create}
          </Link>
        </Popover>
      )}
    </>
  );
}
