"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import * as Y from "yjs";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { liveSession, setLiveViewerCursors } from "@/app/live-actions";
import { fromBase64, readMap, rootOf, seedUpdate, shareUnchanged, toBase64, writeChange, type ListSpec } from "./doc-sync";

// Real-time co-editing of one canvas document (a deck, a "Design" file).
//
// Two private channels per document; the database decides who may join and send:
//   "live:<id>:doc"  — document changes (Yjs updates), full states for newcomers, "saved"
//                      notes; only owners and editors send here.
//   "live:<id>:room" — presence (who is here, who follows whom) and cursors with the
//                      selection and the visible area; viewers' cursors only when the
//                      document allows them.
// Nothing of the channels is stored. The document itself is still saved as JSON with a
// version check, by one editor at a time (the "leader": the editor who came first).
// The pass is renewed every two minutes; every renewal makes Realtime re-check the rights.

export type LiveCursor = { x: number; y: number; at: string; sel: string[]; view?: { x: number; y: number; z: number } };
export type LivePeer = {
  key: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  editor: boolean;
  ready: boolean;
  following: string | null;
  me: boolean;
};
export type LiveStatus = "off" | "connecting" | "live";

const REFRESH_MS = 120_000;
const CURSOR_MS = 200;
const FLUSH_MS = 100;
const CHUNK = 180_000;
const SETTLE_MS = 1_200;
const WAIT_FOR_STATE_MS = 4_000;
// Realtime allows a person 5 presence calls in 30 seconds.
const TRACK_GAP_MS = 6_500;
const TITLE = "__title";
const LOCAL = "local";
const REMOTE = "remote";
const SEED = "seed";

const COLORS = ["#e11d48", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5"];
export function colorOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

type Json = Record<string, unknown>;
type Presence = { userId: string; name: string; avatarUrl: string | null; editor: boolean; ready: boolean; following: string | null };

export type LiveDoc<T> = {
  status: LiveStatus;
  // The editor's changes go through Yjs (and undo/redo too) once this is true.
  active: boolean;
  // The person's own rights here may be lower than the page knew (they changed meanwhile).
  canEdit: boolean;
  leader: boolean;
  me: string;
  peers: LivePeer[];
  cursors: Record<string, LiveCursor>;
  following: string | null;
  followers: LivePeer[];
  viewerCursors: boolean;
  hideCursors: boolean;
  canUndo: boolean;
  canRedo: boolean;
  // For the editor: `before` is the state it built `after` from. False when not live
  // (the editor keeps its own history then).
  change: (before: T, after: T, record: boolean) => boolean;
  changeTitle: (title: string) => boolean;
  undo: () => boolean;
  redo: () => boolean;
  bind: (apply: (next: T) => void) => void;
  sendCursor: (cursor: LiveCursor | null) => void;
  follow: (key: string | null) => void;
  setViewerCursors: (on: boolean) => void;
  setHideCursors: (on: boolean) => void;
  saved: (version: number) => void;
};

export function useLiveDoc<T extends object>({
  shortId,
  objectId,
  spec,
  initial,
  initialTitle,
  versionRef,
  pageCanEdit,
  onTitle,
  onSave,
}: {
  shortId: string;
  objectId: string;
  spec: ListSpec;
  initial: T;
  initialTitle: string;
  // The saved version, shared with the screen's own saving.
  versionRef: MutableRefObject<number>;
  pageCanEdit: boolean;
  onTitle: (title: string) => void;
  // The leader saves: called with the whole document whenever it changed.
  onSave: (data: T, title: string) => void;
}): LiveDoc<T> {
  const [status, setStatus] = useState<LiveStatus>("off");
  const [active, setActive] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [peers, setPeers] = useState<LivePeer[]>([]);
  const [cursors, setCursors] = useState<Record<string, LiveCursor>>({});
  const [following, setFollowing] = useState<string | null>(null);
  const [viewerCursors, setViewerCursorsState] = useState(false);
  const [hideCursors, setHideCursorsState] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [me] = useState(() => `${Date.now().toString(36).padStart(9, "0")}-${Math.random().toString(36).slice(2, 8)}`);

  const ydoc = useRef<Y.Doc | null>(null);
  const undoManager = useRef<Y.UndoManager | null>(null);
  const client = useRef<SupabaseClient | null>(null);
  const docChannel = useRef<RealtimeChannel | null>(null);
  const roomChannel = useRef<RealtimeChannel | null>(null);
  const token = useRef("");
  const current = useRef<T>(initial);
  const title = useRef(initialTitle);
  const applyRef = useRef<((next: T) => void) | null>(null);
  const onTitleRef = useRef(onTitle);
  const onSaveRef = useRef(onSave);
  onTitleRef.current = onTitle;
  onSaveRef.current = onSave;
  const ready = useRef(false);
  const activeRef = useRef(false);
  const editorRef = useRef(false);
  const viewerCursorsRef = useRef(false);
  const leaderRef = useRef(false);
  const peersRef = useRef<LivePeer[]>([]);
  const outbox = useRef<Uint8Array[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorOut = useRef<{ value: LiveCursor | null; sent: string; timer: ReturnType<typeof setTimeout> | null }>({ value: null, sent: "", timer: null });
  const presence = useRef<Presence | null>(null);
  const trackState = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null });
  const lastStateSent = useRef(0);
  const chunks = useRef(new Map<string, string[]>());

  const editor = pageCanEdit && (role === "owner" || role === "editor");
  editorRef.current = editor;

  // ---- Yjs document --------------------------------------------------------------
  const readDoc = useCallback((): { data: T; title: string } => {
    const raw = readMap(rootOf(ydoc.current!), spec);
    const { [TITLE]: t, ...rest } = raw;
    return { data: rest as T, title: typeof t === "string" ? t : title.current };
  }, [spec]);

  const showDoc = useCallback(() => {
    if (!ydoc.current) return;
    const { data, title: nextTitle } = readDoc();
    const next = shareUnchanged(current.current, data);
    if (next !== current.current) {
      current.current = next;
      applyRef.current?.(next);
    }
    if (nextTitle !== title.current) {
      title.current = nextTitle;
      onTitleRef.current(nextTitle);
    }
  }, [readDoc]);

  const saveIfLeader = useCallback(() => {
    if (leaderRef.current && activeRef.current && editorRef.current) onSaveRef.current(current.current, title.current);
  }, []);

  // ---- Sending -------------------------------------------------------------------
  const send = useCallback((channel: RealtimeChannel | null, event: string, payload: Json) => {
    if (!channel) return;
    void channel.send({ type: "broadcast", event, payload }).catch(() => {});
  }, []);

  const flushOutbox = useCallback(() => {
    flushTimer.current = null;
    if (!outbox.current.length) return;
    const update = Y.mergeUpdates(outbox.current);
    outbox.current = [];
    if (editorRef.current) send(docChannel.current, "u", { d: toBase64(update) });
  }, [send]);

  const sendState = useCallback(() => {
    if (!ydoc.current || !editorRef.current || !ready.current) return;
    const now = Date.now();
    if (now - lastStateSent.current < 1_500) return;
    lastStateSent.current = now;
    const text = toBase64(Y.encodeStateAsUpdate(ydoc.current));
    const id = Math.random().toString(36).slice(2, 10);
    const n = Math.max(1, Math.ceil(text.length / CHUNK));
    for (let i = 0; i < n; i++) send(docChannel.current, "s", { id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK), v: versionRef.current });
  }, [send, versionRef]);

  const track = useCallback((patch: Partial<Presence>) => {
    if (!presence.current) return;
    presence.current = { ...presence.current, ...patch };
    const state = trackState.current;
    const run = () => {
      state.timer = null;
      state.last = Date.now();
      if (presence.current) void roomChannel.current?.track(presence.current).catch(() => {});
    };
    if (state.timer) return;
    const wait = state.last + TRACK_GAP_MS - Date.now();
    if (wait <= 0) run();
    else state.timer = setTimeout(run, wait);
  }, []);

  // ---- Becoming live ------------------------------------------------------------
  const becomeReady = useCallback(() => {
    if (ready.current || !ydoc.current) return;
    ready.current = true;
    // What the person changed before the document went live goes in on top of the room's state.
    if (editorRef.current && (current.current !== initial || title.current !== initialTitle)) {
      ydoc.current.transact(() => {
        writeChange(rootOf(ydoc.current!), initial as Json, current.current as Json, spec);
        if (title.current !== initialTitle) rootOf(ydoc.current!).set(TITLE, title.current);
      }, LOCAL);
      undoManager.current?.clear();
    }
    activeRef.current = true;
    setActive(true);
    setStatus("live");
    showDoc();
    track({ ready: true });
  }, [initial, initialTitle, showDoc, spec, track]);

  const seed = useCallback(() => {
    if (ready.current || !ydoc.current || !editorRef.current) return;
    Y.applyUpdate(ydoc.current, seedUpdate({ ...(initial as Json), [TITLE]: initialTitle }, spec, versionRef.current), SEED);
    becomeReady();
  }, [becomeReady, initial, initialTitle, spec, versionRef]);

  // The leader (the first ready editor) sends the whole state to anyone not ready yet.
  const onPresence = useCallback(() => {
    const room = roomChannel.current;
    if (!room) return;
    const state = room.presenceState<Presence>();
    const list: LivePeer[] = [];
    for (const [key, entries] of Object.entries(state)) {
      const p = entries[entries.length - 1];
      if (!p) continue;
      list.push({ key, userId: p.userId, name: p.name, avatarUrl: p.avatarUrl ?? null, color: colorOf(p.userId), editor: p.editor === true, ready: p.ready === true, following: p.following ?? null, me: key === me });
    }
    list.sort((a, b) => (a.key < b.key ? -1 : 1));
    peersRef.current = list;
    setPeers(list);
    setCursors((all) => Object.fromEntries(Object.entries(all).filter(([key]) => list.some((p) => p.key === key))));
    setFollowing((f) => (f && !list.some((p) => p.key === f) ? null : f));
    const leaderKey = list.find((p) => p.editor && (p.ready || p.me))?.key ?? null;
    const wasLeader = leaderRef.current;
    leaderRef.current = leaderKey === me && editorRef.current;
    // Whoever is not in sync yet gets the whole state from the first editor who is.
    const responder = list.find((p) => p.editor && p.ready)?.key;
    if (ready.current && responder === me && list.some((p) => !p.ready)) sendState();
    if (leaderRef.current && !wasLeader) saveIfLeader();
  }, [me, saveIfLeader, sendState]);

  // ---- Connecting ----------------------------------------------------------------
  useEffect(() => {
    let stopped = false;
    let refresh: ReturnType<typeof setInterval> | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const teardown = () => {
      ready.current = false;
      activeRef.current = false;
      leaderRef.current = false;
      if (client.current) void client.current.removeAllChannels();
      client.current = null;
      docChannel.current = null;
      roomChannel.current = null;
      undoManager.current?.destroy();
      undoManager.current = null;
      ydoc.current?.destroy();
      ydoc.current = null;
    };
    const goOff = () => {
      teardown();
      if (stopped) return;
      setActive(false);
      setStatus("off");
      setPeers([]);
      setCursors({});
    };

    const start = async () => {
      const session = await liveSession(shortId, objectId).catch(() => null);
      if (stopped || !session?.enabled) return;
      token.current = session.token;
      setRole(session.role);
      viewerCursorsRef.current = session.viewerCursors;
      setViewerCursorsState(session.viewerCursors);
      const isEditor = pageCanEdit && (session.role === "owner" || session.role === "editor");
      editorRef.current = isEditor;
      setStatus("connecting");

      const doc = new Y.Doc();
      ydoc.current = doc;
      const undo = new Y.UndoManager(rootOf(doc), { trackedOrigins: new Set([LOCAL]), captureTimeout: 400 });
      undoManager.current = undo;
      const stacks = () => {
        setCanUndo(undo.undoStack.length > 0);
        setCanRedo(undo.redoStack.length > 0);
      };
      undo.on("stack-item-added", stacks);
      undo.on("stack-item-popped", stacks);
      undo.on("stack-cleared", stacks);
      doc.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin !== REMOTE && origin !== SEED && editorRef.current) {
          outbox.current.push(update);
          if (!flushTimer.current) flushTimer.current = setTimeout(flushOutbox, FLUSH_MS);
        }
        if (origin !== LOCAL && activeRef.current) showDoc();
        if (activeRef.current) saveIfLeader();
      });

      const sb = createClient(session.url, session.key, {
        accessToken: async () => token.current,
        realtime: { params: { eventsPerSecond: 20 } },
      });
      client.current = sb;
      await sb.realtime.setAuth(token.current);

      const docCh = sb.channel(`live:${objectId}:doc`, { config: { private: true, broadcast: { self: false, ack: false } } });
      docCh.on("broadcast", { event: "u" }, ({ payload }) => {
        if (ydoc.current && typeof payload?.d === "string") Y.applyUpdate(ydoc.current, fromBase64(payload.d), REMOTE);
      });
      docCh.on("broadcast", { event: "s" }, ({ payload }) => {
        if (!ydoc.current || typeof payload?.id !== "string" || typeof payload.d !== "string") return;
        const parts = chunks.current.get(payload.id) ?? new Array<string>(Number(payload.n) || 1);
        parts[Number(payload.i) || 0] = payload.d;
        chunks.current.set(payload.id, parts);
        if (parts.filter((x) => typeof x === "string").length < parts.length) return;
        chunks.current.delete(payload.id);
        Y.applyUpdate(ydoc.current, fromBase64(parts.join("")), REMOTE);
        if (typeof payload.v === "number" && payload.v > versionRef.current) versionRef.current = payload.v;
        if (ready.current) {
          if (presence.current && !presence.current.ready) track({ ready: true });
        } else becomeReady();
      });
      docCh.on("broadcast", { event: "v" }, ({ payload }) => {
        if (typeof payload?.v === "number" && payload.v > versionRef.current) versionRef.current = payload.v;
      });
      docCh.on("broadcast", { event: "vc" }, ({ payload }) => {
        viewerCursorsRef.current = payload?.on === true;
        setViewerCursorsState(payload?.on === true);
        // A new pass makes Realtime re-check whether this person may send cursors.
        void renew();
      });

      const room = sb.channel(`live:${objectId}:room`, { config: { private: true, broadcast: { self: false, ack: false }, presence: { key: me } } });
      room.on("presence", { event: "sync" }, onPresence);
      room.on("broadcast", { event: "c" }, ({ payload }) => {
        if (typeof payload?.k !== "string") return;
        const { k, ...cursor } = payload as LiveCursor & { k: string; gone?: boolean };
        setCursors((all) => {
          if ((cursor as { gone?: boolean }).gone) {
            const rest = { ...all };
            delete rest[k];
            return rest;
          }
          return { ...all, [k]: cursor };
        });
      });
      roomChannel.current = room;
      docChannel.current = docCh;

      const joined = (channel: RealtimeChannel) =>
        new Promise<boolean>((resolve) => {
          let done = false;
          channel.subscribe((state) => {
            if (state === "SUBSCRIBED") {
              if (!done) resolve((done = true));
              // Back after a dropped connection: hand over what we have and ask for what we missed.
              else if (ready.current && channel === room) {
                lastStateSent.current = 0;
                sendState();
                track({ ready: false });
              }
            } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
              if (!done) resolve(!(done = true));
            }
          });
        });
      const [okDoc, okRoom] = await Promise.all([joined(docCh), joined(room)]);
      if (stopped) return;
      if (!okDoc || !okRoom) return goOff();

      presence.current = { userId: session.me.id, name: session.me.name, avatarUrl: session.me.avatarUrl, editor: isEditor, ready: false, following: null };
      track({});

      // Others in the room hand over the current state; alone, an editor starts from the saved one.
      const settle = (delay: number) =>
        timers.push(
          setTimeout(() => {
            if (ready.current || stopped) return;
            // Never start from the saved copy while someone in sync is here (their newer
            // state would lose to it): ask them again instead.
            if (!peersRef.current.some((p) => !p.me && p.editor && p.ready)) return seed();
            track({ ready: false });
            settle(WAIT_FOR_STATE_MS);
          }, delay),
        );
      settle(SETTLE_MS);
    };

    // Every two minutes: a fresh pass (re-checks the rights), or off if the switch was turned off.
    const renew = async () => {
      const session = await liveSession(shortId, objectId).catch(() => null);
      if (stopped) return;
      if (!session?.enabled) return goOff();
      token.current = session.token;
      setRole(session.role);
      editorRef.current = pageCanEdit && (session.role === "owner" || session.role === "editor");
      viewerCursorsRef.current = session.viewerCursors;
      setViewerCursorsState(session.viewerCursors);
      await client.current?.realtime.setAuth(session.token).catch(() => {});
    };

    void start();
    refresh = setInterval(() => void renew(), REFRESH_MS);
    const onLeave = () => {
      if (cursorOut.current.timer) clearTimeout(cursorOut.current.timer);
      flushOutbox();
    };
    window.addEventListener("pagehide", onLeave);
    return () => {
      stopped = true;
      if (refresh) clearInterval(refresh);
      timers.forEach(clearTimeout);
      window.removeEventListener("pagehide", onLeave);
      flushOutbox();
      teardown();
    };
    // One connection per document and person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortId, objectId, pageCanEdit]);

  // ---- What the editor calls -------------------------------------------------------
  const change = useCallback(
    (before: T, after: T, record: boolean) => {
      if (!activeRef.current || !ydoc.current) {
        current.current = after;
        return false;
      }
      if (!editorRef.current) return true;
      ydoc.current.transact(() => writeChange(rootOf(ydoc.current!), before as Json, after as Json, spec), LOCAL);
      if (record) undoManager.current?.stopCapturing();
      // The editor shows what Yjs holds: its change merged with others' made meanwhile.
      const { data } = readDoc();
      const merged = shareUnchanged(after, data);
      current.current = merged;
      if (merged !== after) applyRef.current?.(merged);
      return true;
    },
    [readDoc, spec],
  );

  const changeTitle = useCallback((next: string) => {
    title.current = next;
    if (!activeRef.current || !ydoc.current || !editorRef.current) return false;
    ydoc.current.transact(() => rootOf(ydoc.current!).set(TITLE, next), LOCAL);
    return true;
  }, []);

  const undo = useCallback(() => {
    if (!activeRef.current || !undoManager.current) return false;
    undoManager.current.undo();
    return true;
  }, []);
  const redo = useCallback(() => {
    if (!activeRef.current || !undoManager.current) return false;
    undoManager.current.redo();
    return true;
  }, []);

  const bind = useCallback((apply: (next: T) => void) => {
    applyRef.current = apply;
  }, []);

  // Cursors: at most five a second, only when something changed, and only if this person
  // may show theirs (editors; viewers and commenters when the document allows).
  const sendCursor = useCallback(
    (cursor: LiveCursor | null) => {
      const out = cursorOut.current;
      out.value = cursor;
      if (out.timer) return;
      out.timer = setTimeout(() => {
        out.timer = null;
        if (!activeRef.current || !(editorRef.current || viewerCursorsRef.current)) return;
        const payload = out.value ? { k: me, ...out.value } : { k: me, gone: true };
        const text = JSON.stringify(payload);
        if (text === out.sent) return;
        out.sent = text;
        send(roomChannel.current, "c", payload);
      }, CURSOR_MS);
    },
    [me, send],
  );

  const follow = useCallback(
    (key: string | null) => {
      setFollowing(key);
      track({ following: key });
    },
    [track],
  );

  const setViewerCursors = useCallback(
    (on: boolean) => {
      if (!editorRef.current) return;
      void setLiveViewerCursors(shortId, objectId, on).then((result) => {
        if (!result.ok) return;
        viewerCursorsRef.current = on;
        setViewerCursorsState(on);
        send(docChannel.current, "vc", { on });
      });
    },
    [objectId, send, shortId],
  );

  // Tell the others about a successful save (they keep the version for when they lead).
  const saved = useCallback((version: number) => send(docChannel.current, "v", { v: version }), [send]);

  const myPeer = peers.find((p) => p.me);
  return {
    status,
    active,
    canEdit: active ? editor : pageCanEdit,
    leader: leaderRef.current,
    me,
    peers,
    cursors: hideCursors ? {} : cursors,
    following,
    followers: myPeer ? peers.filter((p) => p.following === me) : [],
    viewerCursors,
    hideCursors,
    canUndo,
    canRedo,
    change,
    changeTitle,
    undo,
    redo,
    bind,
    sendCursor,
    follow,
    setViewerCursors,
    setHideCursors: setHideCursorsState,
    saved,
  };
}
