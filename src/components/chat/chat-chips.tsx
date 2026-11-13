"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { t } from "@/i18n";
import { chipRefsIn, type ChatChip, type ChipRef } from "@/lib/chat-chips";
import { SERVICE_BRANDS, type ServiceKey } from "@/lib/services";
import { loadChatChips } from "@/app/chat-actions";
import { TaskChipView } from "@/components/editor/task-blocks";
import { ServiceIcon } from "@/components/services/service-icon";
import { Icon } from "@/components/ui/icon";

// Live chips under a message: workspace links become cards read with the reader's
// own access. Asks within a moment are read together; titles are read again every
// minute while the chat is shown (tasks refresh themselves, like wiki chips).

type Where = { shortId: string; workspaceId: string; people: { id: string; name: string }[] };
const ChipsContext = createContext<Where | null>(null);

export function ChatChipsProvider({ value, children }: { value: Where; children: ReactNode }) {
  return <ChipsContext.Provider value={value}>{children}</ChipsContext.Provider>;
}

const chips = new Map<string, ChatChip>();
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

async function load(refs: ChipRef[]) {
  if (!refs.length || !where.workspaceId) return;
  const from = where;
  const found = await loadChatChips(from.shortId, from.workspaceId, refs).catch(() => null);
  if (!found || from !== where) return;
  for (const ref of refs) chips.set(ref.key, found[ref.key] ?? { kind: "none" });
  notify();
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void load([...wanted.values()].filter((ref) => !chips.has(ref.key)));
  }, 30);
}

function startPolling() {
  if (poll || typeof window === "undefined") return;
  poll = setInterval(() => document.visibilityState === "visible" && void load([...wanted.values()]), 60_000);
}

function useChips(refs: ChipRef[], at: Where | null) {
  const keys = refs.map((r) => r.key).join(" ");
  useEffect(() => {
    if (!at || !refs.length) return;
    if (where.shortId !== at.shortId || where.workspaceId !== at.workspaceId) {
      where = { shortId: at.shortId, workspaceId: at.workspaceId };
      chips.clear();
      wanted.clear();
    }
    for (const ref of refs) wanted.set(ref.key, ref);
    startPolling();
    schedule();
    // refs are described by their keys
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, at?.shortId, at?.workspaceId]);
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => 0,
  );
  return refs.map((ref) => ({ ref, chip: chips.get(ref.key) }));
}

const noSubscribe = () => () => {};
// This site's host (empty while rendering on the server, so nothing differs on hydration).
export function useHost() {
  return useSyncExternalStore(noSubscribe, () => window.location.host, () => "");
}

const pill = "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 text-sm hover:bg-surface md:min-h-7";
// The wiki task chip, sized and wrapped for a message (it may not run off a phone screen).
const taskBox = "flex min-w-0 max-w-full text-base [&_.ek-chip]:inline-flex [&_.ek-chip]:min-w-0 [&_.ek-chip]:max-w-full [&_.ek-chip>button]:min-h-11 [&_.ek-chip>button]:px-2.5 md:[&_.ek-chip>button]:min-h-7";

export function MessageChips({ body }: { body: string }) {
  const at = useContext(ChipsContext);
  const host = useHost();
  const refs = at && host ? chipRefsIn(body, host, at.shortId) : [];
  const shown = useChips(refs, at);
  if (!at || !shown.length) return null;
  const c = t.chat.chips;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5" data-chat-chips>
      {shown.map(({ ref, chip }) => {
        if (!chip)
          return (
            <span key={ref.key} className={`${pill} text-muted`} data-chat-chip="loading">
              …
            </span>
          );
        if (chip.kind === "none")
          return (
            <span key={ref.key} className={`${pill} text-muted hover:bg-background`} title={c.noAccess} data-chat-chip="none">
              <Icon name="lock" size={14} />
              {c.noAccess}
            </span>
          );
        if (chip.kind === "task")
          return (
            <span key={ref.key} className={taskBox} data-chat-chip="task">
              <TaskChipView taskId={chip.id} workspace={at.shortId} people={at.people} />
            </span>
          );
        const service: ServiceKey | null = chip.kind === "page" ? "wiki" : chip.service === "wishlists" ? null : chip.service;
        const kindName = service ? SERVICE_BRANDS[service].name : c.wishlist;
        return (
          <Link key={ref.key} href={new URL(ref.url).pathname} prefetch={false} className={pill} title={`${kindName}: ${chip.title || c.untitled}`} data-chat-chip={chip.kind}>
            {service ? <ServiceIcon serviceId={service} size={16} /> : <Icon name="gift" size={16} />}
            {chip.icon && <span aria-hidden="true">{chip.icon}</span>}
            <span className="truncate font-medium">{chip.title || c.untitled}</span>
            <span className="shrink-0 text-xs text-muted">{kindName}</span>
          </Link>
        );
      })}
    </div>
  );
}
