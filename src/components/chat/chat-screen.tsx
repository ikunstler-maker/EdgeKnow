"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import {
  MESSAGE_PAGE,
  channelTitle,
  mentionsIn,
  mergeMessages,
  type ChatCategory,
  type ChatChannel,
  type ChatFile,
  type ChatLive,
  type ChatMessage,
  type ChatPerson,
  type ChatReaction,
} from "@/lib/chat";
import {
  deleteMessage,
  editMessage,
  joinChannel,
  loadChat,
  loadFiles,
  loadMessages,
  loadMessagesById,
  loadPinned,
  loadReactions,
  loadThread,
  markRead,
  pinMessage,
  postMessage,
  toggleReaction,
} from "@/app/chat-actions";
import { Icon } from "@/components/ui/icon";
import { iconButtonClass } from "@/components/ui/button";
import { ChannelList, channelIcon } from "./channel-list";
import { Composer, MessageStream, type MessageActions } from "./message-stream";
import { MembersPanel } from "./members-panel";
import { PinsPanel, ThreadPanel } from "./side-panels";
import { BrowseDialog, CategoriesDialog, ChannelSettingsDialog, CreateChannelDialog, NewDirectDialog } from "./chat-dialogs";
import { useChatLive, type ChatSignal } from "./use-chat-live";

const c = () => t.chat;
const POLL_MS = 5_000;
const LIST_POLL_MS = 20_000;
const LIST_SAFETY_MS = 60_000;

export type ChatScreenProps = {
  shortId: string;
  workspaceId: string;
  me: string;
  guest: boolean;
  admin: boolean;
  canCreateOpen: boolean;
  canCreateClosed: boolean;
  live: ChatLive;
  people: ChatPerson[];
  units: { id: string; name: string }[];
  initialChannels: ChatChannel[];
  initialCategories: ChatCategory[];
  initialChannel: string | null;
  // From the bell: a thread to open, a message to show.
  initialThread: string | null;
  initialMessage: string | null;
  failed: boolean;
};

type Dialog = "create" | "direct" | "settings" | "browse" | "categories" | null;
type Panel = { kind: "members" } | { kind: "pins" } | { kind: "thread"; id: string } | null;
type Stream = { messages: ChatMessage[]; hasMore: boolean; loaded: boolean };

const errorText = (code: string) => (c().errors as Record<string, string>)[code] ?? c().errors.unknown;
const temporary = (): string => `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// Toker: channels on the left, the chosen channel's stream in the middle, a thread,
// the pins or the people on the right. The database decides everything; this keeps
// the screen in step.
export function ChatScreen(props: ChatScreenProps) {
  const { shortId, workspaceId, me, admin, live } = props;
  const [channels, setChannels] = useState(props.initialChannels);
  const [categories, setCategories] = useState(props.initialCategories);
  const firstJoined = props.initialChannels.find((ch) => ch.joined && !ch.archived_at)?.id ?? null;
  const [activeId, setActiveId] = useState<string | null>(
    props.initialChannel && props.initialChannels.some((ch) => ch.id === props.initialChannel) ? props.initialChannel : firstJoined,
  );
  // On a phone: the list or the stream (the stream once a channel is picked).
  const [showList, setShowList] = useState(!props.initialChannel);
  const [streams, setStreams] = useState<Record<string, Stream>>({});
  const [threads, setThreads] = useState<Record<string, ChatMessage[] | null>>({});
  const [reactionRows, setReactionRows] = useState<Record<string, ChatReaction[]>>({});
  const [fileRows, setFileRows] = useState<Record<string, ChatFile[]>>({});
  const [pins, setPins] = useState<ChatMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<Dialog>(null);
  const [panel, setPanel] = useState<Panel>(props.initialThread ? { kind: "thread", id: props.initialThread } : null);
  const [highlight, setHighlight] = useState<string | null>(props.initialMessage);
  const [error, setError] = useState<string | null>(props.failed ? c().errors.load : null);

  const people = useMemo(() => new Map(props.people.map((p) => [p.id, p])), [props.people]);
  const reactions = useMemo(() => new Map(Object.entries(reactionRows)), [reactionRows]);
  const files = useMemo(() => new Map(Object.entries(fileRows)), [fileRows]);
  const active = channels.find((ch) => ch.id === activeId) ?? null;
  const stream = activeId ? streams[activeId] : undefined;
  const canManage = Boolean(active && (admin || active.role === "owner"));
  const canWrite = Boolean(active && !active.archived_at);
  const threadId = panel?.kind === "thread" ? panel.id : null;
  const titleOf = (ch: ChatChannel) => channelTitle(ch, people, me, c().direct.alone, c().formerMember);
  const activeTitle = active ? titleOf(active) : "";

  // ---------------------------------------------------------------- reading

  // Files of messages that have them (once per message; they don't change).
  const known = useRef(new Set<string>());
  const fetchFiles = useCallback(
    async (messages: ChatMessage[]) => {
      const wanted = messages.filter((m) => m.file_count > 0 && !m.deleted_at && !known.current.has(m.id)).map((m) => m.id);
      if (!wanted.length) return;
      wanted.forEach((id) => known.current.add(id));
      const rows = await loadFiles(shortId, wanted);
      setFileRows((all) => {
        const next = { ...all };
        for (const id of wanted) next[id] = rows.filter((f) => f.message_id === id);
        return next;
      });
    },
    [shortId],
  );

  const fetchReactions = useCallback(
    async (ids: string[]) => {
      const wanted = ids.filter((id) => !id.startsWith("pending-"));
      if (!wanted.length) return;
      const rows = await loadReactions(shortId, wanted);
      setReactionRows((all) => {
        const next = { ...all };
        for (const id of wanted) next[id] = rows.filter((r) => r.message_id === id);
        return next;
      });
    },
    [shortId],
  );

  const putMessages = useCallback((channelId: string, rows: ChatMessage[]) => {
    void fetchFiles(rows);
    const top = rows.filter((m) => !m.thread_root_id);
    const replies = rows.filter((m) => m.thread_root_id);
    if (top.length)
      setStreams((all) => {
        const current = all[channelId];
        return current ? { ...all, [channelId]: { ...current, messages: mergeMessages(current.messages, top) } } : all;
      });
    if (replies.length)
      setThreads((all) => {
        const next = { ...all };
        for (const r of replies) if (next[r.thread_root_id!]) next[r.thread_root_id!] = mergeMessages(next[r.thread_root_id!] ?? [], [r]);
        return next;
      });
  }, [fetchFiles]);

  const refreshList = useCallback(async () => {
    const fresh = await loadChat(shortId, workspaceId);
    if (!fresh) return;
    setChannels(fresh.channels);
    setCategories(fresh.categories);
  }, [shortId, workspaceId]);

  const loadLatest = useCallback(
    async (channelId: string) => {
      const page = await loadMessages(shortId, channelId, null);
      if (!page) return;
      setStreams((all) => {
        const current = all[channelId];
        return {
          ...all,
          [channelId]: {
            messages: mergeMessages(current?.messages ?? [], page),
            hasMore: current?.loaded ? current.hasMore : page.length === MESSAGE_PAGE,
            loaded: true,
          },
        };
      });
      void fetchReactions(page.map((m) => m.id));
      void fetchFiles(page);
    },
    [shortId, fetchReactions, fetchFiles],
  );

  const loadOlder = useCallback(async () => {
    if (!activeId || loading) return;
    const oldest = streams[activeId]?.messages[0];
    if (!oldest) return;
    setLoading(true);
    const page = await loadMessages(shortId, activeId, oldest.created_at);
    setLoading(false);
    if (!page) return;
    setStreams((all) => ({
      ...all,
      [activeId]: { messages: mergeMessages(all[activeId]?.messages ?? [], page), hasMore: page.length === MESSAGE_PAGE, loaded: true },
    }));
    void fetchReactions(page.map((m) => m.id));
    void fetchFiles(page);
  }, [activeId, loading, streams, shortId, fetchReactions, fetchFiles]);

  const reloadThread = useCallback(
    async (rootId: string) => {
      const replies = await loadThread(shortId, rootId);
      setThreads((all) => ({ ...all, [rootId]: replies ?? [] }));
      if (replies) {
        void fetchReactions(replies.map((m) => m.id));
        void fetchFiles(replies);
      }
    },
    [shortId, fetchReactions, fetchFiles],
  );

  const reloadPins = useCallback(async () => {
    if (!activeId) return;
    setPins(await loadPinned(shortId, activeId));
  }, [shortId, activeId]);

  // The chosen channel: its messages, and the address shows it (no page reload).
  useEffect(() => {
    if (!activeId) return;
    // The messages arrive later (an await); nothing is set synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!streams[activeId]?.loaded) void loadLatest(activeId);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("c", activeId);
      url.searchParams.delete("m");
      if (threadId) url.searchParams.set("t", threadId);
      else url.searchParams.delete("t");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // The address just doesn't follow.
    }
    // Loading once per channel (or thread) switch is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, threadId]);

  // The open thread: its replies (and its top message, which may be older than the page).
  useEffect(() => {
    if (!threadId || !activeId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadThread(threadId);
    if (!streams[activeId]?.messages.some((m) => m.id === threadId))
      void loadMessagesById(shortId, [threadId]).then((rows) => {
        const root = rows.find((m) => m.channel_id === activeId);
        if (root) setStreams((all) => ({ ...all, [activeId]: { ...(all[activeId] ?? { hasMore: true, loaded: false }), messages: mergeMessages(all[activeId]?.messages ?? [], [root]) } }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, activeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (panel?.kind === "pins") void reloadPins();
  }, [panel?.kind, reloadPins]);

  // Read: whatever the person has open in a visible tab.
  const lastMarked = useRef<string | null>(null);
  const newest = stream?.messages[stream.messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (!active || !active.joined || !newest || document.visibilityState !== "visible") return;
    const key = `${active.id}:${newest}`;
    if (lastMarked.current === key) return;
    lastMarked.current = key;
    const timer = setTimeout(() => {
      void markRead(shortId, active.id);
      setChannels((list) => list.map((ch) => (ch.id === active.id ? { ...ch, unread: 0, mentioned: false } : ch)));
    }, 800);
    return () => clearTimeout(timer);
  }, [active, newest, shortId]);

  // ---------------------------------------------------------------- live

  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshListSoon = useCallback(() => {
    if (listTimer.current) clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => void refreshList(), 400);
  }, [refreshList]);

  const onSignal = useCallback(
    (signal: ChatSignal) => {
      if (signal.kind === "message") {
        if (signal.channelId !== activeId) return refreshListSoon();
        const wanted = signal.threadRootId ? [signal.id, signal.threadRootId] : [signal.id];
        void loadMessagesById(shortId, wanted).then((rows) => putMessages(signal.channelId, rows));
        if (signal.threadRootId && signal.threadRootId === threadId) void reloadThread(threadId);
        if (panel?.kind === "pins") void reloadPins();
      } else if (signal.kind === "reaction") {
        if (signal.channelId === activeId) void fetchReactions([signal.messageId]);
      } else {
        refreshListSoon();
      }
    },
    [activeId, threadId, panel?.kind, shortId, putMessages, reloadThread, reloadPins, fetchReactions, refreshListSoon],
  );

  const joinedIds = useMemo(() => channels.filter((ch) => ch.joined && !ch.archived_at).map((ch) => ch.id), [channels]);
  const listened = useMemo(() => (activeId && !joinedIds.includes(activeId) ? [...joinedIds, activeId] : joinedIds), [joinedIds, activeId]);
  const { connected } = useChatLive(live, me, listened, onSignal);

  // Polling: always for the list now and then; for the open channel (and thread) while no live signals.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshList();
    }, connected ? LIST_SAFETY_MS : LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [connected, refreshList]);
  useEffect(() => {
    if (connected || !activeId) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadLatest(activeId);
      if (threadId) void reloadThread(threadId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [connected, activeId, threadId, loadLatest, reloadThread]);
  // Back to the tab: catch up at once.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshList();
      if (activeId) void loadLatest(activeId);
      if (threadId) void reloadThread(threadId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [activeId, threadId, refreshList, loadLatest, reloadThread]);

  // ---------------------------------------------------------------- writing

  const send = async (body: string, fileIds: string[], rootId: string | null = null) => {
    if (!active) return;
    const channelId = active.id;
    const temp = temporary();
    const optimistic: ChatMessage = {
      id: temp,
      channel_id: channelId,
      author_id: me,
      thread_root_id: rootId,
      body,
      mentions: [],
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      pinned_at: null,
      reply_count: 0,
      last_reply_at: null,
      file_count: 0,
    };
    setPending((set) => new Set(set).add(temp));
    if (rootId) setThreads((all) => ({ ...all, [rootId]: [...(all[rootId] ?? []), optimistic] }));
    else setStreams((all) => ({ ...all, [channelId]: { ...(all[channelId] ?? { hasMore: false, loaded: true }), messages: [...(all[channelId]?.messages ?? []), optimistic] } }));
    const result = await postMessage(shortId, channelId, body, rootId, mentionsIn(body, props.people), fileIds);
    const rows = result.ok ? await loadMessagesById(shortId, rootId ? [result.id, rootId] : [result.id]) : [];
    setPending((set) => {
      const next = new Set(set);
      next.delete(temp);
      return next;
    });
    if (rootId) setThreads((all) => ({ ...all, [rootId]: (all[rootId] ?? []).filter((m) => m.id !== temp) }));
    else
      setStreams((all) => {
        const current = all[channelId];
        return current ? { ...all, [channelId]: { ...current, messages: current.messages.filter((m) => m.id !== temp) } } : all;
      });
    putMessages(channelId, rows);
    if (!result.ok) {
      setError(errorText(result.error));
      if (!rootId) setDrafts((d) => ({ ...d, [channelId]: d[channelId] || body }));
    }
  };

  const reloadOne = async (id: string) => {
    if (!activeId) return;
    putMessages(activeId, await loadMessagesById(shortId, [id]));
  };

  const actions: MessageActions = {
    canWrite,
    canModerate: canManage,
    onEdit: async (id, body) => {
      const result = await editMessage(shortId, id, body, mentionsIn(body, props.people));
      if (!result.ok) {
        setError(errorText(result.error));
        return false;
      }
      await reloadOne(id);
      return true;
    },
    onDelete: async (id) => {
      if (!window.confirm(c().deleteConfirm)) return;
      const result = await deleteMessage(shortId, id);
      if (!result.ok) return setError(errorText(result.error));
      const root = [...Object.values(threads)].flat().find((m) => m?.id === id)?.thread_root_id;
      if (activeId) putMessages(activeId, await loadMessagesById(shortId, root ? [id, root] : [id]));
      void fetchReactions([id]);
    },
    onReact: async (id, emoji) => {
      const result = await toggleReaction(shortId, id, emoji);
      if (!result.ok) return setError(errorText(result.error));
      void fetchReactions([id]);
    },
    onPin: async (id, pinned) => {
      const result = await pinMessage(shortId, id, pinned);
      if (!result.ok) return setError(errorText(result.error));
      await reloadOne(id);
      if (panel?.kind === "pins") void reloadPins();
    },
    onThread: (id) => setPanel({ kind: "thread", id }),
    comments: active?.post_policy === "chosen",
  };

  const join = async () => {
    if (!active) return;
    const result = await joinChannel(shortId, active.id);
    if (!result.ok) return setError(errorText(result.error));
    await refreshList();
  };

  const select = (id: string) => {
    setActiveId(id);
    setShowList(false);
    setPanel(null);
    setPins(null);
    setHighlight(null);
  };

  // ---------------------------------------------------------------- layout

  // Replies in threads are open to everyone who may write; the stream itself may be for publishers only.
  const threadNote = !active
    ? null
    : active.archived_at
      ? c().archivedNote
      : !active.joined
        ? (
            <span>
              {c().notJoined}{" "}
              <button type="button" onClick={join} className="min-h-11 font-medium text-accent underline underline-offset-2 md:min-h-0" data-chat-join>
                {c().join}
              </button>
            </span>
          )
        : null;
  const composerNote = threadNote ?? (active && active.joined && !active.can_publish ? c().publish.onlyChosen : null);
  const unit = active?.unit_id ? props.units.find((u) => u.id === active.unit_id) : undefined;
  const threadRoot = threadId ? (stream?.messages.find((m) => m.id === threadId) ?? null) : null;
  const panelButton = (kind: "members" | "pins", icon: "users" | "pin", label: string) => (
    <button
      type="button"
      onClick={() => setPanel((p) => (p?.kind === kind ? null : { kind }))}
      aria-pressed={panel?.kind === kind}
      aria-label={label}
      title={label}
      className={iconButtonClass(panel?.kind === kind ? "subtle" : "ghost")}
      data-chat-panel={kind}
    >
      <Icon name={icon} size={18} />
    </button>
  );

  return (
    <div className="flex h-[calc(100dvh-3.25rem)] w-full min-w-0 overflow-hidden md:h-dvh" data-chat>
      <aside className={`w-full shrink-0 border-r border-border bg-shell md:block md:w-64 ${showList || !active ? "block" : "hidden"}`}>
        <ChannelList
          channels={channels}
          categories={categories}
          activeId={activeId}
          admin={admin}
          canCreate={props.canCreateOpen || props.canCreateClosed}
          onSelect={select}
          onCreate={() => setDialog("create")}
          onBrowse={() => setDialog("browse")}
          onCategories={() => setDialog("categories")}
          people={people}
          me={me}
          onNewDirect={() => setDialog("direct")}
        />
      </aside>

      <main className={`min-w-0 flex-1 flex-col ${showList || !active ? "hidden md:flex" : "flex"}`}>
        {active ? (
          <>
            <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2" data-chat-header>
              <button type="button" onClick={() => setShowList(true)} aria-label={c().back} className={`${iconButtonClass("ghost")} md:hidden`}>
                <Icon name="arrow-left" size={18} />
              </button>
              <Icon name={channelIcon(active)} size={16} className="ml-1 shrink-0 text-muted" />
              <div className="min-w-0 flex-1 px-1">
                <h2 className="truncate text-sm font-semibold">{activeTitle}</h2>
                {(active.topic || unit) && (
                  <p className="truncate text-xs text-muted">
                    {unit ? `${c().unitChannel(unit.name)}${active.topic ? " · " : ""}` : ""}
                    {active.topic}
                  </p>
                )}
              </div>
              {panelButton("pins", "pin", c().pins)}
              {panelButton("members", "users", c().members.title)}
              <button type="button" onClick={() => setDialog("settings")} aria-label={c().settings.title} title={c().settings.title} className={iconButtonClass("ghost")} data-chat-settings>
                <Icon name="settings" size={18} />
              </button>
            </header>
            {error && (
              <div role="alert" className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2 text-sm">
                <span className="flex-1">{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label={t.common.close} className={iconButtonClass("ghost")}>
                  <Icon name="close" size={16} />
                </button>
              </div>
            )}
            <MessageStream
              messages={stream?.messages ?? []}
              people={people}
              me={me}
              reactions={reactions}
              actions={actions}
              hasMore={stream?.hasMore ?? false}
              loading={loading || !stream?.loaded}
              pendingIds={pending}
              onLoadOlder={loadOlder}
              highlight={highlight}
              files={files}
              shortId={shortId}
              empty={<p className="py-10 text-center text-sm text-muted">{active.visibility === "direct" ? c().direct.empty(activeTitle) : c().emptyChannel(active.name)}</p>}
            />
            <Composer
              placeholder={active.visibility === "direct" ? c().direct.composer(activeTitle) : c().composer(active.name)}
              people={props.people}
              disabled={false}
              note={composerNote}
              onSend={(body, fileIds) => void send(body, fileIds)}
              upload={canWrite && active.joined ? { shortId, channelId: active.id } : null}
              draft={drafts[active.id] ?? ""}
              onDraft={(value) => setDrafts((d) => ({ ...d, [active.id]: value }))}
            />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            {error && <p role="alert" className="text-sm">{error}</p>}
            <Icon name="comment" size={32} className="text-muted" />
            <p className="text-sm text-muted">{channels.length ? c().pickChannel : c().noChannels}</p>
          </div>
        )}
      </main>

      {active && panel && (
        <aside className="fixed inset-0 z-40 flex flex-col bg-background md:static md:z-auto md:w-80 md:shrink-0 md:border-l md:border-border" data-chat-side>
          {panel.kind === "members" && (
            <MembersPanel
              shortId={shortId}
              channel={active}
              people={props.people}
              units={props.units}
              canManage={canManage}
              guest={props.guest}
              onClose={() => setPanel(null)}
              onChanged={refreshList}
              onError={(code) => setError(errorText(code))}
            />
          )}
          {panel.kind === "pins" && (
            <PinsPanel
              pins={pins}
              people={people}
              canUnpin={canWrite}
              onOpen={(m) => {
                setHighlight(m.id);
                if (!stream?.messages.some((x) => x.id === m.id)) putMessages(active.id, [m]);
              }}
              onUnpin={(id) => void actions.onPin(id, false)}
              onClose={() => setPanel(null)}
            />
          )}
          {panel.kind === "thread" && (
            <ThreadPanel
              key={panel.id}
              channelName={activeTitle}
              root={threadRoot}
              replies={threads[panel.id] ?? null}
              people={people}
              me={me}
              reactions={reactions}
              actions={actions}
              pendingIds={pending}
              note={threadNote}
              onSend={(body, fileIds) => void send(body, fileIds, panel.id)}
              files={files}
              shortId={shortId}
              upload={canWrite ? { shortId, channelId: active.id } : null}
              onClose={() => setPanel(null)}
            />
          )}
        </aside>
      )}

      {dialog === "create" && (
        <CreateChannelDialog
          shortId={shortId}
          workspaceId={workspaceId}
          categories={categories}
          units={props.units}
          canOpen={props.canCreateOpen}
          canClosed={props.canCreateClosed}
          onClose={() => setDialog(null)}
          onCreated={async (id) => {
            setDialog(null);
            await refreshList();
            select(id);
          }}
        />
      )}
      {dialog === "settings" && active && (
        <ChannelSettingsDialog
          shortId={shortId}
          channel={active}
          title={activeTitle}
          categories={categories}
          units={props.units}
          canManage={canManage}
          onClose={() => setDialog(null)}
          onChanged={refreshList}
          onGone={async () => {
            setDialog(null);
            setActiveId(null);
            setShowList(true);
            await refreshList();
          }}
        />
      )}
      {dialog === "direct" && (
        <NewDirectDialog
          shortId={shortId}
          workspaceId={workspaceId}
          people={props.people.filter((p) => p.id !== me)}
          onClose={() => setDialog(null)}
          onOpened={async (id) => {
            setDialog(null);
            await refreshList();
            select(id);
          }}
        />
      )}
      {dialog === "browse" && (
        <BrowseDialog
          shortId={shortId}
          channels={channels}
          onClose={() => setDialog(null)}
          onOpen={(id) => {
            setDialog(null);
            select(id);
          }}
          onJoined={refreshList}
        />
      )}
      {dialog === "categories" && admin && (
        <CategoriesDialog
          shortId={shortId}
          workspaceId={workspaceId}
          categories={categories}
          people={props.people}
          units={props.units}
          onClose={() => setDialog(null)}
          onChanged={refreshList}
        />
      )}
    </div>
  );
}
