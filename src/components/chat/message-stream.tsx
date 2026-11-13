"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { dateLocale, t } from "@/i18n";
import { MAX_MESSAGE, groupReactions, mentionPattern, type ChatFile, type ChatMessage, type ChatPerson, type ChatReaction } from "@/lib/chat";
import { Icon, type IconName } from "@/components/ui/icon";
import { iconButtonClass } from "@/components/ui/button";
import { EmojiPicker } from "@/components/pages/emoji-picker";
import { Popover, MenuItem } from "@/components/ui/popover";
import { LinkCard, MessageFiles, PendingFiles, VoiceButton, compressImage, firstLink, uploadChatFile, type Pending } from "./chat-files";
import { levelsOf } from "./voice-player";
import { MessageChips, useHost } from "./chat-chips";

const c = () => t.chat;
// Messages of one author within this gap read as one group (one name, one avatar).
const GROUP_MS = 5 * 60_000;
const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

// Mentions inside a piece of plain text, as highlighted "@Name".
function withMentions(text: string, names: string[], key: string): ReactNode[] {
  for (const name of names) {
    const match = mentionPattern(name).exec(text);
    if (match) {
      const before = text.slice(0, match.index);
      const after = text.slice(match.index + match[0].length);
      return [
        ...withMentions(before, names, `${key}a`),
        <span key={`${key}m`} className="rounded bg-accent/15 px-0.5 font-medium text-accent">{match[0]}</span>,
        ...withMentions(after, names, `${key}b`),
      ];
    }
  }
  return text ? [<Fragment key={key}>{text}</Fragment>] : [];
}

// The first link of a message that leads off this site (own links become chips).
function outsideLink(body: string, host: string) {
  const link = firstLink(body);
  if (!link || !host) return null;
  try {
    return new URL(link).host === host ? null : link;
  } catch {
    return null;
  }
}

// Plain text with links (only http and https) and highlighted mentions.
function MessageText({ body, names }: { body: string; names: string[] }) {
  const parts = body.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent underline underline-offset-2">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{withMentions(part, names, String(i))}</Fragment>
        ),
      )}
    </>
  );
}

export function Avatar({ person, size = 32 }: { person: ChatPerson | undefined; size?: number }) {
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

export type MessageActions = {
  // Off in an archived channel or for someone only reading it.
  canWrite: boolean;
  canModerate: boolean;
  onEdit: (id: string, body: string) => Promise<boolean>;
  onDelete: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  // Absent inside a thread (replies have no threads of their own).
  onThread?: (id: string) => void;
  // A channel where chosen people publish: threads read as comments, offered under each post.
  comments?: boolean;
};

// The channel's stream (or a thread's replies): older pages on scrolling up, kept at
// the bottom while new messages arrive (unless the person scrolled up to read).
export function MessageStream({
  messages,
  people,
  me,
  reactions,
  actions,
  hasMore,
  loading,
  pendingIds,
  onLoadOlder,
  empty,
  header,
  highlight,
  files,
  shortId,
}: {
  messages: ChatMessage[];
  people: Map<string, ChatPerson>;
  me: string;
  reactions: Map<string, ChatReaction[]>;
  actions: MessageActions;
  hasMore: boolean;
  loading: boolean;
  pendingIds: Set<string>;
  onLoadOlder: () => void;
  empty: ReactNode;
  header?: ReactNode;
  highlight?: string | null;
  files: Map<string, ChatFile[]>;
  shortId: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const previousHeight = useRef(0);
  const firstId = messages[0]?.id;
  const lastId = messages[messages.length - 1]?.id;
  const [editing, setEditing] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const everyone = [...people.values()];
  const host = useHost();

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

  // A message asked for (a pin, the bell): into view.
  useEffect(() => {
    if (!highlight) return;
    scroller.current?.querySelector(`[data-chat-message="${highlight}"]`)?.scrollIntoView({ block: "center" });
  }, [highlight, messages.length]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    previousHeight.current = el.scrollHeight;
    if (el.scrollTop < 120 && hasMore && !loading) onLoadOlder();
  };

  const tool = (icon: IconName, label: string, onClick: (anchor: HTMLElement) => void, pressed?: boolean) => (
    <button type="button" onClick={(e) => onClick(e.currentTarget)} aria-label={label} title={label} aria-pressed={pressed} className={iconButtonClass("ghost")}>
      <Icon name={icon} size={15} />
    </button>
  );

  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-2 py-3 md:px-4" data-chat-stream role="log" aria-live="polite" aria-label={c().messages}>
      {header}
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
        const grouped =
          !newDay && prev && prev.author_id === m.author_id && !prev.deleted_at && !prev.reply_count && Date.parse(m.created_at) - Date.parse(prev.created_at) < GROUP_MS;
        const author = m.author_id ? people.get(m.author_id) : undefined;
        const mine = m.author_id === me;
        const pending = pendingIds.has(m.id);
        const toMe = m.mentions.includes(me) && !m.deleted_at;
        const names = m.mentions
          .map((id) => people.get(id)?.name)
          .filter((name): name is string => Boolean(name))
          .sort((a, b) => b.length - a.length);
        const signs = m.deleted_at ? [] : groupReactions(reactions.get(m.id) ?? []);
        const live = !m.deleted_at && !pending && editing !== m.id;
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
              className={`group relative flex gap-3 rounded-lg px-2 outline-none hover:bg-hover/60 focus-visible:bg-hover/60 ${grouped ? "py-0.5" : "mt-2 py-1"} ${
                pending ? "opacity-60" : ""
              } ${toMe ? "border-l-2 border-accent bg-accent/5" : ""} ${highlight === m.id ? "ring-2 ring-accent/50" : ""}`}
              data-chat-message={m.id}
              // A tap (no hover on a phone) shows the message's actions.
              tabIndex={live ? 0 : undefined}
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
                {m.pinned_at && !m.deleted_at && (
                  <p className="flex items-center gap-1 text-xs text-muted">
                    <Icon name="pin" size={12} />
                    {c().pinned}
                  </p>
                )}
                {m.deleted_at ? (
                  <p className="text-sm italic text-muted">{c().deleted}</p>
                ) : editing === m.id ? (
                  <EditBox
                    initial={m.body}
                    people={everyone}
                    onCancel={() => setEditing(null)}
                    onSave={async (body) => {
                      if (await actions.onEdit(m.id, body)) setEditing(null);
                    }}
                  />
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    <MessageText body={m.body} names={names} />
                    {m.edited_at && <span className="ml-1 text-xs text-muted">{c().edited}</span>}
                  </p>
                )}
                {!m.deleted_at && <MessageFiles files={files.get(m.id) ?? []} shortId={shortId} />}
                {!m.deleted_at && editing !== m.id && <MessageChips body={m.body} />}
                {!m.deleted_at && !m.file_count && editing !== m.id && outsideLink(m.body, host) && <LinkCard url={outsideLink(m.body, host)!} />}
                {pending && <p className="text-xs text-muted">{c().sending}</p>}
                {signs.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1" data-chat-reactions>
                    {signs.map((r) => {
                      const on = r.users.includes(me);
                      const who = r.users.map((id) => people.get(id)?.name ?? c().formerMember).join(", ");
                      return (
                        <button
                          key={r.emoji}
                          type="button"
                          disabled={!actions.canWrite}
                          onClick={() => actions.onReact(m.id, r.emoji)}
                          aria-pressed={on}
                          aria-label={c().reactionBy(r.emoji, who)}
                          title={who}
                          className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-2 text-sm md:min-h-6 ${on ? "border-accent/60 bg-accent/10" : "border-border hover:border-border-strong"}`}
                        >
                          <span>{r.emoji}</span>
                          <span className="text-xs text-muted">{r.users.length}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {(m.reply_count > 0 || actions.comments) && actions.onThread && !m.thread_root_id && !m.deleted_at && (
                  <button
                    type="button"
                    onClick={() => actions.onThread?.(m.id)}
                    className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-accent hover:underline md:min-h-6"
                    data-chat-replies
                  >
                    <Icon name="comment" size={13} />
                    {actions.comments ? c().publish.comments(m.reply_count) : c().replies(m.reply_count)}
                  </button>
                )}
              </div>
              {live && (actions.canWrite || mine || actions.canModerate) && (
                <div className="absolute -top-3 right-2 hidden gap-0.5 rounded-lg border border-border bg-overlay p-0.5 shadow-sm group-focus-within:flex group-hover:flex" data-chat-tools>
                  {actions.canWrite && tool("smile", c().react, (anchor) => setPicker({ id: m.id, anchor }))}
                  {actions.canWrite && actions.onThread && !m.thread_root_id && tool("comment", actions.comments ? c().publish.comment : c().replyInThread, () => actions.onThread?.(m.id))}
                  {actions.canWrite && tool("pin", m.pinned_at ? c().unpin : c().pin, () => actions.onPin(m.id, !m.pinned_at), Boolean(m.pinned_at))}
                  {mine && actions.canWrite && tool("edit", c().edit, () => setEditing(m.id))}
                  {(mine || actions.canModerate) && tool("trash", c().delete, () => actions.onDelete(m.id))}
                </div>
              )}
            </article>
          </Fragment>
        );
      })}
      {picker && (
        <EmojiPicker
          anchor={picker.anchor}
          current={null}
          title={c().react}
          onPick={(emoji) => {
            if (emoji) actions.onReact(picker.id, emoji);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function EditBox({ initial, people, onSave, onCancel }: { initial: string; people: ChatPerson[]; onSave: (body: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="mt-1">
      <MentionTextarea value={value} onChange={setValue} people={people} label={c().edit} onSubmit={() => value.trim() && onSave(value)} onEscape={onCancel} autoFocus />
      <p className="mt-1 text-xs text-muted">{c().editHint}</p>
    </div>
  );
}

// A growing text field with "@" suggestions of people: Enter sends (or picks the
// highlighted person), Shift+Enter starts a new line, Esc closes the list or cancels.
function MentionTextarea({
  value,
  onChange,
  people,
  label,
  placeholder,
  disabled,
  autoFocus,
  onSubmit,
  onEscape,
}: {
  value: string;
  onChange: (value: string) => void;
  people: ChatPerson[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onSubmit: () => void;
  onEscape?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  const suggestions = query === null ? [] : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  const readQuery = (text: string, caret: number) => {
    const match = /(^|\s)@([^\s@]{0,30})$/u.exec(text.slice(0, caret));
    setQuery(match ? match[2] : null);
    setIndex(0);
  };
  const pick = (person: ChatPerson) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([^\s@]{0,30})$/u, `@${person.name} `);
    onChange(before + value.slice(caret));
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        e.preventDefault();
        pick(suggestions[index] ?? suggestions[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setQuery(null);
        return;
      }
    }
    if (e.key === "Escape") onEscape?.();
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative">
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label={c().mentionList} className="absolute bottom-full left-0 z-20 mb-1 w-64 max-w-full rounded-lg border border-border bg-overlay p-1 shadow-lg" data-chat-mention-list>
          {suggestions.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === index}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm md:min-h-8 ${i === index ? "bg-hover" : "hover:bg-hover"}`}
              >
                <Avatar person={p} size={20} />
                <span className="flex-1 truncate">{p.name}</span>
                {p.guest && <span className="text-[10px] uppercase text-muted">{c().guest}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={ref}
        rows={1}
        value={value}
        maxLength={MAX_MESSAGE}
        onChange={(e) => {
          onChange(e.target.value);
          readQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setQuery(null)}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className="block max-h-60 min-h-11 w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:border-border-strong md:text-sm"
      />
    </div>
  );
}

// The field at the bottom: Enter sends, Shift+Enter starts a new line, "@" mentions
// someone. Files: a photo made smaller, a file as it is, or a voice message; they are
// uploaded at once and sent with the text. A draft per channel survives switching.
export function Composer({
  placeholder,
  people,
  disabled,
  note,
  onSend,
  draft,
  onDraft,
  upload,
  onSchedule,
}: {
  placeholder: string;
  people: ChatPerson[];
  disabled: boolean;
  note: ReactNode;
  onSend: (body: string, fileIds: string[]) => void;
  draft: string;
  onDraft: (value: string) => void;
  upload: { shortId: string; channelId: string } | null;
  // Send later (text only): answers whether it was planned.
  onSchedule?: (body: string, at: Date) => Promise<boolean>;
}) {
  const [items, setItems] = useState<Pending[]>([]);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [later, setLater] = useState<HTMLElement | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploading = items.some((p) => p.state === "uploading");
  const ready = items.filter((p) => p.state === "ready" && p.id).map((p) => p.id!);

  const add = async (
    name: string,
    kind: ChatFile["kind"],
    make: () => Promise<{ blob: Blob; name?: string; extra?: { duration?: number; width?: number; height?: number; levels?: number[] | null } }>,
    preview?: string,
  ) => {
    if (!upload) return;
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setItems((list) => [...list, { key, name, kind, state: "uploading", preview }]);
    try {
      const made = await make();
      const result = await uploadChatFile(upload.shortId, upload.channelId, made.blob, made.name ?? name, kind, made.extra);
      setItems((list) => list.map((p) => (p.key === key ? (result.ok ? { ...p, state: "ready", id: result.id } : { ...p, state: "error", error: result.error }) : p)));
    } catch {
      setItems((list) => list.map((p) => (p.key === key ? { ...p, state: "error", error: "upload_failed" } : p)));
    }
  };
  const pick = (files: FileList | null, compress: boolean) => {
    for (const file of Array.from(files ?? []).slice(0, 10)) {
      const image = file.type.startsWith("image/");
      if (compress && image && file.type !== "image/gif") {
        void add(file.name, "image", async () => {
          const small = await compressImage(file);
          return { blob: small.blob, name: small.name, extra: { width: small.width, height: small.height } };
        }, URL.createObjectURL(file));
      } else {
        void add(file.name, image ? "image" : "file", async () => ({ blob: file }), image ? URL.createObjectURL(file) : undefined);
      }
    }
  };
  const send = () => {
    const body = draft.trim();
    if ((!body && !ready.length) || disabled || uploading) return;
    onSend(body, ready);
    onDraft("");
    setItems([]);
  };
  return (
    <div className="shrink-0 border-t border-border px-2 py-2 md:px-4" data-chat-composer>
      {note ? (
        <div className="py-2 text-center text-sm text-muted">{note}</div>
      ) : (
        <>
          <PendingFiles items={items} onRemove={(key) => setItems((list) => list.filter((p) => p.key !== key))} />
          <div className="flex items-end gap-1">
            {upload && (
              <button type="button" onClick={(e) => setMenu(e.currentTarget)} disabled={disabled || items.length >= 10} aria-label={c().files.attach} title={c().files.attach} className={iconButtonClass("ghost")} data-chat-attach>
                <Icon name="paperclip" size={18} />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <MentionTextarea value={draft} onChange={onDraft} people={people} label={placeholder} placeholder={placeholder} disabled={disabled} onSubmit={send} />
            </div>
            {onSchedule && draft.trim() && !items.length && (
              <button type="button" onClick={(e) => setLater(e.currentTarget)} disabled={disabled} aria-label={c().later.title} title={c().later.title} className={iconButtonClass("ghost")} data-chat-later>
                <Icon name="clock" size={18} />
              </button>
            )}
            {upload && !draft.trim() && !ready.length ? (
              <VoiceButton
                disabled={disabled || items.length >= 10}
                onRecorded={(blob, duration) =>
                  void add(c().files.voiceName, "voice", async () => ({ blob, name: `voice.${blob.type.split("/")[1] ?? "webm"}`, extra: { duration, levels: await levelsOf(blob) } }))
                }
              />
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={disabled || uploading || (!draft.trim() && !ready.length)}
                aria-label={c().send}
                title={c().send}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent text-white disabled:opacity-50"
              >
                <Icon name="send" size={18} />
              </button>
            )}
          </div>
        </>
      )}
      {draft.length > MAX_MESSAGE - 200 && (
        <p className="mt-1 text-right text-xs text-muted">
          {draft.length} / {MAX_MESSAGE}
        </p>
      )}
      <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => { pick(e.target.files, true); e.target.value = ""; }} />
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { pick(e.target.files, false); e.target.value = ""; }} />
      {later && onSchedule && (
        <LaterMenu
          anchor={later}
          onClose={() => setLater(null)}
          onPick={async (at) => {
            setLater(null);
            const body = draft.trim();
            if (body && (await onSchedule(body, at))) onDraft("");
          }}
        />
      )}
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={260}>
          <MenuItem onSelect={() => { setMenu(null); photoInput.current?.click(); }}>
            <Icon name="image" size={16} />
            <span>
              {c().files.photo}
              <span className="block text-xs text-muted">{c().files.photoHint}</span>
            </span>
          </MenuItem>
          <MenuItem onSelect={() => { setMenu(null); fileInput.current?.click(); }}>
            <Icon name="file" size={16} />
            <span>
              {c().files.asFile}
              <span className="block text-xs text-muted">{c().files.asFileHint}</span>
            </span>
          </MenuItem>
        </Popover>
      )}
    </div>
  );
}

// When to send: in an hour, tomorrow at 9, Monday at 9, or a chosen moment.
function LaterMenu({ anchor, onClose, onPick }: { anchor: HTMLElement; onClose: () => void; onPick: (at: Date) => void }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // The choices as of opening the menu.
  const [choice] = useState(() => {
    const now = new Date();
    const at = (days: number, hour: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() + days);
      d.setHours(hour, 0, 0, 0);
      return d;
    };
    return { inHour: new Date(now.getTime() + 60 * 60_000), tomorrow: at(1, 9), monday: at((8 - now.getDay()) % 7 || 7, 9), min: local(now) };
  });
  const [custom, setCustom] = useState(() => local(choice.tomorrow));
  const label = (d: Date) => d.toLocaleString(dateLocale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Popover anchor={anchor} onClose={onClose} width={280}>
      <p className="px-3 pt-1 text-xs font-medium text-muted">{c().later.title}</p>
      {[
        [c().later.inHour, choice.inHour],
        [c().later.tomorrow, choice.tomorrow],
        [c().later.monday, choice.monday],
      ].map(([text, date]) => (
        <MenuItem key={String(text)} onSelect={() => onPick(date as Date)}>
          <span className="flex-1">{text as string}</span>
          <span className="text-xs text-muted">{label(date as Date)}</span>
        </MenuItem>
      ))}
      <form
        className="flex gap-2 border-t border-border p-2"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new Date(custom);
          if (!Number.isNaN(d.getTime())) onPick(d);
        }}
      >
        <input type="datetime-local" value={custom} min={choice.min} onChange={(e) => setCustom(e.target.value)} aria-label={c().later.custom} className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm md:min-h-8" />
        <button type="submit" className="min-h-11 rounded-md bg-accent px-3 text-sm text-white md:min-h-8">{c().later.set}</button>
      </form>
    </Popover>
  );
}
