"use client";

import "./excalidraw-assets";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaptureUpdateAction, Excalidraw, FONT_FAMILY, MainMenu, convertToExcalidrawElements, hashElementsVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { currentLocale, t } from "@/i18n";
import { useResolvedTheme } from "@/lib/use-theme";
import { STICKY_COLORS, type BoardData, type StickyColor } from "@/lib/boards";
import { templateParts, type TemplateKey, type TemplatePart } from "@/lib/board-templates";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { prepareImage } from "@/lib/image-compression";
import { Icon } from "@/components/ui/icon";
import { mergeElements, type BoardElement, type BoardScene } from "@/lib/live/board-sync";
import type { LiveBoard } from "@/lib/live/use-live-board";

const b = t.boards;

// A sticky note as the screen around the canvas needs it.
export type StickyInfo = { id: string; text: string; task: { id: string; key: string } | null };

// What the board screen may do on the canvas.
export type BoardController = {
  insertTemplate: (key: TemplateKey) => void;
  linkTask: (stickyId: string, task: { id: string; key: string; href: string }) => void;
  // A link to a wishlist: only "Wishlist · name" is written on the board, never its title.
  insertLink: (label: string, href: string, color: string) => void;
};

type Votes = { open: boolean; tally: Record<string, number>; mine: string[]; show: boolean };
type Chip = { key: string; done: boolean; status: string };

type Element = { id: string; type: string; x: number; y: number; width: number; height: number; isDeleted?: boolean; customData?: Record<string, unknown>; containerId?: string | null; text?: string; link?: string | null };

// The board's canvas (steps Д1, Д3a and Д3b): Excalidraw with a clean style by default
// (no sketchy lines, a plain font) and the pencil for freehand; sticky notes are
// a button and the S key; templates, votes on sticky notes and task chips are
// drawn over it. Only real changes of the drawing are reported, not zooming or
// selecting.
export default function BoardCanvas({
  compact = false,
  shortId,
  boardId,
  onPictureError,
  initial,
  editable,
  onChange,
  onReady,
  onStickies,
  onSelect,
  votes,
  onVote,
  chips,
  live = null,
}: {
  // Inside a wiki page (step Д4): no template chooser.
  compact?: boolean;
  shortId?: string;
  boardId?: string;
  onPictureError?: (message: string) => void;
  initial: BoardData;
  editable: boolean;
  onChange: (data: BoardData) => void;
  onReady?: (controller: BoardController) => void;
  onStickies?: (stickies: StickyInfo[]) => void;
  onSelect?: (stickyId: string | null) => void;
  votes?: Votes | null;
  onVote?: (stickyId: string) => void;
  chips?: Record<string, Chip | null>;
  // Real-time co-editing (phase 2), on the board's own page only.
  live?: LiveBoard | null;
}) {
  const theme = useResolvedTheme();
  // A guest doesn't take the board away as a picture.
  const canExport = useOptionalPages()?.workspace.role !== "guest";
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [color, setColor] = useState<StickyColor>("yellow");
  const [view, setView] = useState({ scrollX: 0, scrollY: 0, zoom: 1 });
  const [elements, setElements] = useState<readonly Element[]>(initial.elements as Element[]);
  const [chooser, setChooser] = useState(editable && !compact && initial.elements.length === 0);
  const box = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  const grid = useRef(Boolean(initial.appState.gridModeEnabled));
  // Pictures (step Д3b): each picture in the scene (its Excalidraw file id) and
  // where its bytes are kept in the workspace's one storage. Only these links
  // are saved with the board, never the pictures themselves.
  const stored = useRef<Record<string, { file: string; mimeType: string }>>({ ...(initial.files as Record<string, { file: string; mimeType: string }>) });
  const uploading = useRef(new Set<string>());
  // Pictures that couldn't be kept: not tried again (they have left the board).
  const failed = useRef(new Set<string>());

  const dataOf = useCallback((next: readonly { id: string; isDeleted?: boolean; type: string; fileId?: string | null }[], appState: { viewBackgroundColor: string; gridModeEnabled: boolean }): BoardData => {
    const kept = next.filter((e) => !e.isDeleted);
    const used = new Set(kept.flatMap((e) => (e.type === "image" && e.fileId ? [e.fileId] : [])));
    return {
      elements: kept,
      appState: { viewBackgroundColor: appState.viewBackgroundColor, ...(appState.gridModeEnabled ? { gridModeEnabled: true } : {}) },
      files: Object.fromEntries(Object.entries(stored.current).filter(([fileId]) => used.has(fileId))),
    };
  }, []);

  // A stored picture comes back from the storage (when the board opens, or when someone
  // else in the room has put it on the board).
  const alive = useRef(true);
  const fetchPicture = useCallback(
    (fileId: string, link: { file: string; mimeType: string }) => {
      if (!api || !shortId) return;
      void fetch(`/api/boards/files/${link.file}?ws=${shortId}`)
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => (blob ? readAsDataUrl(blob) : null))
        .then((dataURL) => {
          if (alive.current && dataURL) api.addFiles([{ id: fileId as never, dataURL: dataURL as never, mimeType: link.mimeType as never, created: Date.now() }]);
        })
        .catch(() => {});
    },
    [api, shortId],
  );
  useEffect(() => {
    alive.current = true;
    for (const [fileId, link] of Object.entries(stored.current)) fetchPicture(fileId, link);
    return () => {
      alive.current = false;
    };
  }, [fetchPicture]);

  // A picture put on the board (inserted, dropped or pasted) is made smaller and
  // stored; then the board is saved with its link.
  const upload = useCallback(
    async (fileId: string, dataURL: string, mimeType: string) => {
      if (!api || !shortId || !boardId || uploading.current.has(fileId) || failed.current.has(fileId)) return;
      uploading.current.add(fileId);
      try {
        let body: Blob = await (await fetch(dataURL)).blob();
        let type = mimeType;
        if (type !== "image/gif") {
          try {
            const prepared = await prepareImage(new File([body], "picture", { type }), "fullhd");
            body = prepared.blob;
            type = prepared.type;
          } catch {
            // Sent as it is; the server checks the size.
          }
        }
        const response = await fetch(`/api/boards/files?ws=${shortId}&board=${boardId}&name=picture`, { method: "POST", headers: { "Content-Type": type }, body });
        const result = (await response.json().catch(() => null)) as { ok?: boolean; id?: string; error?: string } | null;
        if (!result?.ok || !result.id) throw new Error(result?.error ?? "upload_failed");
        stored.current[fileId] = { file: result.id, mimeType: type };
        onChange(dataOf(api.getSceneElements() as never, api.getAppState()));
      } catch (error) {
        failed.current.add(fileId);
        const code = error instanceof Error ? error.message : "";
        onPictureError?.(t.tasks.files.errors[code] ?? b.errors[code] ?? t.common.unknownError);
        // A picture that couldn't be kept leaves the board.
        api.updateScene({
          elements: api.getSceneElementsIncludingDeleted().map((e) => (e.type === "image" && e.fileId === fileId ? { ...e, isDeleted: true, version: e.version + 1 } : e)),
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      } finally {
        uploading.current.delete(fileId);
      }
    },
    [api, shortId, boardId, onChange, dataOf, onPictureError],
  );

  // Where something goes: the middle of what is on screen.
  const viewCenter = useCallback(() => {
    if (!api) return { x: 0, y: 0 };
    const state = api.getAppState();
    const zoom = state.zoom.value;
    return { x: -state.scrollX + state.width / 2 / zoom, y: -state.scrollY + state.height / 2 / zoom };
  }, [api]);

  const stickySkeleton = (x: number, y: number, fill: StickyColor, text: string) => ({
    type: "rectangle" as const,
    x,
    y,
    width: 200,
    height: 200,
    backgroundColor: STICKY_COLORS[fill],
    fillStyle: "solid" as const,
    strokeColor: "transparent",
    roughness: 0,
    roundness: { type: 3 as const },
    customData: { sticky: true },
    label: { text: text || " ", fontFamily: FONT_FAMILY.Nunito, fontSize: 20, strokeColor: "#1e1e1e" },
  });

  const addElements = useCallback(
    (skeletons: Parameters<typeof convertToExcalidrawElements>[0], select = true) => {
      if (!api) return;
      const made = convertToExcalidrawElements(skeletons);
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), ...made],
        appState: select && made[0] ? { selectedElementIds: { [made[0].id]: true } } : undefined,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api],
  );

  const addSticky = useCallback(
    (fill: StickyColor) => {
      if (!api || !editable) return;
      const center = viewCenter();
      // A little shifted for each new one, so they don't hide each other.
      const shift = (api.getSceneElements().filter((e) => e.customData?.sticky).length % 6) * 24;
      addElements([stickySkeleton(center.x - 100 + shift, center.y - 100 + shift, fill, "")]);
    },
    [api, editable, viewCenter, addElements],
  );

  const insertTemplate = useCallback(
    (key: TemplateKey) => {
      if (!api || !editable) return;
      setChooser(false);
      if (key === "grid") {
        grid.current = true;
        api.updateScene({ appState: { gridModeEnabled: true }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        return;
      }
      const parts = templateParts(key, b.templates.texts as never);
      // The layout's middle goes to the middle of the view.
      const xs = parts.flatMap((p) => (p.kind === "frame" ? [p.x, p.x + p.width] : [p.x, p.x + 200]));
      const ys = parts.flatMap((p) => (p.kind === "frame" ? [p.y, p.y + p.height] : [p.y, p.y + 200]));
      const center = viewCenter();
      const dx = center.x - (Math.min(...xs) + Math.max(...xs)) / 2;
      const dy = center.y - (Math.min(...ys) + Math.max(...ys)) / 2;
      const toSkeleton = (p: TemplatePart) => {
        const x = p.x + dx;
        const y = p.y + dy;
        if (p.kind === "frame") return { type: "frame" as const, x, y, width: p.width, height: p.height, name: p.name, children: [] };
        if (p.kind === "sticky") return stickySkeleton(x, y, p.color, p.text);
        if (p.kind === "topic")
          return { type: "ellipse" as const, x: x - 60, y: y + 20, width: 320, height: 160, roughness: 0, strokeColor: "#1e1e1e", backgroundColor: "#ffd8a8", fillStyle: "solid" as const, label: { text: p.text, fontFamily: FONT_FAMILY.Nunito, fontSize: 24 } };
        return { type: "text" as const, x, y, text: p.text, fontFamily: FONT_FAMILY.Nunito, fontSize: 24 };
      };
      addElements(parts.map(toSkeleton) as Parameters<typeof convertToExcalidrawElements>[0], false);
      requestAnimationFrame(() => api.scrollToContent(undefined, { fitToContent: true, animate: true }));
    },
    [api, editable, viewCenter, addElements],
  );

  const insertLink = useCallback(
    (label: string, href: string, color: string) => {
      if (!api || !editable) return;
      const center = viewCenter();
      const made = convertToExcalidrawElements([
        { type: "rectangle", x: center.x - 160, y: center.y - 36, width: 320, height: 72, roundness: { type: 3 }, roughness: 0, strokeColor: color, backgroundColor: color, fillStyle: "solid",
          label: { text: label, fontFamily: FONT_FAMILY.Nunito, fontSize: 22, strokeColor: "#ffffff" } },
      ] as Parameters<typeof convertToExcalidrawElements>[0]).map((e) => (e.type === "rectangle" ? { ...e, link: href } : e));
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), ...made],
        appState: made[0] ? { selectedElementIds: { [made[0].id]: true } } : undefined,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api, editable, viewCenter],
  );

  const linkTask = useCallback(
    (stickyId: string, task: { id: string; key: string; href: string }) => {
      if (!api) return;
      const next = api.getSceneElementsIncludingDeleted().map((e) =>
        e.id === stickyId ? { ...e, link: task.href, customData: { ...e.customData, task: { id: task.id, key: task.key } }, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } : e,
      );
      api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    },
    [api],
  );

  useEffect(() => {
    if (api) onReady?.({ insertTemplate, linkTask, insertLink });
  }, [api, insertTemplate, linkTask, insertLink, onReady]);

  // ---- Real-time co-editing ------------------------------------------------------
  const sceneOf = useCallback(
    (all: readonly unknown[], appState: { viewBackgroundColor: string; gridModeEnabled: boolean }): BoardScene => ({
      elements: all as BoardElement[],
      appState: { viewBackgroundColor: appState.viewBackgroundColor, ...(appState.gridModeEnabled ? { gridModeEnabled: true } : {}) },
      files: { ...stored.current },
    }),
    [],
  );
  useEffect(() => {
    if (!api || !live) return;
    live.bind({
      scene: () => sceneOf(api.getSceneElementsIncludingDeleted(), api.getAppState()),
      apply: (part) => {
        for (const [fileId, link] of Object.entries(part.files ?? {})) {
          if (stored.current[fileId]) continue;
          stored.current[fileId] = link;
          fetchPicture(fileId, link);
        }
        const state = api.getAppState();
        let elements: BoardElement[] | null = null;
        if (part.elements?.length) {
          // What the person is changing right now stays theirs until they finish.
          const busy = new Set<string>(
            [state.editingTextElement?.id, state.resizingElement?.id, state.newElement?.id].filter((id): id is string => Boolean(id)),
          );
          if (state.selectedElementsAreBeingDragged) Object.keys(state.selectedElementIds).forEach((id) => busy.add(id));
          elements = mergeElements(api.getSceneElementsIncludingDeleted() as unknown as BoardElement[], part.elements, busy);
        }
        const look = part.appState;
        if (look) grid.current = Boolean(look.gridModeEnabled);
        if (!elements && !look) return;
        api.updateScene({
          ...(elements ? { elements: elements as never } : {}),
          ...(look ? { appState: { viewBackgroundColor: look.viewBackgroundColor ?? state.viewBackgroundColor, gridModeEnabled: Boolean(look.gridModeEnabled) } } : {}),
          // Others' changes never enter this person's undo.
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      },
    });
    return () => live.bind(null);
    // The live object changes on every render; its bind is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, live?.bind, sceneOf, fetchPicture]);

  // Own cursor with the selection and the middle of the view (for those who follow).
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const sendCursor = useCallback(() => {
    if (!api || !live?.active) return;
    const state = api.getAppState();
    const zoom = state.zoom.value;
    const at = pointer.current;
    live.sendCursor({
      x: at?.x ?? Number.NaN,
      y: at?.y ?? Number.NaN,
      at: "board",
      sel: Object.keys(state.selectedElementIds).filter((id) => state.selectedElementIds[id]).slice(0, 50),
      view: { x: -state.scrollX + state.width / 2 / zoom, y: -state.scrollY + state.height / 2 / zoom, z: zoom },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, live?.active, live?.sendCursor]);

  // Following someone: this view goes where theirs goes; any own action stops it.
  const followed = live?.following ? live.cursors[live.following] : undefined;
  const followView = followed?.view;
  useEffect(() => {
    if (!api || !followView) return;
    const state = api.getAppState();
    const z = followView.z;
    api.updateScene({
      appState: { scrollX: -followView.x + state.width / 2 / z, scrollY: -followView.y + state.height / 2 / z, zoom: { value: z as never } },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [api, followView]);
  const stopFollowing = () => {
    if (live?.following) live.follow(null);
  };

  // The sticky notes with their text (a note's text is in the text bound to it).
  const stickies = useMemo(() => {
    const textOf = new Map(elements.filter((e) => e.type === "text" && e.containerId && !e.isDeleted).map((e) => [e.containerId!, (e.text ?? "").trim()]));
    return elements
      .filter((e) => e.customData?.sticky && !e.isDeleted)
      .map((e) => ({ element: e, info: { id: e.id, text: textOf.get(e.id) ?? "", task: (e.customData?.task as StickyInfo["task"]) ?? null } }));
  }, [elements]);
  useEffect(() => {
    onStickies?.(stickies.map((s) => s.info));
  }, [stickies, onStickies]);

  // S adds a sticky note (unless typing somewhere).
  useEffect(() => {
    const element = box.current;
    if (!element || !editable) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() !== "s" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target?.closest("input, textarea, [contenteditable=true]") || api?.getAppState().editingTextElement) return;
      event.preventDefault();
      event.stopPropagation();
      addSticky(color);
    };
    element.addEventListener("keydown", onKey, true);
    return () => element.removeEventListener("keydown", onKey, true);
  }, [api, addSticky, color, editable]);

  const toScreen = (x: number, y: number) => ({ left: (x + view.scrollX) * view.zoom, top: (y + view.scrollY) * view.zoom });
  const showMarks = Boolean(votes && (votes.open || votes.show));
  const byId = useMemo(() => (live?.active ? new Map(elements.map((e) => [e.id, e])) : null), [live?.active, elements]);

  return (
    <div
      ref={box}
      className="relative h-full w-full"
      data-board-canvas
      data-board-stickies={stickies.length}
      onPointerDownCapture={stopFollowing}
      onWheelCapture={stopFollowing}
      onKeyDownCapture={stopFollowing}
      onPointerMoveCapture={(event) => {
        if (!api || !live?.active) return;
        // Screen → board coordinates.
        const state = api.getAppState();
        const zoom = state.zoom.value;
        pointer.current = { x: (event.clientX - state.offsetLeft) / zoom - state.scrollX, y: (event.clientY - state.offsetTop) / zoom - state.scrollY };
        sendCursor();
      }}
      onPointerLeave={() => {
        pointer.current = null;
        if (live?.active) live.sendCursor(null);
      }}
    >
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={{
          elements: initial.elements as never,
          appState: {
            viewBackgroundColor: initial.appState.viewBackgroundColor ?? (theme === "dark" ? "#121212" : "#ffffff"),
            gridModeEnabled: Boolean(initial.appState.gridModeEnabled),
            currentItemRoughness: 0,
            currentItemFontFamily: FONT_FAMILY.Nunito,
            currentItemRoundness: "round",
          },
          scrollToContent: true,
        }}
        viewModeEnabled={!editable}
        theme={theme === "dark" ? "dark" : "light"}
        langCode={currentLocale() === "en" ? "en" : "uk-UA"}
        aiEnabled={false}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: canExport, toggleTheme: null, clearCanvas: editable, changeViewBackgroundColor: editable },
          // Pictures (step Д3b) only where they can be stored.
          tools: { image: Boolean(shortId && boardId) },
        }}
        onScrollChange={(scrollX, scrollY, zoom) => {
          setView({ scrollX, scrollY, zoom: zoom.value });
          sendCursor();
        }}
        renderTopRightUI={(isMobile) =>
          editable ? (
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1" role="group" aria-label={b.sticky}>
              {/* On a phone only the current colour fits next to the tools. */}
              {(isMobile ? [color] : (Object.keys(STICKY_COLORS) as StickyColor[])).map((key) => (
                <button
                  key={key}
                  type="button"
                  title={key === color ? b.stickyHint : b.stickyColor(b.stickyColors[key])}
                  aria-label={b.stickyColor(b.stickyColors[key])}
                  aria-pressed={key === color}
                  data-sticky-color={key}
                  onClick={() => {
                    setColor(key);
                    addSticky(key);
                  }}
                  className={`h-8 w-8 rounded ${key === color ? "ring-2 ring-accent" : ""}`}
                  style={{ background: STICKY_COLORS[key] }}
                />
              ))}
            </div>
          ) : null
        }
        onChange={(next, appState, files) => {
          setElements(next as readonly Element[]);
          if (editable) {
            for (const [fileId, file] of Object.entries(files)) {
              if (!stored.current[fileId] && file.dataURL) void upload(fileId, file.dataURL, file.mimeType);
            }
          }
          setView((v) => (v.scrollX === appState.scrollX && v.scrollY === appState.scrollY && v.zoom === appState.zoom.value ? v : { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value }));
          const selected = Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]);
          // A sticky note, or the text inside one, being the only thing selected.
          const one = selected.length === 1 ? next.find((e) => e.id === selected[0]) : null;
          const note = one && "containerId" in one && one.containerId ? next.find((e) => e.id === one.containerId) : one;
          onSelect?.(note?.customData?.sticky ? note.id : null);
          if (!editable) return;
          const key = `${hashElementsVersion(next)}:${appState.viewBackgroundColor}:${appState.gridModeEnabled}`;
          if (last.current === null) {
            // The first call is the scene as loaded.
            last.current = key;
            return;
          }
          if (key === last.current) return;
          last.current = key;
          // Live: the room shares the change and one editor saves for everyone.
          if (live?.changed(sceneOf(next, appState))) return;
          onChange(dataOf(next, appState));
        }}
      >
        <MainMenu>
          {canExport && <MainMenu.DefaultItems.SaveAsImage />}
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          {editable && <MainMenu.DefaultItems.ClearCanvas />}
          <MainMenu.Separator />
          {editable && <MainMenu.DefaultItems.ChangeCanvasBackground />}
        </MainMenu>
      </Excalidraw>

      {/* Over the canvas: votes and task chips on sticky notes. */}
      <div className="pointer-events-none absolute inset-0 z-[3] overflow-hidden" aria-hidden={!showMarks && !chips}>
        {stickies.map(({ element: e, info }) => {
          const corner = toScreen(e.x + e.width, e.y);
          const bottom = toScreen(e.x, e.y + e.height);
          const count = votes?.tally[e.id] ?? 0;
          const mine = votes?.mine.includes(e.id) ?? false;
          const chip = info.task ? chips?.[info.task.id] : undefined;
          return (
            <div key={e.id}>
              {showMarks && (votes!.open || count > 0) && (
                <button
                  type="button"
                  disabled={!votes!.open}
                  onClick={() => onVote?.(e.id)}
                  aria-label={b.voting.vote(count)}
                  title={b.voting.vote(count)}
                  data-vote={e.id}
                  data-votes={count}
                  className={`pointer-events-auto absolute flex h-8 min-w-8 -translate-x-full items-center justify-center gap-0.5 rounded-full border px-2 text-sm font-semibold shadow ${mine ? "border-accent bg-accent text-white" : "border-border bg-background text-foreground"}`}
                  style={{ left: corner.left - 4, top: corner.top + 4 }}
                >
                  {mine ? <Icon name="check" size={14} /> : votes!.open ? <Icon name="plus" size={14} /> : null}
                  {count > 0 ? count : ""}
                </button>
              )}
              {info.task && (
                <a
                  href={e.link ?? undefined}
                  className="pointer-events-auto absolute flex max-w-48 -translate-y-full items-center gap-1 truncate rounded-full border border-border bg-background px-2 py-0.5 text-xs shadow"
                  style={{ left: bottom.left + 4, top: bottom.top - 4 }}
                  data-sticky-task={info.task.key}
                >
                  <Icon name={chip?.done ? "check-circle" : "task"} size={12} />
                  <span className={chip?.done ? "line-through" : ""}>{info.task.key}</span>
                  {chip && <span className="truncate text-muted">· {chip.status}</span>}
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* Others in the room: their cursors and outlines of what they have selected. */}
      {live?.active && byId && (
        <div className="pointer-events-none absolute inset-0 z-[4] overflow-hidden" data-live-layer>
          {live.peers
            .filter((p) => !p.me && live.cursors[p.key]?.at === "board")
            .map((p) => {
              const c = live.cursors[p.key];
              const label = p.name.length > 24 ? `${p.name.slice(0, 23)}…` : p.name;
              const spot = Number.isFinite(c.x) && Number.isFinite(c.y) ? toScreen(c.x, c.y) : null;
              return (
                <div key={p.key} data-live-cursor={p.name}>
                  {c.sel.map((id) => {
                    const e = byId.get(id);
                    if (!e || e.isDeleted) return null;
                    const from = toScreen(Math.min(e.x, e.x + e.width), Math.min(e.y, e.y + e.height));
                    return (
                      <div
                        key={id}
                        className="absolute rounded-sm border-2 border-dashed"
                        style={{ left: from.left - 3, top: from.top - 3, width: Math.abs(e.width) * view.zoom + 6, height: Math.abs(e.height) * view.zoom + 6, borderColor: p.color }}
                        data-live-selection
                      />
                    );
                  })}
                  {spot && (
                    <div className="absolute" style={{ left: spot.left, top: spot.top, transition: "left 180ms linear, top 180ms linear" }}>
                      <svg width="14" height="21" viewBox="0 0 14 21" aria-hidden>
                        <path d="M0,0 L0,17 L4.5,13 L7.5,20 L10.5,18.8 L7.6,12 L13,12 Z" fill={p.color} stroke="#fff" strokeWidth={1.2} />
                      </svg>
                      <span className="absolute left-3 top-[18px] whitespace-nowrap rounded px-1.5 py-0.5 text-xs text-white" style={{ background: p.color }}>
                        {label}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {chooser && (
        <div className="absolute inset-x-4 top-20 z-10 mx-auto max-w-lg rounded-xl border border-border border border-border-strong bg-overlay p-4 shadow-2xl" role="dialog" aria-label={b.templates.title} data-template-chooser>
          <p className="font-medium">{b.templates.title}</p>
          <p className="mt-1 text-sm text-muted">{b.templates.intro}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["retro", "brainstorm", "journey", "swot", "kanban", "grid"] as TemplateKey[]).map((key) => (
              <button key={key} type="button" onClick={() => insertTemplate(key)} className="min-h-11 rounded-lg border border-border px-3 text-left text-sm hover:bg-surface">
                {b.templates.names[key]}
              </button>
            ))}
            <button type="button" onClick={() => setChooser(false)} className="min-h-11 rounded-lg border border-border px-3 text-left text-sm text-muted hover:bg-surface">
              {b.templates.empty}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
