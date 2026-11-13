"use client";

import { VaultFileEmbed } from "@/components/files/vault-file-embed";
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { t } from "@/i18n";
import { chipRefsIn, type ChatChip, type ChipRef } from "@/lib/chat-chips";
import { loadChatChips } from "@/app/chat-actions";
import { TaskChipView } from "@/components/editor/task-blocks";
import { SurveyEmbed } from "@/components/editor/survey-block";
import { NoAccessPill, ObjectPill } from "@/components/editor/object-chip";

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
        if (chip.kind === "none") return <NoAccessPill key={ref.key} size="card" attrs={{ "data-chat-chip": "none" }} />;
        if (chip.kind === "file")
          return (
            <div key={ref.key} className="w-full max-w-md text-sm" data-chat-chip="file">
              <VaultFileEmbed shortId={at.shortId} fileId={chip.id} editable={false} onPick={() => {}} />
            </div>
          );
        if (chip.kind === "task")
          return (
            <span key={ref.key} className={taskBox} data-chat-chip="task">
              <TaskChipView taskId={chip.id} workspace={at.shortId} people={at.people} />
            </span>
          );
        // A Questa survey is answered right in the message (the wiki's embedded form).
        if (chip.kind === "object" && chip.service === "surveys")
          return (
            <div key={ref.key} className="w-full max-w-xl text-sm" data-chat-chip="survey">
              <SurveyEmbed surveyId={ref.kind === "object" ? ref.id : ""} view="form" pageEditable={false} onPick={() => {}} workspace={at.shortId} />
            </div>
          );
        // The same chip as in the wiki and task descriptions (smart chips everywhere, UI-1).
        return (
          <ObjectPill
            key={ref.key}
            kind={chip.kind === "page" ? "wiki" : chip.service}
            title={chip.title || c.untitled}
            icon={chip.icon}
            href={new URL(ref.url).pathname}
            size="card"
            attrs={{ "data-chat-chip": chip.kind }}
          />
        );
      })}
    </div>
  );
}
