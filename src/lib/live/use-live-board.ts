"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { liveSession, setLiveViewerCursors } from "@/app/live-actions";
import type { BoardData } from "@/lib/boards";
import { batches, changedSince, elementKey, type BoardElement, type BoardFiles, type BoardLook, type BoardScene } from "./board-sync";
import { colorOf, type LiveCursor, type LivePeer, type LiveRoom, type LiveStatus } from "./use-live-doc";

// Real-time co-editing of an idea board (phase 2). The same two private channels and the
// same rules as presentations and "Design" (use-live-doc.ts), but the document is merged
// element by element by the canvas library's own versions (board-sync.ts), not with Yjs:
//   "live:<id>:doc"  — changed elements ("e"), the look ("a"), picture links ("f"), the
//                      title ("t"), the whole board for newcomers ("s"), "saved" notes ("v");
//                      only owners and editors send here.
//   "live:<id>:room" — presence, follow and cursors, exactly as in phase 1.
// Undo stays the canvas's own: others' changes come in without entering its history.

const REFRESH_MS = 120_000;
const CURSOR_MS = 200;
const FLUSH_MS = 100;
const CHUNK = 180_000;
const SETTLE_MS = 1_200;
const WAIT_FOR_STATE_MS = 4_000;
const TRACK_GAP_MS = 6_500;

type Json = Record<string, unknown>;
type Presence = { userId: string; name: string; avatarUrl: string | null; editor: boolean; ready: boolean; following: string | null };

// What the canvas gives the room: its whole scene, and a way to take others' changes in.
export type BoardTarget = {
  scene: () => BoardScene;
  apply: (part: Partial<BoardScene>) => void;
};

export type LiveBoard = LiveRoom & {
  // Every change of the scene while live (the canvas's own and merged ones); false when not
  // live (the screen saves as before then).
  changed: (scene: BoardScene) => boolean;
  changeTitle: (title: string) => boolean;
  bind: (target: BoardTarget | null) => void;
  sendCursor: (cursor: LiveCursor | null) => void;
  saved: (version: number) => void;
};

const sameLook = (a: BoardLook, b: BoardLook) => (a.viewBackgroundColor ?? null) === (b.viewBackgroundColor ?? null) && Boolean(a.gridModeEnabled) === Boolean(b.gridModeEnabled);

// What is saved: no tombstones, only the pictures still on the board.
function dataOf(scene: BoardScene): BoardData {
  const kept = scene.elements.filter((e) => !e.isDeleted);
  const used = new Set(kept.flatMap((e) => (e.type === "image" && typeof e.fileId === "string" ? [e.fileId] : [])));
  return {
    elements: kept,
    appState: { ...(scene.appState.viewBackgroundColor ? { viewBackgroundColor: scene.appState.viewBackgroundColor } : {}), ...(scene.appState.gridModeEnabled ? { gridModeEnabled: true } : {}) },
    files: Object.fromEntries(Object.entries(scene.files).filter(([id]) => used.has(id))),
  };
}

export function useLiveBoard({
  shortId,
  objectId,
  initialTitle,
  versionRef,
  pageCanEdit,
  onTitle,
  onSave,
}: {
  shortId: string;
  objectId: string;
  initialTitle: string;
  versionRef: MutableRefObject<number>;
  pageCanEdit: boolean;
  onTitle: (title: string) => void;
  onSave: (data: BoardData, title: string) => void;
}): LiveBoard {
  const [status, setStatus] = useState<LiveStatus>("off");
  const [active, setActive] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [peers, setPeers] = useState<LivePeer[]>([]);
  const [cursors, setCursors] = useState<Record<string, LiveCursor>>({});
  const [following, setFollowing] = useState<string | null>(null);
  const [viewerCursors, setViewerCursorsState] = useState(false);
  const [hideCursors, setHideCursorsState] = useState(false);
  const [leader, setLeader] = useState(false);
  const [me] = useState(() => `${Date.now().toString(36).padStart(9, "0")}-${Math.random().toString(36).slice(2, 8)}`);

  const client = useRef<SupabaseClient | null>(null);
  const docChannel = useRef<RealtimeChannel | null>(null);
  const roomChannel = useRef<RealtimeChannel | null>(null);
  const token = useRef("");
  const target = useRef<BoardTarget | null>(null);
  const latest = useRef<BoardScene | null>(null);
  const title = useRef(initialTitle);
  const onTitleRef = useRef(onTitle);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onTitleRef.current = onTitle;
    onSaveRef.current = onSave;
  });
  const ready = useRef(false);
  const activeRef = useRef(false);
  const editorRef = useRef(false);
  const viewerCursorsRef = useRef(false);
  const leaderRef = useRef(false);
  const peersRef = useRef<LivePeer[]>([]);
  // What the room knows: element versions, the look and the picture links.
  const known = useRef(new Map<string, string>());
  const knownLook = useRef<BoardLook>({});
  const knownFiles = useRef(new Set<string>());
  const pendingState = useRef<BoardScene | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorOut = useRef<{ value: LiveCursor | null; sent: string; timer: ReturnType<typeof setTimeout> | null }>({ value: null, sent: "", timer: null });
  const presence = useRef<Presence | null>(null);
  const trackState = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null });
  const lastStateSent = useRef(0);
  const chunks = useRef(new Map<string, string[]>());

  const editor = pageCanEdit && (role === "owner" || role === "editor");
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const sceneNow = useCallback(() => latest.current ?? target.current?.scene() ?? null, []);

  const saveIfLeader = useCallback(() => {
    if (!leaderRef.current || !activeRef.current || !editorRef.current) return;
    const scene = sceneNow();
    if (scene) onSaveRef.current(dataOf(scene), title.current);
  }, [sceneNow]);

  // ---- Sending -------------------------------------------------------------------
  const send = useCallback((channel: RealtimeChannel | null, event: string, payload: Json) => {
    if (!channel) return;
    void channel.send({ type: "broadcast", event, payload }).catch(() => {});
  }, []);

  const flush = useCallback(() => {
    flushTimer.current = null;
    const scene = latest.current;
    if (!scene || !ready.current || !editorRef.current) return;
    const changed = changedSince(scene.elements, known.current);
    for (const part of batches(changed, CHUNK)) send(docChannel.current, "e", { els: part });
    if (!sameLook(scene.appState, knownLook.current)) {
      knownLook.current = { ...scene.appState };
      send(docChannel.current, "a", { a: knownLook.current });
    }
    const newFiles = Object.entries(scene.files).filter(([id]) => !knownFiles.current.has(id));
    if (newFiles.length) {
      newFiles.forEach(([id]) => knownFiles.current.add(id));
      send(docChannel.current, "f", { f: Object.fromEntries(newFiles) });
    }
  }, [send]);

  const sendState = useCallback(() => {
    const scene = target.current?.scene();
    if (!scene || !editorRef.current || !ready.current) return;
    const now = Date.now();
    if (now - lastStateSent.current < 1_500) return;
    lastStateSent.current = now;
    const text = JSON.stringify({ ...scene, title: title.current });
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

  const remember = useCallback((elements: readonly BoardElement[]) => {
    for (const e of elements) if (e && typeof e.id === "string") known.current.set(e.id, elementKey(e));
  }, []);

  // ---- Becoming live ------------------------------------------------------------
  const becomeReady = useCallback(
    (state: BoardScene | null) => {
      const canvas = target.current;
      if (ready.current || !canvas) return;
      if (state) {
        // The room's board, with what the person drew before going live merged in by versions.
        canvas.apply(state);
        remember(state.elements);
        knownLook.current = { ...state.appState };
        knownFiles.current = new Set(Object.keys(state.files));
      } else {
        const scene = canvas.scene();
        remember(scene.elements);
        knownLook.current = { ...scene.appState };
        knownFiles.current = new Set(Object.keys(scene.files));
      }
      ready.current = true;
      activeRef.current = true;
      latest.current = canvas.scene();
      setActive(true);
      setStatus("live");
      track({ ready: true });
      // Anything only this copy had goes to the others.
      if (editorRef.current && !flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS);
    },
    [flush, remember, track],
  );

  const takeState = useCallback(
    (state: BoardScene & { title?: unknown }) => {
      if (typeof state.title === "string" && state.title !== title.current) {
        title.current = state.title;
        onTitleRef.current(state.title);
      }
      const scene: BoardScene = { elements: Array.isArray(state.elements) ? state.elements : [], appState: state.appState ?? {}, files: state.files ?? {} };
      if (!ready.current) {
        if (target.current) becomeReady(scene);
        else pendingState.current = scene;
        return;
      }
      target.current?.apply(scene);
      remember(scene.elements);
      if (presence.current && !presence.current.ready) track({ ready: true });
    },
    [becomeReady, remember, track],
  );

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
    setLeader(leaderRef.current);
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
      latest.current = null;
      known.current = new Map();
      if (client.current) void client.current.removeAllChannels();
      client.current = null;
      docChannel.current = null;
      roomChannel.current = null;
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

      const sb = createClient(session.url, session.key, {
        accessToken: async () => token.current,
        realtime: { params: { eventsPerSecond: 20 } },
      });
      client.current = sb;
      await sb.realtime.setAuth(token.current);

      const docCh = sb.channel(`live:${objectId}:doc`, { config: { private: true, broadcast: { self: false, ack: false } } });
      docCh.on("broadcast", { event: "e" }, ({ payload }) => {
        if (!ready.current || !Array.isArray(payload?.els)) return;
        const els = payload.els as BoardElement[];
        target.current?.apply({ elements: els });
        remember(els);
      });
      docCh.on("broadcast", { event: "a" }, ({ payload }) => {
        if (!ready.current || !payload?.a || typeof payload.a !== "object") return;
        knownLook.current = { ...(payload.a as BoardLook) };
        target.current?.apply({ appState: knownLook.current });
      });
      docCh.on("broadcast", { event: "f" }, ({ payload }) => {
        if (!ready.current || !payload?.f || typeof payload.f !== "object") return;
        const files = payload.f as BoardFiles;
        Object.keys(files).forEach((id) => knownFiles.current.add(id));
        target.current?.apply({ files });
      });
      docCh.on("broadcast", { event: "t" }, ({ payload }) => {
        if (typeof payload?.t !== "string" || payload.t === title.current) return;
        title.current = payload.t;
        onTitleRef.current(payload.t);
        saveIfLeader();
      });
      docCh.on("broadcast", { event: "s" }, ({ payload }) => {
        if (typeof payload?.id !== "string" || typeof payload.d !== "string") return;
        const parts = chunks.current.get(payload.id) ?? new Array<string>(Number(payload.n) || 1);
        parts[Number(payload.i) || 0] = payload.d;
        chunks.current.set(payload.id, parts);
        if (parts.filter((x) => typeof x === "string").length < parts.length) return;
        chunks.current.delete(payload.id);
        if (typeof payload.v === "number" && payload.v > versionRef.current) versionRef.current = payload.v;
        try {
          takeState(JSON.parse(parts.join("")));
        } catch {
          // A broken state is ignored; the next one comes with the next newcomer.
        }
      });
      docCh.on("broadcast", { event: "v" }, ({ payload }) => {
        if (typeof payload?.v === "number" && payload.v > versionRef.current) versionRef.current = payload.v;
      });
      docCh.on("broadcast", { event: "vc" }, ({ payload }) => {
        viewerCursorsRef.current = payload?.on === true;
        setViewerCursorsState(payload?.on === true);
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

      // Others in the room hand over the board; alone, an editor starts from the saved one.
      const settle = (delay: number) =>
        timers.push(
          setTimeout(() => {
            if (ready.current || stopped) return;
            // The canvas is still loading: ask again a little later.
            if (!target.current) return settle(500);
            if (!peersRef.current.some((p) => !p.me && p.editor && p.ready)) {
              if (editorRef.current) becomeReady(null);
              return;
            }
            track({ ready: false });
            settle(WAIT_FOR_STATE_MS);
          }, delay),
        );
      settle(SETTLE_MS);
    };

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
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flush();
      }
    };
    window.addEventListener("pagehide", onLeave);
    return () => {
      stopped = true;
      if (refresh) clearInterval(refresh);
      timers.forEach(clearTimeout);
      window.removeEventListener("pagehide", onLeave);
      onLeave();
      teardown();
    };
    // One connection per board and person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortId, objectId, pageCanEdit]);

  // ---- What the canvas and the screen call -----------------------------------------
  const changed = useCallback(
    (scene: BoardScene) => {
      latest.current = scene;
      if (!activeRef.current) return false;
      if (editorRef.current && !flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS);
      saveIfLeader();
      return true;
    },
    [flush, saveIfLeader],
  );

  const changeTitle = useCallback(
    (next: string) => {
      title.current = next;
      if (!activeRef.current || !editorRef.current) return false;
      send(docChannel.current, "t", { t: next });
      saveIfLeader();
      return true;
    },
    [saveIfLeader, send],
  );

  const bind = useCallback(
    (next: BoardTarget | null) => {
      target.current = next;
      if (next && pendingState.current && !ready.current) {
        const state = pendingState.current;
        pendingState.current = null;
        becomeReady(state);
      }
    },
    [becomeReady],
  );

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

  const saved = useCallback((version: number) => send(docChannel.current, "v", { v: version }), [send]);

  const myPeer = peers.find((p) => p.me);
  return {
    status,
    active,
    canEdit: active ? editor : pageCanEdit,
    leader,
    me,
    peers,
    cursors: hideCursors ? {} : cursors,
    following,
    followers: myPeer ? peers.filter((p) => p.following === me) : [],
    viewerCursors,
    hideCursors,
    follow,
    setViewerCursors,
    setHideCursors: setHideCursorsState,
    changed,
    changeTitle,
    bind,
    sendCursor,
    saved,
  };
}
