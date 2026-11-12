"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { dateLocale, t } from "@/i18n";
import { MAX_MESSAGE, type ChatMessage, type ChatPerson } from "@/lib/chat";
import { Icon } from "@/components/ui/icon";
import { iconButtonClass } from "@/components/ui/button";

const c = () => t.chat;
// Messages of one author within this gap read as one group (one name, one avatar).
const GROUP_MS = 5 * 60_000;
const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

// Plain text with links (only http and https become links).
function MessageText({ body }: { body: string }) {
  const parts = body.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2 break-all">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function Avatar({ person, size = 32 }: { person: ChatPerson | undefined; size?: number }) {
  const name = person?.name ?? "?";
  if (person?.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={person.avatarUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} referrerPolicy="no-referrer" />;
  }
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-full bg-hover text-xs font-semibold text-muted" style={{ width: size, height: size }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return c().today;
  if (d.toDateString() === yesterday.toDateString()) return c().yesterday;
  return d.toLocaleDateString(dateLocale(), { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};

// The channel's stream: older pages on scrolling up, kept at the bottom while new
// messages arrive (unless the person scrolled up to read).
export function MessageStream({
  messages,
  people,
  me,
  canModerate,
  hasMore,
  loading,
  pendingIds,
  onLoadOlder,
  onEdit,
  onDelete,
  empty,
}: {
  messages: ChatMessage[];
  people: Map<string, ChatPerson>;
  me: string;
  canModerate: boolean;
  hasMore: boolean;
  loading: boolean;
  pendingIds: Set<string>;
  onLoadOlder: () => void;
  onEdit: (id: string, body: string) => Promise<boolean>;
  onDelete: (id: string) => void;
  empty: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const previousHeight = useRef(0);
  const firstId = messages[0]?.id;
  const lastId = messages[messages.length - 1]?.id;
  const [editing, setEditing] = useState<string | null>(null);

  // New at the bottom: follow if the person was at the bottom. Older pages added on
  // top: keep the same message in view.
  const lastFirst = useRef(firstId);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (lastFirst.current && firstId !== lastFirst.current && previousHeight.current) {
      el.scrollTop += el.scrollHeight - previousHeight.current;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    lastFirst.current = firstId;
    previousHeight.current = el.scrollHeight;
  }, [firstId, lastId, messages.length]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    previousHeight.current = el.scrollHeight;
    if (el.scrollTop < 120 && hasMore && !loading) onLoadOlder();
  };

  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-2 py-3 md:px-4" data-chat-stream role="log" aria-live="polite" aria-label={c().messages}>
      {hasMore && (
        <div className="flex justify-center py-2">
          <button type="button" onClick={onLoadOlder} disabled={loading} className="min-h-11 rounded-md px-3 text-sm text-muted hover:text-foreground md:min-h-8">
            {loading ? c().loading : c().older}
          </button>
        </div>
      )}
      {!hasMore && !loading && messages.length === 0 && empty}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
        const grouped = !newDay && prev && prev.author_id === m.author_id && !prev.deleted_at && Date.parse(m.created_at) - Date.parse(prev.created_at) < GROUP_MS;
        const author = m.author_id ? people.get(m.author_id) : undefined;
        const mine = m.author_id === me;
        const pending = pendingIds.has(m.id);
        return (
          <Fragment key={m.id}>
            {newDay && (
              <div className="my-3 flex items-center gap-3 text-xs text-muted" role="separator">
                <span className="h-px flex-1 bg-border" />
                {dayLabel(m.created_at)}
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            <article
              className={`group relative flex gap-3 rounded-lg px-2 hover:bg-hover/60 ${grouped ? "py-0.5" : "mt-2 py-1"} ${pending ? "opacity-60" : ""}`}
              data-chat-message={m.id}
              // A tap (no hover on a phone) shows the message's actions.
              tabIndex={!m.deleted_at && (mine || canModerate) ? 0 : undefined}
            >
              <div className="w-8 shrink-0">{!grouped && <Avatar person={author} />}</div>
              <div className="min-w-0 flex-1">
                {!grouped && (
                  <header className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-semibold">{author?.name ?? c().formerMember}</span>
                    {author?.guest && <span className="rounded border border-border px-1 text-[10px] uppercase text-muted">{c().guest}</span>}
                    <time dateTime={m.created_at} className="text-xs text-muted">{time(m.created_at)}</time>
                  </header>
                )}
                {m.deleted_at ? (
                  <p className="text-sm italic text-muted">{c().deleted}</p>
                ) : editing === m.id ? (
                  <EditBox
                    initial={m.body}
                    onCancel={() => setEditing(null)}
                    onSave={async (body) => {
                      if (await onEdit(m.id, body)) setEditing(null);
                    }}
                  />
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    <MessageText body={m.body} />
                    {m.edited_at && <span className="ml-1 text-xs text-muted">{c().edited}</span>}
                  </p>
                )}
                {pending && <p className="text-xs text-muted">{c().sending}</p>}
              </div>
              {!m.deleted_at && !pending && editing !== m.id && (mine || canModerate) && (
                <div className="absolute -top-3 right-2 hidden gap-0.5 rounded-lg border border-border bg-overlay p-0.5 shadow-sm group-focus-within:flex group-hover:flex">
                  {mine && (
                    <button type="button" onClick={() => setEditing(m.id)} aria-label={c().edit} title={c().edit} className={iconButtonClass("ghost")}>
                      <Icon name="edit" size={15} />
                    </button>
                  )}
                  <button type="button" onClick={() => onDelete(m.id)} aria-label={c().delete} title={c().delete} className={iconButtonClass("ghost")}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              )}
            </article>
          </Fragment>
        );
      })}
    </div>
  );
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (body: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="mt-1">
      <AutoTextarea
        value={value}
        onChange={setValue}
        label={c().edit}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (value.trim()) onSave(value);
          }
        }}
        autoFocus
      />
      <p className="mt-1 text-xs text-muted">{c().editHint}</p>
    </div>
  );
}

function AutoTextarea({
  value,
  onChange,
  onKeyDown,
  label,
  placeholder,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      maxLength={MAX_MESSAGE}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      className="block max-h-60 min-h-11 w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:border-border-strong md:text-sm"
    />
  );
}

// The field at the bottom: Enter sends, Shift+Enter starts a new line. A draft per
// channel survives switching channels (in this tab).
export function Composer({ channelName, disabled, note, onSend, draft, onDraft }: {
  channelName: string;
  disabled: boolean;
  note: ReactNode;
  onSend: (body: string) => void;
  draft: string;
  onDraft: (value: string) => void;
}) {
  const send = () => {
    const body = draft.trim();
    if (!body || disabled) return;
    onSend(body);
    onDraft("");
  };
  return (
    <div className="shrink-0 border-t border-border px-2 py-2 md:px-4" data-chat-composer>
      {note ? (
        <div className="py-2 text-center text-sm text-muted">{note}</div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <AutoTextarea
              value={draft}
              onChange={onDraft}
              label={c().composer(channelName)}
              placeholder={c().composer(channelName)}
              disabled={disabled}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
          </div>
          <button type="button" onClick={send} disabled={disabled || !draft.trim()} aria-label={c().send} title={c().send} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent text-white disabled:opacity-50">
            <Icon name="send" size={18} />
          </button>
        </div>
      )}
      {draft.length > MAX_MESSAGE - 200 && <p className="mt-1 text-right text-xs text-muted">{draft.length} / {MAX_MESSAGE}</p>}
    </div>
  );
}
