"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import {
  MESSAGE_PAGE,
  mergeMessages,
  type ChatCategory,
  type ChatChannel,
  type ChatLive,
  type ChatMessage,
  type ChatPerson,
} from "@/lib/chat";
import {
  deleteMessage,
  editMessage,
  joinChannel,
  loadChat,
  loadMessages,
  loadMessagesById,
  markRead,
  postMessage,
} from "@/app/chat-actions";
import { Icon } from "@/components/ui/icon";
import { iconButtonClass } from "@/components/ui/button";
import { ChannelList } from "./channel-list";
import { Composer, MessageStream } from "./message-stream";
import { MembersPanel } from "./members-panel";
import { BrowseDialog, CategoriesDialog, ChannelSettingsDialog, CreateChannelDialog } from "./chat-dialogs";
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
  failed: boolean;
};

type Dialog = "create" | "settings" | "browse" | "categories" | null;

const errorText = (code: string) => (c().errors as Record<string, string>)[code] ?? c().errors.unknown;

// Toker: channels on the left, the chosen channel's stream in the middle, its people
// on the right. The database decides everything; this keeps the screen in step.
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
  const [streams, setStreams] = useState<Record<string, { messages: ChatMessage[]; hasMore: boolean; loaded: boolean }>>({});
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [error, setError] = useState<string | null>(props.failed ? c().errors.load : null);

  const people = useMemo(() => new Map(props.people.map((p) => [p.id, p])), [props.people]);
  const active = channels.find((ch) => ch.id === activeId) ?? null;
  const stream = activeId ? streams[activeId] : undefined;
  const canManage = Boolean(active && (admin || active.role === "owner"));

  // ---------------------------------------------------------------- reading

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
    },
    [shortId],
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
  }, [activeId, loading, streams, shortId]);

  // The chosen channel: its messages, and the address shows it (no page reload).
  useEffect(() => {
    if (!activeId) return;
    // The messages arrive later (an await); nothing is set synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!streams[activeId]?.loaded) void loadLatest(activeId);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("c", activeId);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // The address just doesn't follow.
    }
    // Loading once per channel switch is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

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
        // Replies live in threads (next step); the stream shows top messages only.
        if (signal.channelId === activeId && !signal.threadRootId) {
          void loadMessagesById(shortId, [signal.id]).then((rows) =>
            setStreams((all) => {
              const current = all[signal.channelId];
              if (!current) return all;
              return { ...all, [signal.channelId]: { ...current, messages: mergeMessages(current.messages, rows) } };
            }),
          );
        }
        if (signal.channelId !== activeId) refreshListSoon();
        else if (signal.threadRootId) void loadMessagesById(shortId, [signal.threadRootId]).then((rows) =>
          setStreams((all) => {
            const current = all[signal.channelId];
            return current ? { ...all, [signal.channelId]: { ...current, messages: mergeMessages(current.messages, rows) } } : all;
          }),
        );
      } else {
        refreshListSoon();
      }
    },
    [activeId, shortId, refreshListSoon],
  );

  const joinedIds = useMemo(() => channels.filter((ch) => ch.joined && !ch.archived_at).map((ch) => ch.id), [channels]);
  const listened = useMemo(() => (activeId && !joinedIds.includes(activeId) ? [...joinedIds, activeId] : joinedIds), [joinedIds, activeId]);
  const { connected } = useChatLive(live, me, listened, onSignal);

  // Polling: always for the list now and then; for the open channel while no live signals.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshList();
    }, connected ? LIST_SAFETY_MS : LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [connected, refreshList]);
  useEffect(() => {
    if (connected || !activeId) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadLatest(activeId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [connected, activeId, loadLatest]);
  // Back to the tab: catch up at once.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshList();
      if (activeId) void loadLatest(activeId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [activeId, refreshList, loadLatest]);

  // ---------------------------------------------------------------- writing

  const send = async (body: string) => {
    if (!active) return;
    const channelId = active.id;
    const temp = `pending-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: temp,
      channel_id: channelId,
      author_id: me,
      thread_root_id: null,
      body,
      mentions: [],
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      pinned_at: null,
      reply_count: 0,
      last_reply_at: null,
    };
    setPending((set) => new Set(set).add(temp));
    setStreams((all) => ({ ...all, [channelId]: { ...(all[channelId] ?? { hasMore: false, loaded: true }), messages: [...(all[channelId]?.messages ?? []), optimistic] } }));
    const result = await postMessage(shortId, channelId, body);
    const rows = result.ok ? await loadMessagesById(shortId, [result.id]) : [];
    setPending((set) => {
      const next = new Set(set);
      next.delete(temp);
      return next;
    });
    setStreams((all) => {
      const current = all[channelId];
      if (!current) return all;
      return { ...all, [channelId]: { ...current, messages: mergeMessages(current.messages.filter((m) => m.id !== temp), rows) } };
    });
    if (!result.ok) {
      setError(errorText(result.error));
      setDrafts((d) => ({ ...d, [channelId]: d[channelId] || body }));
    }
  };

  const edit = async (id: string, body: string) => {
    const result = await editMessage(shortId, id, body);
    if (!result.ok) {
      setError(errorText(result.error));
      return false;
    }
    const rows = await loadMessagesById(shortId, [id]);
    if (activeId) setStreams((all) => ({ ...all, [activeId]: { ...all[activeId], messages: mergeMessages(all[activeId]?.messages ?? [], rows) } }));
    return true;
  };

  const remove = async (id: string) => {
    if (!window.confirm(c().deleteConfirm)) return;
    const result = await deleteMessage(shortId, id);
    if (!result.ok) return setError(errorText(result.error));
    const rows = await loadMessagesById(shortId, [id]);
    if (activeId) setStreams((all) => ({ ...all, [activeId]: { ...all[activeId], messages: mergeMessages(all[activeId]?.messages ?? [], rows) } }));
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
    setShowMembers(false);
  };

  // ---------------------------------------------------------------- layout

  const composerNote = !active
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
  const unit = active?.unit_id ? props.units.find((u) => u.id === active.unit_id) : undefined;

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
        />
      </aside>

      <main className={`min-w-0 flex-1 flex-col ${showList || !active ? "hidden md:flex" : "flex"}`}>
        {active ? (
          <>
            <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2" data-chat-header>
              <button type="button" onClick={() => setShowList(true)} aria-label={c().back} className={`${iconButtonClass("ghost")} md:hidden`}>
                <Icon name="arrow-left" size={18} />
              </button>
              <Icon name={active.visibility === "closed" ? "lock" : "hash"} size={16} className="ml-1 shrink-0 text-muted" />
              <div className="min-w-0 flex-1 px-1">
                <h2 className="truncate text-sm font-semibold">{active.name}</h2>
                {(active.topic || unit) && (
                  <p className="truncate text-xs text-muted">
                    {unit ? `${c().unitChannel(unit.name)}${active.topic ? " · " : ""}` : ""}
                    {active.topic}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowMembers((v) => !v)}
                aria-pressed={showMembers}
                aria-label={c().members.title}
                title={c().members.title}
                className={iconButtonClass(showMembers ? "subtle" : "ghost")}
                data-chat-members-toggle
              >
                <Icon name="users" size={18} />
              </button>
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
              canModerate={canManage}
              hasMore={stream?.hasMore ?? false}
              loading={loading || !stream?.loaded}
              pendingIds={pending}
              onLoadOlder={loadOlder}
              onEdit={edit}
              onDelete={remove}
              empty={<p className="py-10 text-center text-sm text-muted">{c().emptyChannel(active.name)}</p>}
            />
            <Composer
              channelName={active.name}
              disabled={false}
              note={composerNote}
              onSend={send}
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

      {active && showMembers && (
        <aside className="fixed inset-0 z-40 flex flex-col bg-background md:static md:z-auto md:w-72 md:shrink-0 md:border-l md:border-border" data-chat-members>
          <MembersPanel
            shortId={shortId}
            channel={active}
            people={props.people}
            units={props.units}
            canManage={canManage}
            guest={props.guest}
            onClose={() => setShowMembers(false)}
            onChanged={refreshList}
            onError={(code) => setError(errorText(code))}
          />
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
