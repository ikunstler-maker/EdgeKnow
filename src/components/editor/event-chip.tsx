"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { createReactInlineContentSpec } from "@blocknote/react";
import { dateLocale, t } from "@/i18n";
import { eventChips } from "@/app/calendar-actions";
import type { EventChip } from "@/lib/calendar";
import { workspacePath } from "@/lib/paths";
import { useOptionalPages } from "@/components/pages/pages-provider";

// A calendar event as a chip in the text (Doba, phase 2b). Only the event's id is
// stored; the title and time are read live with the reader's own access — who can't see
// the event gets "no access", without its name.

type Entry = EventChip | null; // null: no access (or no such event)
const events = new Map<string, Entry>();
const wanted = new Set<string>();
const listeners = new Set<() => void>();
let shortId = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let version = 0;

const notify = () => {
  version += 1;
  for (const listener of listeners) listener();
};

// Chips that ask within a moment are read together.
function schedule() {
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    const ids = [...wanted].filter((id) => !events.has(id));
    if (!ids.length || !shortId) return;
    const found = await eventChips(shortId, ids).catch(() => null);
    if (!found) return;
    const byId = new Map(found.map((event) => [event.id, event]));
    for (const id of ids) events.set(id, byId.get(id) ?? null);
    notify();
  }, 30);
}

function useEventChip(workspace: string | undefined, id: string): Entry | undefined {
  useEffect(() => {
    if (!workspace || !id) return;
    if (shortId !== workspace) {
      shortId = workspace;
      events.clear();
    }
    wanted.add(id);
    schedule();
  }, [workspace, id]);
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => 0,
  );
  return events.get(id);
}

// After picking an event from the "@" menu: show it at once.
export function rememberEvent(event: EventChip) {
  events.set(event.id, event);
  wanted.add(event.id);
  notify();
}

const pill = "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 align-baseline text-[0.85em] font-medium leading-tight";

export const eventWhen = (event: { starts_at: string; all_day: boolean }) =>
  new Intl.DateTimeFormat(dateLocale(), event.all_day ? { day: "numeric", month: "short", timeZone: "UTC" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(event.starts_at));

export function EventChipView({ eventId }: { eventId: string }) {
  const workspace = useOptionalPages()?.workspace.shortId;
  const event = useEventChip(workspace, eventId);
  const w = t.calendar.chip;
  if (event === undefined) {
    return (
      <span contentEditable={false} className={`${pill} ek-chip bg-surface text-muted`} data-event-chip="loading">
        📅 …
      </span>
    );
  }
  if (event === null || !workspace) {
    return (
      <span contentEditable={false} className={`${pill} ek-chip bg-surface text-muted`} title={w.noAccess} data-event-chip="hidden">
        🔒 {w.noAccess}
      </span>
    );
  }
  return (
    <span contentEditable={false} className="ek-chip" data-event-chip={event.title}>
      <Link
        href={workspacePath(workspace, `/calendar?event=${event.id}`)}
        className={`${pill} border border-border bg-background text-foreground hover:bg-surface ${event.cancelled ? "line-through opacity-60" : ""}`}
        title={`${event.title} · ${eventWhen(event)}`}
      >
        <span aria-hidden="true">📅</span>
        <span className="truncate">{event.title}</span>
        <span className="shrink-0 text-muted">
          {event.recurring ? "↻ " : ""}
          {eventWhen(event)}
        </span>
      </Link>
    </span>
  );
}

export const eventChip = createReactInlineContentSpec(
  {
    type: "eventChip",
    propSchema: { eventId: { default: "" } },
    content: "none",
  },
  {
    render: ({ inlineContent }) => <EventChipView eventId={inlineContent.props.eventId} />,
    toExternalHTML: () => <span>[{t.calendar.chip.title}]</span>,
  },
);
