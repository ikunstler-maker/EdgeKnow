"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { t } from "@/i18n";
import type { ServiceKey } from "@/lib/services";
import { setSidebarCollapsed, useSidebarCollapsed } from "@/components/app-shell";
import { ServiceIcon } from "@/components/services/service-icon";
import { buttonClass, iconButtonClass } from "./button";
import { Icon, type IconName } from "./icon";
import { Popover } from "./popover";

// One action of a document: in the top bar itself or inside one of its menus.
// `attrs` are the hooks checks and other code look for (data-play and the like).
export type StudioAction = {
  label: string;
  icon: IconName;
  onSelect: () => void;
  hint?: string;
  danger?: boolean;
  attrs?: Record<string, string>;
};

// The workspace of one document (a table, a deck, a board, a map): the whole
// viewport under one 48px bar. Left: the panel toggle, the way back, the name and
// the save state. Centre: the document's own switch. Right: export and import,
// access, the one main action and "more".
export function StudioShell({
  service,
  backHref,
  backLabel,
  title,
  onTitle,
  titleLabel,
  untitled,
  status,
  savingLabel,
  savedLabel,
  center,
  files = [],
  access,
  primary,
  more = [],
  notices,
  children,
}: {
  service: ServiceKey;
  backHref: string;
  backLabel: string;
  title: string;
  // Absent for a reader: the name is shown, not edited.
  onTitle?: (value: string) => void;
  titleLabel: string;
  untitled: string;
  status: string;
  savingLabel: string;
  savedLabel: string;
  center?: ReactNode;
  files?: StudioAction[];
  access?: ReactNode;
  primary?: StudioAction;
  more?: StudioAction[];
  notices?: ReactNode;
  children: ReactNode;
}) {
  const collapsed = useSidebarCollapsed();
  const [menu, setMenu] = useState<{ kind: "files" | "more"; anchor: HTMLElement } | null>(null);
  const toggle = (kind: "files" | "more") => (event: React.MouseEvent<HTMLElement>) => setMenu(menu?.kind === kind ? null : { kind, anchor: event.currentTarget });
  const items = menu?.kind === "files" ? files : more;

  return (
    <div className="flex h-[calc(100dvh-3.25rem)] w-full min-w-0 flex-col overflow-hidden md:h-dvh" data-studio={service}>
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-2" data-studio-bar>
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!collapsed)}
          aria-label={collapsed ? t.sidebar.showPanel : t.sidebar.hidePanel}
          title={`${collapsed ? t.sidebar.showPanel : t.sidebar.hidePanel} (Ctrl+\\)`}
          aria-pressed={collapsed}
          className={`${iconButtonClass("ghost")} hidden md:inline-flex`}
          data-studio-sidebar
        >
          <Icon name="sidebar" size={18} />
        </button>
        <Link href={backHref} aria-label={backLabel} title={backLabel} className={iconButtonClass("ghost")} data-studio-back>
          <Icon name="arrow-left" size={18} />
        </Link>
        <ServiceIcon serviceId={service} size={22} className="mx-1 hidden sm:inline-flex" />
        {onTitle ? (
          <input
            value={title}
            onChange={(event) => onTitle(event.target.value)}
            placeholder={titleLabel}
            aria-label={titleLabel}
            maxLength={200}
            className="h-8 min-w-0 max-w-md flex-1 rounded-lg bg-transparent px-2 text-sm font-semibold outline-none hover:bg-hover focus:bg-hover"
          />
        ) : (
          <h1 className="min-w-0 max-w-md flex-1 truncate px-2 text-sm font-semibold">{title || untitled}</h1>
        )}
        <span className="hidden shrink-0 text-xs text-muted sm:inline" role="status" data-save-status={status}>
          {status === "saving" ? savingLabel : status === "saved" ? savedLabel : ""}
        </span>
        <div className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex">{center}</div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {files.length > 0 && (
            <button type="button" onClick={toggle("files")} aria-expanded={menu?.kind === "files"} className={buttonClass("subtle")} data-studio-files>
              <Icon name="download" />
              <span className="hidden md:inline">{t.studio.files}</span>
              <Icon name="chevron-down" size={14} />
            </button>
          )}
          {access}
          {primary && (
            <button type="button" onClick={primary.onSelect} title={primary.hint} className={buttonClass("primary")} {...primary.attrs}>
              <Icon name={primary.icon} />
              <span className="hidden sm:inline">{primary.label}</span>
            </button>
          )}
          {more.length > 0 && (
            <button type="button" onClick={toggle("more")} aria-label={t.studio.more} title={t.studio.more} aria-expanded={menu?.kind === "more"} className={iconButtonClass("ghost")} data-studio-more>
              <Icon name="more" size={18} />
            </button>
          )}
        </div>
      </header>
      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={260}>
          <div role="menu" aria-label={menu.kind === "files" ? t.studio.files : t.studio.more} data-studio-menu={menu.kind}>
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                title={item.hint}
                onClick={() => {
                  setMenu(null);
                  item.onSelect();
                }}
                className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-hover md:min-h-8 ${item.danger ? "text-danger" : ""}`}
                {...item.attrs}
              >
                <Icon name={item.icon} className={item.danger ? "" : "text-muted"} />
                {item.label}
              </button>
            ))}
          </div>
        </Popover>
      )}
      {notices && <div className="shrink-0 space-y-1 border-b border-border px-3 py-1.5 text-sm empty:hidden">{notices}</div>}
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

// "Someone else changed it" and "couldn't save": the same two lines for every document.
export function StudioNotices({ readOnly, conflict, reloadLabel, error }: { readOnly?: string | null; conflict?: string | null; reloadLabel: string; error?: string | null }) {
  if (!readOnly && !conflict && !error) return null;
  return (
    <>
      {readOnly && <p className="text-muted">{readOnly}</p>}
      {conflict && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-danger">
          {conflict}
          <button type="button" onClick={() => window.location.reload()} className={buttonClass("subtle")}>
            {reloadLabel}
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </>
  );
}
