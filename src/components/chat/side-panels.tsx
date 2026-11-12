"use client";

import { useState, type ReactNode } from "react";
import { dateLocale, t } from "@/i18n";
import type { ChatFile, ChatMessage, ChatPerson, ChatReaction } from "@/lib/chat";
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
