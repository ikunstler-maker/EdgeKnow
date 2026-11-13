"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { dateLocale, t } from "@/i18n";
import type { ChatFile, ChatMessage, ChatPerson, ChatReaction, ChatSearchHit } from "@/lib/chat";
import { searchChat } from "@/app/chat-actions";
import { Icon } from "@/components/ui/icon";
import { iconButtonClass } from "@/components/ui/button";
import { Composer, MessageStream, type MessageActions } from "./message-stream";

const c = () => t.chat;

function PanelHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label={t.common.close} className={iconButtonClass("ghost")}>
        <Icon name="close" size={18} />
      </button>
    </header>
  );
}

// A thread in the right panel: the top message, its replies and a field to answer.
export function ThreadPanel({
  channelName,
  root,
  replies,
  people,
  me,
  reactions,
  actions,
  pendingIds,
  note,
  onSend,
  onClose,
  files,
  shortId,
  upload,
  onSchedule,
}: {
  channelName: string;
  root: ChatMessage | null;
  replies: ChatMessage[] | null;
  people: Map<string, ChatPerson>;
  me: string;
  reactions: Map<string, ChatReaction[]>;
  actions: MessageActions;
  pendingIds: Set<string>;
  note: ReactNode;
  onSend: (body: string, fileIds: string[]) => void;
  onClose: () => void;
  files: Map<string, ChatFile[]>;
  shortId: string;
  upload: { shortId: string; channelId: string } | null;
  onSchedule?: (body: string, at: Date) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const everyone = [...people.values()];
  return (
    <div className="flex h-full min-h-0 flex-col" data-chat-thread>
      <PanelHeader title={actions.comments ? c().publish.commentsTitle : c().thread} subtitle={channelName} onClose={onClose} />
      {!root ? (
        <p className="p-4 text-sm text-muted">{c().threadGone}</p>
      ) : (
        <>
          <MessageStream
            messages={[root, ...(replies ?? [])]}
            people={people}
            me={me}
            reactions={reactions}
            actions={{ ...actions, onThread: undefined }}
            hasMore={false}
            loading={replies === null}
            pendingIds={pendingIds}
            onLoadOlder={() => {}}
            empty={null}
            files={files}
            shortId={shortId}
          />
          <Composer
            placeholder={c().replyPlaceholder}
            people={everyone}
            disabled={Boolean(root.deleted_at)}
            note={root.deleted_at ? c().threadGone : note}
            onSend={onSend}
            draft={draft}
            onDraft={setDraft}
            upload={upload}
            onSchedule={onSchedule}
          />
        </>
      )}
    </div>
  );
}

// The channel's pinned messages; a click shows the message in the stream.
export function PinsPanel({
  pins,
  people,
  canUnpin,
  onOpen,
  onUnpin,
  onClose,
}: {
  pins: ChatMessage[] | null;
  people: Map<string, ChatPerson>;
  canUnpin: boolean;
  onOpen: (message: ChatMessage) => void;
  onUnpin: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-chat-pins>
      <PanelHeader title={c().pins} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {pins === null ? (
          <p className="text-sm text-muted">{c().loading}</p>
        ) : pins.length === 0 ? (
          <p className="text-sm text-muted">{c().noPins}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pins.map((m) => (
              <li key={m.id} className="group relative rounded-lg border border-border">
                <button type="button" onClick={() => onOpen(m)} className="block w-full p-3 text-left" data-chat-pin={m.id}>
                  <span className="flex items-baseline gap-2 text-xs text-muted">
                    <span className="truncate font-medium text-foreground">{(m.author_id && people.get(m.author_id)?.name) || c().formerMember}</span>
                    {new Date(m.created_at).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" })}
                  </span>
                  <span className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm">{m.body}</span>
                </button>
                {canUnpin && (
                  <button type="button" onClick={() => onUnpin(m.id)} aria-label={c().unpin} title={c().unpin} className={`${iconButtonClass("ghost")} absolute right-1 top-1`}>
                    <Icon name="close" size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Search in the chat: this channel or everything the person sees; a result opens the
// message (in its thread when it is a reply).
export function SearchPanel({
  shortId,
  workspaceId,
  channelId,
  people,
  onOpen,
  onClose,
}: {
  shortId: string;
  workspaceId: string;
  channelId: string;
  people: Map<string, ChatPerson>;
  onOpen: (hit: ChatSearchHit) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [here, setHere] = useState(true);
  const [hits, setHits] = useState<ChatSearchHit[] | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    const id = ++latest.current;
    const words = query.trim();
    const timer = setTimeout(async () => {
      if (words.length < 2) return setHits(null);
      const found = await searchChat(shortId, workspaceId, words, here ? channelId : null);
      if (id === latest.current) setHits(found);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, here, shortId, workspaceId, channelId]);
  return (
    <div className="flex h-full min-h-0 flex-col" data-chat-search>
      <PanelHeader title={c().search.title} onClose={onClose} />
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={c().search.placeholder}
          aria-label={c().search.placeholder}
          autoFocus
          className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-accent md:h-9 md:min-h-0"
          data-chat-search-input
        />
        <label className="flex min-h-11 items-center gap-2 text-xs text-muted md:min-h-0">
          <input type="checkbox" checked={here} onChange={(e) => setHere(e.target.checked)} />
          {c().search.here}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {hits === null ? (
          <p className="p-2 text-sm text-muted">{c().search.hint}</p>
        ) : hits.length === 0 ? (
          <p className="p-2 text-sm text-muted">{c().search.none}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button type="button" onClick={() => onOpen(hit)} className="block w-full rounded-lg px-2 py-2 text-left hover:bg-hover" data-chat-search-hit={hit.id}>
                  <span className="flex items-baseline gap-2 text-xs text-muted">
                    <span className="truncate font-medium text-foreground">{(hit.author_id && people.get(hit.author_id)?.name) || c().formerMember}</span>
                    <span className="truncate">{hit.visibility === "direct" ? c().direct.title : `#${hit.channel}`}</span>
                    <span className="ml-auto shrink-0">{new Date(hit.created_at).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" })}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm">{hit.body}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
