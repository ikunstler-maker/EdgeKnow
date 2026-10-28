"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { dateLocale, t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import {
  mentionsIn,
  type CommentItem,
  type CommentThread,
  type MarkRange,
  type MentionPerson,
  type PeopleNames,
} from "@/lib/comments";
import {
  createMarkedThread,
  createThread,
  deleteComment,
  editComment,
  getMentionCandidates,
  replyToThread,
  setThreadResolved,
} from "@/app/comment-actions";
import type { schema } from "./schema";

type Editor = typeof schema.BlockNoteEditor;
type Draft = { from: number; to: number; quoted: string };

const c = t.comments;
const dateFormat = () => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "short", timeStyle: "short" });
const buttonClass =
  "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-8";
const primaryClass =
  "min-h-11 rounded-md bg-accent px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 md:min-h-8";

const threadSelector = (id: string) => `[data-comment-thread="${CSS.escape(id)}"]`;

// The wide layout has a comment column next to the text; narrower screens use a sheet.
const WIDE = "(min-width: 1280px)";
export function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

// --- Selection and marks -------------------------------------------------------

// The selected text in editor positions. Read-only views take the browser's selection.
function selectionOf(editor: Editor): Draft | null {
  const view = editor.prosemirrorView;
  if (!view) return null;
  let { from, to } = view.state.selection;
  if (!editor.isEditable) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!view.dom.contains(range.commonAncestorContainer)) return null;
    from = view.posAtDOM(range.startContainer, range.startOffset);
    to = view.posAtDOM(range.endContainer, range.endOffset);
  }
  if (from >= to) return null;
  const quoted = view.state.doc.textBetween(from, to, " ", (node) => (node.type.name === "hardBreak" ? "\n" : "")).trim();
  return quoted ? { from, to, quoted } : null;
}

function addCommentMark(editor: Editor, draft: Draft, threadId: string) {
  const view = editor.prosemirrorView;
  if (!view) return;
  const type = view.state.schema.marks.comment;
  view.dispatch(view.state.tr.addMark(draft.from, draft.to, type.create({ stringValue: threadId })));
}

// The same fragment as ranges of block text, for the server to mark (commenters).
// Positions are counted in code points, as the database does. Tables and code
// can't carry the mark this way: null if the selection lies only there.
function rangesOf(editor: Editor, draft: Draft): MarkRange[] | null {
  const view = editor.prosemirrorView;
  if (!view) return null;
  const doc = view.state.doc;
  const leaf = (node: { type: { name: string } }) => (node.type.name === "hardBreak" ? "\n" : "");
  const ranges: MarkRange[] = [];
  doc.nodesBetween(draft.from, draft.to, (node, pos, parent) => {
    if (!node.isTextblock) return true;
    const container = parent?.type.name === "blockContainer" ? parent : null;
    if (!container || node.type.name === "codeBlock") return false;
    const start = pos + 1;
    const s = Math.max(draft.from, start);
    const e = Math.min(draft.to, start + node.content.size);
    const text = doc.textBetween(s, e, "", leaf);
    if (text) {
      const before = Array.from(doc.textBetween(start, s, "", leaf)).length;
      ranges.push({ block: String(container.attrs.id), start: before, end: before + Array.from(text).length, text });
    }
    return false;
  });
  return ranges.length ? ranges : null;
}

// --- State shared by the column, the sheet and the editor ------------------------

export type CommentsProps = {
  editor: Editor;
  pageId: string;
  threads: CommentThread[];
  people: PeopleNames;
  userId: string;
  canComment: boolean;
  initialVersion: number;
};

export function useComments({ editor, pageId, threads, canComment, initialVersion }: CommentsProps) {
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Commenters' marks bump the page version; their next comment must name the new one.
  const version = useRef(initialVersion);

  // A link from "Вас згадали" (?thread=<id>) opens that thread.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("thread");
    if (!id) return;
    requestAnimationFrame(() => {
      setActive(id);
      document.querySelector(threadSelector(id))?.scrollIntoView({ block: "center" });
    });
  }, []);

  const start = useCallback(() => {
    const selection = selectionOf(editor);
    if (!selection) return;
    setError(null);
    setActive(null);
    setDraft(selection);
  }, [editor]);

  const submit = async (body: string, mentions: string[]): Promise<boolean> => {
    if (!draft) return false;
    let result: ActionResult<{ id: string; version?: number }>;
    if (editor.isEditable) {
      // Editors mark the text themselves; autosave stores the document.
      result = await createThread(pageId, draft.quoted, body, mentions);
    } else {
      const ranges = rangesOf(editor, draft);
      if (!ranges) {
        setError(c.errors.unsupported);
        return false;
      }
      result = await createMarkedThread(pageId, version.current, ranges, body, mentions);
      if (result.ok && result.version) version.current = result.version;
    }
    if (!result.ok) {
      setError(c.errors[result.error] ?? t.common.unknownError);
      return false;
    }
    addCommentMark(editor, draft, result.id);
    setDraft(null);
    setActive(result.id);
    return true;
  };

  const visible = threads.filter((th) => th.status !== "resolved");
  const archived = threads.filter((th) => th.status === "resolved");

  return {
    active,
    setActive,
    draft,
    cancelDraft: () => setDraft(null),
    start,
    submit,
    error,
    clearError: () => setError(null),
    visible,
    archived,
    canComment,
  };
}

export type CommentsController = ReturnType<typeof useComments>;

// Open threads get the yellow highlight; the active one a stronger one.
export function CommentHighlights({ threads, active }: { threads: CommentThread[]; active: string | null }) {
  const css = threads
    .filter((th) => th.status === "open")
    .map(
      (th) =>
        `.ek-editor ${threadSelector(th.id)}{background:var(${th.id === active ? "--comment-active" : "--comment"});cursor:pointer}`,
    )
    .join("\n");
  return <style>{css}</style>;
}

// --- Mentions --------------------------------------------------------------------

function useMentionPeople(pageId: string, enabled: boolean) {
  const [people, setPeople] = useState<MentionPerson[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void getMentionCandidates(pageId).then((list) => alive && setPeople(list));
    return () => {
      alive = false;
    };
  }, [pageId, enabled]);
  return people;
}

// A text field where "@" suggests people who can see the page.
function MentionTextarea({
  value,
  onChange,
  onSubmit,
  people,
  picked,
  onPick,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  people: MentionPerson[];
  picked: MentionPerson[];
  onPick: (person: MentionPerson) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const matches = query
    ? people
        .filter((p) => p.label.toLowerCase().includes(query.text.toLowerCase()))
        .filter((p) => !picked.some((x) => x.userId === p.userId) || !value.includes(`@${p.label}`))
        .slice(0, 6)
    : [];

  const updateQuery = (text: string, caret: number) => {
    const match = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
    setQuery(match ? { start: caret - match[2].length - 1, text: match[2] } : null);
    setHighlight(0);
  };

  const choose = (person: MentionPerson) => {
    if (!query) return;
    const caret = field.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, query.start)}@${person.label} ${value.slice(caret)}`;
    onChange(next);
    onPick(person);
    setQuery(null);
    requestAnimationFrame(() => {
      const position = query.start + person.label.length + 2;
      field.current?.focus();
      field.current?.setSelectionRange(position, position);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={field}
        value={value}
        rows={2}
        maxLength={5000}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          updateQuery(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={(event) => {
          // The editor must not react to keys typed here.
          event.stopPropagation();
          if (matches.length) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((h) => (h + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              choose(matches[highlight]);
              return;
            }
            if (event.key === "Escape") {
              setQuery(null);
              return;
            }
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-base md:text-sm"
      />
      {matches.length > 0 && (
        <ul role="listbox" aria-label={c.mentionList} className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-border bg-background py-1 shadow-lg">
          {matches.map((person, i) => (
            <li key={person.userId} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(person)}
                className={`flex min-h-11 w-full items-center px-3 text-left text-sm md:min-h-8 ${i === highlight ? "bg-surface" : ""}`}
              >
                @{person.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Composer({
  pageId,
  placeholder,
  submitLabel,
  initial = "",
  onSubmit,
  onCancel,
  autoFocus,
}: {
  pageId: string;
  placeholder: string;
  submitLabel: string;
  initial?: string;
  onSubmit: (body: string, mentions: string[]) => Promise<boolean>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const people = useMentionPeople(pageId, true);
  const [value, setValue] = useState(initial);
  const [picked, setPicked] = useState<MentionPerson[]>([]);
  const [pending, startTransition] = useTransition();

  const send = () => {
    const body = value.trim();
    if (!body || pending) return;
    startTransition(async () => {
      if (await onSubmit(body, mentionsIn(body, picked))) {
        setValue("");
        setPicked([]);
      }
    });
  };

  return (
    <div className="space-y-2">
      <MentionTextarea
        value={value}
        onChange={setValue}
        onSubmit={send}
        people={people}
        picked={picked}
        onPick={(person) => setPicked((list) => [...list, person])}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className={buttonClass}>
            {t.common.cancel}
          </button>
        )}
        <button type="button" onClick={send} disabled={!value.trim() || pending} className={primaryClass}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

// --- Cards -----------------------------------------------------------------------

// Plain text; "@Name" of the people actually mentioned is emphasised.
function CommentBody({ comment, people }: { comment: CommentItem; people: PeopleNames }) {
  const labels = comment.mentions.map((id) => people[id]).filter(Boolean).map((name) => `@${name}`);
  if (!labels.length) return <p className="whitespace-pre-wrap break-words">{comment.body}</p>;
  const pattern = new RegExp(`(${labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return (
    <p className="whitespace-pre-wrap break-words">
      {comment.body.split(pattern).map((part, i) =>
        labels.includes(part) ? (
          <span key={i} className="rounded bg-accent/15 px-0.5 text-accent">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

function CommentRow({
  comment,
  people,
  userId,
  pageId,
  canComment,
}: {
  comment: CommentItem;
  people: PeopleNames;
  userId: string;
  pageId: string;
  canComment: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const own = comment.authorId === userId;
  const author = (comment.authorId && people[comment.authorId]) || c.formerMember;

  return (
    <li className="space-y-1 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{author}</span>
        <time className="shrink-0 text-xs text-muted" dateTime={comment.createdAt}>
          {dateFormat().format(new Date(comment.createdAt))}
        </time>
      </div>
      {editing ? (
        <Composer
          pageId={pageId}
          initial={comment.body}
          placeholder={c.editPlaceholder}
          submitLabel={t.common.save}
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={async (body, mentions) => {
            const result = await editComment(comment.id, body, [...new Set([...comment.mentions, ...mentions])].filter((id) => people[id] && body.includes(`@${people[id]}`)));
            if (result.ok) setEditing(false);
            return result.ok;
          }}
        />
      ) : (
        <>
          <CommentBody comment={comment} people={people} />
          {comment.editedAt && <span className="text-xs text-muted">{c.edited}</span>}
        </>
      )}
      {own && canComment && !editing && (
        <div className="flex gap-3 text-xs text-muted">
          <button type="button" className="min-h-8 hover:text-foreground" onClick={() => setEditing(true)}>
            {c.edit}
          </button>
          <button
            type="button"
            disabled={pending}
            className="min-h-8 hover:text-danger"
            onClick={() => {
              if (confirm(c.confirmDelete)) startTransition(async () => void (await deleteComment(comment.id)));
            }}
          >
            {c.delete}
          </button>
        </div>
      )}
    </li>
  );
}

export function ThreadCard({
  thread,
  active,
  onActivate,
  pageId,
  people,
  userId,
  canComment,
}: {
  thread: CommentThread;
  active: boolean;
  onActivate: () => void;
  pageId: string;
  people: PeopleNames;
  userId: string;
  canComment: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const resolved = thread.status === "resolved";

  return (
    <article
      aria-label={c.threadLabel(thread.quotedText)}
      data-thread-card={thread.id}
      onClick={onActivate}
      className={`space-y-3 rounded-lg border bg-background p-3 shadow-sm ${active ? "border-accent" : "border-border"}`}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 border-l-2 border-[var(--comment-active)] pl-2 text-xs text-muted">
          {thread.status === "orphaned" && <span className="mb-0.5 block font-medium text-danger">{c.orphaned}</span>}
          <span className="line-clamp-2">{thread.quotedText}</span>
        </p>
        {canComment && (
          <button
            type="button"
            disabled={pending}
            onClick={(event) => {
              event.stopPropagation();
              startTransition(async () => void (await setThreadResolved(thread.id, !resolved)));
            }}
            className={buttonClass}
          >
            {resolved ? c.reopen : c.resolve}
          </button>
        )}
      </div>
      <ul className="space-y-3">
        {thread.comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            people={people}
            userId={userId}
            pageId={pageId}
            canComment={canComment}
          />
        ))}
      </ul>
      {canComment && !resolved && active && (
        <Composer
          pageId={pageId}
          placeholder={c.replyPlaceholder}
          submitLabel={c.reply}
          onSubmit={async (body, mentions) => (await replyToThread(thread.id, body, mentions)).ok}
        />
      )}
    </article>
  );
}

function DraftCard({ controller, pageId }: { controller: CommentsController; pageId: string }) {
  if (!controller.draft) return null;
  return (
    <div className="space-y-2 rounded-lg border border-accent bg-background p-3 shadow-sm">
      <p className="line-clamp-2 border-l-2 border-[var(--comment-active)] pl-2 text-xs text-muted">{controller.draft.quoted}</p>
      {controller.error && (
        <p role="alert" className="text-sm text-danger">
          {controller.error}
        </p>
      )}
      <Composer
        pageId={pageId}
        placeholder={c.placeholder}
        submitLabel={c.submit}
        autoFocus
        onCancel={controller.cancelDraft}
        onSubmit={controller.submit}
      />
    </div>
  );
}

// --- Containers ------------------------------------------------------------------

// Wide screens: cards in a column, each next to its fragment, pushed down so they
// don't overlap. Threads whose fragment was deleted come after the rest.
export function CommentsColumn({
  controller,
  props,
  layoutKey,
}: {
  controller: CommentsController;
  props: CommentsProps;
  layoutKey: number;
}) {
  const column = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const [layout, setLayout] = useState<{ tops: Record<string, number>; height: number }>({ tops: {}, height: 0 });
  const { tops } = layout;
  const [, forceLayout] = useState(0);
  const { draft, visible, active } = controller;

  const items = useMemo(() => {
    const list: { key: string; node: ReactNode }[] = [];
    if (draft) list.push({ key: "draft", node: <DraftCard controller={controller} pageId={props.pageId} /> });
    for (const thread of visible) {
      list.push({
        key: thread.id,
        node: (
          <ThreadCard
            thread={thread}
            active={active === thread.id}
            onActivate={() => controller.setActive(thread.id)}
            pageId={props.pageId}
            people={props.people}
            userId={props.userId}
            canComment={props.canComment}
          />
        ),
      });
    }
    return list;
  }, [draft, visible, active, controller, props]);

  useLayoutEffect(() => {
    const root = column.current;
    const view = props.editor.prosemirrorView;
    if (!root || !view) return;
    const base = root.getBoundingClientRect().top;
    const anchorOf = (key: string) => {
      if (key === "draft" && draft) return view.coordsAtPos(draft.from).top - base;
      const el = document.querySelector(threadSelector(key));
      return el ? el.getBoundingClientRect().top - base : Number.POSITIVE_INFINITY;
    };
    const ordered = items
      .map((item) => ({ key: item.key, anchor: anchorOf(item.key) }))
      .sort((a, b) => a.anchor - b.anchor);
    const next: Record<string, number> = {};
    let bottom = 0;
    for (const { key, anchor } of ordered) {
      const top = Math.max(Number.isFinite(anchor) ? anchor : bottom, bottom);
      next[key] = top;
      bottom = top + (cards.current.get(key)?.offsetHeight ?? 120) + 8;
    }
    const fresh = { tops: next, height: bottom };
    setLayout((old) => (JSON.stringify(old) === JSON.stringify(fresh) ? old : fresh));
  }, [items, draft, layoutKey, props.editor]);

  useEffect(() => {
    const onResize = () => forceLayout((n) => n + 1);
    window.addEventListener("resize", onResize);
    const observer = new ResizeObserver(onResize);
    cards.current.forEach((el) => observer.observe(el));
    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, [items]);

  return (
    <div ref={column} aria-label={c.column} className="relative" style={{ minHeight: layout.height }}>
      {items.map((item) => (
        <div
          key={item.key}
          ref={(el) => {
            if (el) cards.current.set(item.key, el);
            else cards.current.delete(item.key);
          }}
          className="absolute inset-x-0 transition-[top] duration-150"
          style={{ top: tops[item.key] ?? 0 }}
        >
          {item.node}
        </div>
      ))}
    </div>
  );
}

// Narrow screens (and the archive everywhere): a bottom sheet with the thread list.
export function CommentsSheet({
  title,
  threads,
  controller,
  props,
  onClose,
  showDraft,
}: {
  title: string;
  threads: CommentThread[];
  controller: CommentsController;
  props: CommentsProps;
  onClose: () => void;
  showDraft?: boolean;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Opened from a highlight: bring that thread into view.
  useEffect(() => {
    if (!controller.active) return;
    document.querySelector(`[data-thread-card="${CSS.escape(controller.active)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [controller.active]);

  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[80vh] max-w-2xl flex-col rounded-t-xl bg-background shadow-xl sm:bottom-auto sm:top-[10vh] sm:rounded-xl"
      >
        <div className="flex items-center border-b border-border px-4 py-2">
          <p className="flex-1 font-semibold">{title}</p>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="min-h-11 min-w-11">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {showDraft && <DraftCard controller={controller} pageId={props.pageId} />}
          {threads.length === 0 && !(showDraft && controller.draft) && <p className="text-sm text-muted">{c.empty}</p>}
          {threads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              active={controller.active === thread.id}
              onActivate={() => controller.setActive(thread.id)}
              pageId={props.pageId}
              people={props.people}
              userId={props.userId}
              canComment={props.canComment}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
