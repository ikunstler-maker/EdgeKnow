"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { createReactInlineContentSpec } from "@blocknote/react";
import { t } from "@/i18n";
import { loadChatChips } from "@/app/chat-actions";
import { CHIP_SERVICES, type ChatChip, type ChipRef, type ChipService } from "@/lib/chat-chips";
import { SERVICE_BRANDS } from "@/lib/services";
import { workspacePath } from "@/lib/paths";
import { vaultFileHref } from "@/lib/vault-links";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { ServiceIcon } from "@/components/services/service-icon";
import { Icon } from "@/components/ui/icon";

// Smart chips everywhere (UI-1): a table, board, map, slide deck, survey, app, wishlist or
// Vault file as a pill in the text. Only the kind and id are stored; the title is read
// live with the reader's own access — who can't see it gets "No access", never the title.

export type ObjectChipKind = ChipService | "files";
export const OBJECT_CHIP_KINDS: readonly ObjectChipKind[] = [...CHIP_SERVICES, "files"];

const ch = t.editor.chips;
export const pillClass =
  "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-px align-baseline text-[0.85em] font-medium leading-snug whitespace-nowrap";

// ---- Reading titles: chips asking within a moment are read together; again every minute.
type Entry = ChatChip;
const entries = new Map<string, Entry>();
const wanted = new Map<string, ChipRef>();
const listeners = new Set<() => void>();
let where = { shortId: "", workspaceId: "" };
let timer: ReturnType<typeof setTimeout> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let version = 0;

const notify = () => {
  version += 1;
  for (const listener of listeners) listener();
};

const refOf = (kind: ObjectChipKind, id: string): ChipRef =>
  kind === "files" ? { key: `file:${id}`, url: "", kind: "file", id } : { key: `object:${id}`, url: "", kind: "object", service: kind, id };

async function load(refs: ChipRef[]) {
  if (!refs.length || !where.workspaceId) return;
  const from = where;
  const found = await loadChatChips(from.shortId, from.workspaceId, refs).catch(() => null);
  if (!found || from !== where) return;
  for (const ref of refs) entries.set(ref.key, found[ref.key] ?? { kind: "none" });
  notify();
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void load([...wanted.values()].filter((ref) => !entries.has(ref.key)));
  }, 30);
}

// A chip just inserted from the "@" menu shows its title at once.
export function rememberObjectChip(kind: ObjectChipKind, id: string, title: string, icon: string | null = null) {
  const ref = refOf(kind, id);
  entries.set(ref.key, kind === "files" ? { kind: "file", id, title } : { kind: "object", service: kind, title, icon });
  notify();
}

function useObjectChip(kind: ObjectChipKind, id: string, shortId: string | undefined, workspaceId: string | undefined) {
  const ref = refOf(kind, id);
  useEffect(() => {
    if (!shortId || !workspaceId || !id) return;
    if (where.shortId !== shortId || where.workspaceId !== workspaceId) {
      where = { shortId, workspaceId };
      entries.clear();
      wanted.clear();
    }
    wanted.set(ref.key, ref);
    if (!poll && typeof window !== "undefined")
      poll = setInterval(() => document.visibilityState === "visible" && void load([...wanted.values()]), 60_000);
    schedule();
    // The ref is described by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.key, shortId, workspaceId]);
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => 0,
  );
  return entries.get(ref.key);
}

// ---- The pill itself (also used under chat messages).
// "inline" sits in a line of text; "card" stands on its own (under a chat message: 44 px on a phone).
const sizes = {
  inline: pillClass,
  card: "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full px-2.5 text-sm md:min-h-7",
};
type PillSize = keyof typeof sizes;

export function NoAccessPill({ size = "inline", attrs }: { size?: PillSize; attrs?: Record<string, string> }) {
  return (
    <span contentEditable={false} className={`${sizes[size]} ek-chip bg-surface text-muted`} title={ch.noAccess} data-object-chip="none" {...attrs}>
      <Icon name="lock" size={14} className="inline" />
      {ch.noAccess}
    </span>
  );
}

// One look for every chip of a workspace thing: the service's mark, the thing's own icon if
// it has one, its title; on cards also the kind ("Table", "Board"…).
export function ObjectPill({ kind, title, icon, href, size = "inline", attrs }: { kind: ObjectChipKind | "wiki"; title: string; icon?: string | null; href: string; size?: PillSize; attrs?: Record<string, string> }) {
  const service = kind === "wishlists" ? null : kind;
  const kindName = service ? SERVICE_BRANDS[service].name : t.chat.chips.wishlist;
  const name = title || ch.untitledObject;
  return (
    <Link
      prefetch={false}
      href={href}
      contentEditable={false}
      className={`${sizes[size]} ek-chip ek-chip-link border border-border bg-background text-foreground hover:bg-surface`}
      title={`${kindName}: ${name}`}
      data-object-chip={kind}
      {...attrs}
    >
      {service ? <ServiceIcon serviceId={service} size={size === "card" ? 16 : 14} /> : <Icon name="gift" size={size === "card" ? 16 : 14} />}
      {icon && <span aria-hidden="true">{icon}</span>}
      <span className={`truncate ${size === "card" ? "font-medium" : ""}`}>{name}</span>
      {size === "card" && <span className="shrink-0 text-xs text-muted">{kindName}</span>}
    </Link>
  );
}

export const objectHref = (shortId: string, kind: ObjectChipKind, id: string) =>
  kind === "files" ? vaultFileHref(shortId, id) : workspacePath(shortId, `/${kind}/${id}`);

export function ObjectChipView({ kind, id }: { kind: string; id: string }) {
  const pages = useOptionalPages();
  const known = (OBJECT_CHIP_KINDS as readonly string[]).includes(kind) ? (kind as ObjectChipKind) : null;
  const entry = useObjectChip(known ?? "files", id, pages?.workspace.shortId, pages?.workspace.id);
  if (!pages || !known) return <NoAccessPill />;
  if (!entry)
    return (
      <span contentEditable={false} className={`${pillClass} ek-chip bg-surface text-muted`} data-object-chip="loading">
        …
      </span>
    );
  if (entry.kind === "object" && entry.service === known) return <ObjectPill kind={known} title={entry.title} icon={entry.icon} href={objectHref(pages.workspace.shortId, known, id)} />;
  if (entry.kind === "file" && known === "files") return <ObjectPill kind="files" title={entry.title ?? ""} href={objectHref(pages.workspace.shortId, "files", id)} />;
  return <NoAccessPill />;
}

export const objectChip = createReactInlineContentSpec(
  {
    type: "objectChip",
    propSchema: { kind: { default: "" }, objectId: { default: "" } },
    content: "none",
  },
  {
    render: ({ inlineContent }) => <ObjectChipView kind={inlineContent.props.kind} id={inlineContent.props.objectId} />,
    toExternalHTML: () => <span>[{ch.objectChip}]</span>,
  },
);
