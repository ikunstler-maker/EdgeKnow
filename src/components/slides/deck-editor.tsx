"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { t } from "@/i18n";
import { SLIDE_H, SLIDE_W, makeNode, newId, type Deck, type NodeType, type Slide, type SlideNode } from "@/lib/slides";
import { THEMES, TEMPLATES, applyTheme, templateSlide, themeOf, type SlideTemplate } from "@/lib/slide-themes";
import { align, boxOf, distribute, intersects, snap, unionBox, type AlignMode, type Guide } from "@/lib/slide-guides";
import { DesignPanel } from "./inspector";
import { LayersPanel } from "./layers-panel";
import { NodeShape, SlideView } from "./slide-view";

const s = t.slides;
type Tool = "select" | NodeType;
type Drag =
  | { kind: "move"; start: { x: number; y: number }; before: Deck; origin: Map<string, { x: number; y: number }> }
  | { kind: "resize"; handle: string; start: { x: number; y: number }; before: Deck; node: SlideNode }
  | { kind: "rotate"; before: Deck; node: SlideNode }
  | { kind: "draw"; start: { x: number; y: number }; before: Deck; id: string }
  | { kind: "marquee"; start: { x: number; y: number }; add: string[] };

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const LINEAR = (type: NodeType) => type === "LINE" || type === "ARROW";
const iconButton = "flex h-11 min-w-11 items-center justify-center rounded-md border border-border px-2 text-sm hover:bg-surface disabled:opacity-40 md:h-9 md:min-w-9";
const HISTORY = 100;

// The slide editor: slides on the left (drag to reorder), the slide on a canvas that
// fits the space (zoom in and out), tools on top, the selected layer's look on the
// right. Every change goes through commit(), which also feeds undo/redo and saving.
export function DeckEditor({ shortId, deckId, initial, editable, onChange }: { shortId: string; deckId: string; initial: Deck; editable: boolean; onChange: (deck: Deck) => void }) {
  const [deck, setDeck] = useState(initial);
  const deckRef = useRef(deck);
  const [past, setPast] = useState<Deck[]>([]);
  const [future, setFuture] = useState<Deck[]>([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [sideTab, setSideTab] = useState<"design" | "layers">("design");
  const [template, setTemplate] = useState<SlideTemplate>("titleText");
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);
  const clipboard = useRef<SlideNode[]>([]);
  const [fit, setFit] = useState(0.5);
  const dndId = useId();

  const slideIndex = Math.min(current, deck.slides.length - 1);
  const slide = deck.slides[slideIndex];
  const one = selected.length === 1 ? slide.nodes.find((n) => n.id === selected[0]) : undefined;

  // The scale at which the slide fits the space.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setFit(Math.max(0.05, Math.min((el.clientWidth - 32) / SLIDE_W, (el.clientHeight - 32) / SLIDE_H)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scale = fit * zoom;

  // A new state of the deck; record=false while dragging (the drag records once at the end).
  const commit = useCallback(
    (next: Deck, record = true, before?: Deck) => {
      if (!editable) return;
      if (record) {
        setPast((list) => [...list.slice(-HISTORY + 1), before ?? deckRef.current]);
        setFuture([]);
      }
      deckRef.current = next;
      setDeck(next);
      onChange(next);
    },
    [editable, onChange],
  );
  const updateSlide = (change: (slide: Slide) => Slide, record = true, before?: Deck) =>
    commit({ ...deckRef.current, slides: deckRef.current.slides.map((x, i) => (i === slideIndex ? change(x) : x)) }, record, before);
  const updateNodes = (ids: string[], change: (node: SlideNode) => SlideNode, record = true, before?: Deck) =>
    updateSlide((x) => ({ ...x, nodes: x.nodes.map((n) => (ids.includes(n.id) ? change(n) : n)) }), record, before);

  const undo = () => {
    const prev = past.at(-1);
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([deckRef.current, ...future]);
    deckRef.current = prev;
    setDeck(prev);
    onChange(prev);
    setSelected([]);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, deckRef.current]);
    deckRef.current = next;
    setDeck(next);
    onChange(next);
    setSelected([]);
  };

  const removeSelected = () => {
    if (!selected.length) return;
    updateSlide((x) => ({ ...x, nodes: x.nodes.filter((n) => !selected.includes(n.id)) }));
    setSelected([]);
  };
  const paste = (nodes: SlideNode[]) => {
    if (!nodes.length) return;
    const copies = nodes.map((n) => ({ ...n, id: newId(), x: n.x + 40, y: n.y + 40 }));
    updateSlide((x) => ({ ...x, nodes: [...x.nodes, ...copies] }));
    setSelected(copies.map((n) => n.id));
  };

  // Pictures: uploaded as the deck's files, then placed in the middle of the slide.
  const addImage = async (file: File) => {
    if (!editable || !file.type.startsWith("image/")) return;
    setNotice(s.uploading);
    const response = await fetch(`/api/boards/files?ws=${shortId}&board=${deckId}&name=${encodeURIComponent(file.name || "image")}`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { ok: boolean; id?: string; error?: string } | null;
    if (!result?.ok || !result.id) return setNotice(s.errors[result?.error ?? ""] ?? s.imageFailed);
    const size = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 });
      img.onerror = () => resolve({ w: 800, h: 600 });
      img.src = URL.createObjectURL(file);
    });
    const k = Math.min(1, 1200 / size.w, 800 / size.h);
    const w = Math.round(size.w * k);
    const h = Math.round(size.h * k);
    const node = { ...makeNode("IMAGE", (SLIDE_W - w) / 2, (SLIDE_H - h) / 2, w, h, s.names), imageId: result.id };
    updateSlide((x) => ({ ...x, nodes: [...x.nodes, node] }));
    setSelected([node.id]);
    setNotice(null);
  };

  // Paste: a picture from the clipboard, or the layers copied here.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!editable || editing || !wrapRef.current?.contains(document.activeElement)) return;
      const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      event.preventDefault();
      if (file) void addImage(file);
      else paste(clipboard.current);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const point = (event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * SLIDE_W, y: ((event.clientY - rect.top) / rect.height) * SLIDE_H };
  };

  const onCanvasDown = (event: React.PointerEvent) => {
    wrapRef.current?.focus();
    if (!editable || event.button !== 0) return;
    const at = point(event);
    if (tool !== "select") {
      const node = makeNode(tool, at.x, at.y, LINEAR(tool) ? 0 : 1, LINEAR(tool) ? 0 : 1, s.names);
      const before = deckRef.current;
      drag.current = { kind: "draw", start: at, before, id: node.id };
      updateSlide((x) => ({ ...x, nodes: [...x.nodes, node] }), false);
      setSelected([node.id]);
      (event.target as Element).setPointerCapture?.(event.pointerId);
      return;
    }
    setEditing(null);
    // A drag on empty space selects what the frame touches (Shift adds).
    drag.current = { kind: "marquee", start: at, add: event.shiftKey ? selected : [] };
    if (!event.shiftKey) setSelected([]);
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  // A layer in a group brings the whole group.
  const withGroups = (ids: string[]) => {
    const groups = new Set(slide.nodes.filter((n) => ids.includes(n.id) && n.groupId).map((n) => n.groupId));
    return slide.nodes.filter((n) => ids.includes(n.id) || (n.groupId && groups.has(n.groupId))).map((n) => n.id);
  };

  const onNodeDown = (event: React.PointerEvent, node: SlideNode) => {
    event.stopPropagation();
    wrapRef.current?.focus();
    if (event.button !== 0) return;
    // Locked layers are picked only in the layers panel; a click passes through them.
    if (!editable || tool !== "select" || node.locked) return onCanvasDown(event);
    if (editing === node.id) return;
    const group = withGroups([node.id]);
    const ids = event.shiftKey ? (selected.includes(node.id) ? selected.filter((x) => !group.includes(x)) : [...selected, ...group]) : selected.includes(node.id) ? selected : group;
    setSelected(ids);
    const origin = new Map(slide.nodes.filter((n) => ids.includes(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]));
    drag.current = { kind: "move", start: point(event), before: deckRef.current, origin };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  };

  const onHandleDown = (event: React.PointerEvent, handle: string) => {
    event.stopPropagation();
    if (!one || !editable) return;
    drag.current = handle === "rotate" ? { kind: "rotate", before: deckRef.current, node: one } : { kind: "resize", handle, start: point(event), before: deckRef.current, node: one };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  };

  const onMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const at = point(event);
    if (d.kind === "marquee") {
      const box = { x: Math.min(at.x, d.start.x), y: Math.min(at.y, d.start.y), width: Math.abs(at.x - d.start.x), height: Math.abs(at.y - d.start.y) };
      setMarquee(box);
      const hit = slide.nodes.filter((n) => !n.hidden && !n.locked && intersects(box, boxOf(n))).map((n) => n.id);
      setSelected([...new Set([...d.add, ...withGroups(hit)])]);
    } else if (d.kind === "move") {
      let dx = at.x - d.start.x;
      let dy = at.y - d.start.y;
      // Smart guides: edges and centres meet those of the slide and the other layers (Alt: off).
      const moving = slide.nodes.filter((n) => d.origin.has(n.id)).map((n) => ({ ...n, x: d.origin.get(n.id)!.x + dx, y: d.origin.get(n.id)!.y + dy }));
      const box = unionBox(moving);
      if (box && !event.altKey) {
        const found = snap(box, slide.nodes.filter((n) => !d.origin.has(n.id) && !n.hidden), 8 / scale);
        dx += found.dx;
        dy += found.dy;
        setGuides(found.guides);
      } else setGuides([]);
      updateNodes([...d.origin.keys()], (n) => ({ ...n, x: Math.round(d.origin.get(n.id)!.x + dx), y: Math.round(d.origin.get(n.id)!.y + dy) }), false);
    } else if (d.kind === "draw") {
      updateNodes([d.id], (n) =>
        LINEAR(n.type)
          ? { ...n, width: Math.round(at.x - d.start.x), height: Math.round(at.y - d.start.y) }
          : { ...n, x: Math.round(Math.min(at.x, d.start.x)), y: Math.round(Math.min(at.y, d.start.y)), width: Math.max(1, Math.round(Math.abs(at.x - d.start.x))), height: Math.max(1, Math.round(Math.abs(at.y - d.start.y))) },
        false,
      );
    } else if (d.kind === "rotate") {
      const n = d.node;
      const angle = (Math.atan2(at.y - (n.y + n.height / 2), at.x - (n.x + n.width / 2)) * 180) / Math.PI + 90;
      const snapped = event.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle);
      updateNodes([n.id], (x) => ({ ...x, rotation: ((snapped % 360) + 360) % 360 }), false);
    } else {
      const n = d.node;
      const dx = at.x - d.start.x;
      const dy = at.y - d.start.y;
      if (LINEAR(n.type)) {
        updateNodes([n.id], (x) => (d.handle === "start" ? { ...x, x: Math.round(n.x + dx), y: Math.round(n.y + dy), width: Math.round(n.width - dx), height: Math.round(n.height - dy) } : { ...x, width: Math.round(n.width + dx), height: Math.round(n.height + dy) }), false);
        return;
      }
      let { x, y, width, height } = n;
      if (d.handle.includes("e")) width = n.width + dx;
      if (d.handle.includes("s")) height = n.height + dy;
      if (d.handle.includes("w")) {
        width = n.width - dx;
        x = n.x + dx;
      }
      if (d.handle.includes("n")) {
        height = n.height - dy;
        y = n.y + dy;
      }
      // Shift (and pictures by default) keeps the proportions.
      if ((event.shiftKey || n.type === "IMAGE") && d.handle.length === 2) {
        const k = Math.max(width / n.width, height / n.height);
        if (d.handle.includes("w")) x = n.x + n.width - n.width * k;
        if (d.handle.includes("n")) y = n.y + n.height - n.height * k;
        width = n.width * k;
        height = n.height * k;
      }
      if (width < 8) {
        if (d.handle.includes("w")) x = n.x + n.width - 8;
        width = 8;
      }
      if (height < 8) {
        if (d.handle.includes("n")) y = n.y + n.height - 8;
        height = 8;
      }
      updateNodes([n.id], (node) => ({ ...node, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }), false);
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setGuides([]);
    setMarquee(null);
    if (!d || d.kind === "marquee") return;
    if (d.kind === "draw") {
      const made = deckRef.current.slides[slideIndex].nodes.find((n) => n.id === d.id);
      // A click without a drag makes a layer of a usual size.
      if (made && !LINEAR(made.type) && made.width < 10 && made.height < 10) {
        const size = made.type === "TEXT" ? { w: 900, h: 160 } : { w: 400, h: 300 };
        updateNodes([made.id], (n) => ({ ...n, width: size.w, height: size.h, x: Math.round(n.x - (made.type === "TEXT" ? 0 : size.w / 2)), y: Math.round(n.y - (made.type === "TEXT" ? 0 : size.h / 2)) }), false);
      }
      if (made && LINEAR(made.type) && Math.abs(made.width) < 10 && Math.abs(made.height) < 10) updateNodes([made.id], (n) => ({ ...n, width: 400 }), false);
      if (made?.type === "TEXT") setEditing(made.id);
      setTool("select");
    }
    if (JSON.stringify(d.before) !== JSON.stringify(deckRef.current)) commit(deckRef.current, true, d.before);
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (editing || (event.target as HTMLElement).tagName === "INPUT" || (event.target as HTMLElement).tagName === "TEXTAREA" || (event.target as HTMLElement).tagName === "SELECT") return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z" && !event.shiftKey) return (event.preventDefault(), undo());
    if (mod && (key === "y" || (key === "z" && event.shiftKey))) return (event.preventDefault(), redo());
    if (!editable) return;
    if (mod && key === "c") return void (clipboard.current = slide.nodes.filter((n) => selected.includes(n.id)));
    if (mod && key === "d") return (event.preventDefault(), paste(slide.nodes.filter((n) => selected.includes(n.id))));
    if (mod && key === "a") return (event.preventDefault(), setSelected(slide.nodes.filter((n) => !n.hidden && !n.locked).map((n) => n.id)));
    if (mod && key === "g" && event.shiftKey) return (event.preventDefault(), ungroup());
    if (mod && key === "g") return (event.preventDefault(), group());
    if (mod && (event.key === "]" || event.key === "[")) return (event.preventDefault(), reorder(event.key === "]" ? "front" : "back"));
    if (event.key === "Delete" || event.key === "Backspace") return (event.preventDefault(), removeSelected());
    if (event.key === "Escape") return (setSelected([]), setTool("select"));
    if (event.key === "Enter" && one?.type === "TEXT") return (event.preventDefault(), setEditing(one.id));
    if (event.key.startsWith("Arrow") && selected.length) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      return updateNodes(selected, (n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
    }
    if (mod) return;
    const tools: Record<string, Tool> = { v: "select", t: "TEXT", r: "RECTANGLE", o: "ELLIPSE", l: "LINE", a: "ARROW" };
    if (tools[key]) setTool(tools[key]);
  };

  // Groups, order, alignment (step П-2).
  const group = () => {
    if (selected.length < 2) return;
    const id = newId();
    updateNodes(selected, (n) => ({ ...n, groupId: id }));
  };
  const ungroup = () => updateNodes(selected, (n) => ({ ...n, groupId: undefined }));
  const reorder = (to: "front" | "back") => {
    if (!selected.length) return;
    updateSlide((x) => {
      const picked = x.nodes.filter((n) => selected.includes(n.id));
      const rest = x.nodes.filter((n) => !selected.includes(n.id));
      return { ...x, nodes: to === "front" ? [...rest, ...picked] : [...picked, ...rest] };
    });
  };
  const moveLayer = (id: string, toIndex: number) =>
    updateSlide((x) => {
      const nodes = x.nodes.filter((n) => n.id !== id);
      const moved = x.nodes.find((n) => n.id === id)!;
      nodes.splice(Math.max(0, Math.min(nodes.length, toIndex)), 0, moved);
      return { ...x, nodes };
    });
  const place = (spots: Map<string, { x: number; y: number }>) => spots.size && updateNodes([...spots.keys()], (n) => ({ ...n, ...spots.get(n.id)! }));
  const picked = slide.nodes.filter((n) => selected.includes(n.id));

  // Slides: add after the current one, duplicate, delete, reorder.
  const placeholders = { title: s.placeholders.title, subtitle: s.placeholders.subtitle, text: s.placeholders.text, caption: s.placeholders.caption };
  const addSlide = () => {
    const next = [...deck.slides];
    next.splice(slideIndex + 1, 0, templateSlide(template, themeOf(deck), placeholders));
    commit({ ...deck, slides: next });
    setCurrent(slideIndex + 1);
    setSelected([]);
  };
  const duplicateSlide = () => {
    const copy = { ...slide, id: newId(), nodes: slide.nodes.map((n) => ({ ...n, id: newId() })) };
    const next = [...deck.slides];
    next.splice(slideIndex + 1, 0, copy);
    commit({ ...deck, slides: next });
    setCurrent(slideIndex + 1);
  };
  const deleteSlide = () => {
    if (deck.slides.length < 2) return;
    commit({ ...deck, slides: deck.slides.filter((_, i) => i !== slideIndex) });
    setCurrent(Math.max(0, slideIndex - 1));
    setSelected([]);
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }), useSensor(KeyboardSensor));
  const onSlideDrop = (event: DragEndEvent) => {
    const from = deck.slides.findIndex((x) => x.id === event.active.id);
    const to = deck.slides.findIndex((x) => x.id === event.over?.id);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...deck.slides];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit({ ...deck, slides: next });
    setCurrent(to);
  };

  const box = one && !LINEAR(one.type) ? one : null;
  const handleSize = 14 / scale;

  return (
    <div className="mt-3 flex flex-1 flex-col gap-2" data-deck-editor>
      {editable && (
        <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label={s.canvas}>
          {(["select", "TEXT", "RECTANGLE", "ELLIPSE", "LINE", "ARROW"] as Tool[]).map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={tool === x}
              title={s.tools[x === "select" ? "select" : x === "TEXT" ? "text" : x === "RECTANGLE" ? "rect" : x === "ELLIPSE" ? "ellipse" : x === "LINE" ? "line" : "arrow"]}
              aria-label={s.tools[x === "select" ? "select" : x === "TEXT" ? "text" : x === "RECTANGLE" ? "rect" : x === "ELLIPSE" ? "ellipse" : x === "LINE" ? "line" : "arrow"]}
              onClick={() => setTool(x)}
              className={`${iconButton} ${tool === x ? "border-accent bg-accent/10" : ""}`}
              data-tool={x}
            >
              {x === "select" ? "↖" : x === "TEXT" ? "T" : x === "RECTANGLE" ? "▭" : x === "ELLIPSE" ? "◯" : x === "LINE" ? "╱" : "➚"}
            </button>
          ))}
          <button type="button" title={s.tools.image} aria-label={s.tools.image} onClick={() => fileRef.current?.click()} className={iconButton} data-tool="IMAGE">
            🖼
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            aria-label={s.tools.image}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void addImage(file);
            }}
          />
          <span className="mx-1 h-6 w-px bg-border" />
          <button type="button" title={s.undo} aria-label={s.undo} disabled={!past.length} onClick={undo} className={iconButton} data-undo>
            ↶
          </button>
          <button type="button" title={s.redo} aria-label={s.redo} disabled={!future.length} onClick={redo} className={iconButton} data-redo>
            ↷
          </button>
          <span className="mx-1 h-6 w-px bg-border" />
          <button type="button" title={s.zoomOut} aria-label={s.zoomOut} onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))} className={iconButton}>
            −
          </button>
          <button type="button" title={s.zoomFit} onClick={() => setZoom(1)} className={iconButton}>
            {Math.round(scale * 100)}%
          </button>
          <button type="button" title={s.zoomIn} aria-label={s.zoomIn} onClick={() => setZoom((z) => Math.min(8, z * 1.25))} className={iconButton}>
            +
          </button>
          <span className="mx-1 h-6 w-px bg-border" />
          <label className="flex items-center gap-1 text-sm">
            <span className="sr-only md:not-sr-only">{s.theme}</span>
            <select
              value={themeOf(deck).id}
              onChange={(e) => commit(applyTheme(deckRef.current, THEMES.find((x) => x.id === e.target.value) ?? THEMES[0]))}
              className="min-h-11 rounded-md border border-border bg-background px-2 text-sm md:min-h-9"
              aria-label={s.theme}
              data-theme-select
            >
              {THEMES.map((x) => (
                <option key={x.id} value={x.id}>
                  {s.themes[x.id]}
                </option>
              ))}
            </select>
          </label>
          {notice && (
            <span role="status" className="ml-2 text-sm text-muted">
              {notice}
            </span>
          )}
        </div>
      )}

      <div className="flex min-h-[460px] flex-1 flex-col gap-2 md:flex-row">
        {/* Slides */}
        <DndContext id={dndId} sensors={sensors} onDragEnd={onSlideDrop}>
          <nav aria-label={s.slides} className="flex shrink-0 gap-2 overflow-auto md:w-44 md:flex-col" data-slide-list>
            {deck.slides.map((x, i) => (
              <SlideThumb key={x.id} slide={x} index={i} active={i === slideIndex} shortId={shortId} draggable={editable} onPick={() => (setCurrent(i), setSelected([]), setEditing(null))} />
            ))}
            {editable && (
              <div className="flex shrink-0 gap-1 md:flex-col">
                <select value={template} onChange={(e) => setTemplate(e.target.value as SlideTemplate)} aria-label={s.templateLabel} title={s.templateLabel} className="min-h-11 rounded-md border border-border bg-background px-1 text-xs md:min-h-9" data-slide-template>
                  {TEMPLATES.map((x) => (
                    <option key={x} value={x}>
                      {s.templates[x]}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={addSlide} className={iconButton} data-add-slide>
                  {s.addSlide}
                </button>
                <button type="button" onClick={duplicateSlide} title={s.duplicateSlide} aria-label={s.duplicateSlide} className={iconButton}>
                  ⧉
                </button>
                <button type="button" onClick={deleteSlide} disabled={deck.slides.length < 2} title={s.deleteSlide} aria-label={s.deleteSlide} className={iconButton}>
                  🗑
                </button>
              </div>
            )}
          </nav>
        </DndContext>

        {/* Canvas */}
        <div
          ref={wrapRef}
          tabIndex={0}
          onKeyDown={onKey}
          onDragOver={(e) => editable && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
            if (file) void addImage(file);
          }}
          className="relative min-h-[320px] min-w-0 flex-1 overflow-auto rounded-lg bg-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-[#090B0E]"
          data-deck-canvas
        >
          <div className="flex min-h-full min-w-full items-center justify-center p-4" style={{ width: SLIDE_W * scale + 32, height: SLIDE_H * scale + 32 }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${SLIDE_W} ${SLIDE_H}`}
              width={SLIDE_W * scale}
              height={SLIDE_H * scale}
              className={`shrink-0 touch-none shadow-xl ${tool !== "select" ? "cursor-crosshair" : ""}`}
              onPointerDown={onCanvasDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              role="img"
              aria-label={s.slideN(slideIndex + 1)}
            >
              <rect x={0} y={0} width={SLIDE_W} height={SLIDE_H} fill={slide.background} />
              {slide.nodes.filter((node) => !node.hidden).map((node) => (
                <g
                  key={node.id}
                  onPointerDown={(e) => onNodeDown(e, node)}
                  onDoubleClick={() => editable && node.type === "TEXT" && setEditing(node.id)}
                  className={editable && tool === "select" ? "cursor-move" : undefined}
                  data-node={node.type}
                >
                  <NodeShape node={node} shortId={shortId} editingText={editing === node.id} />
                  {/* A wider invisible stroke so thin lines are easy to grab. */}
                  {LINEAR(node.type) && <line x1={node.x} y1={node.y} x2={node.x + node.width} y2={node.y + node.height} stroke="transparent" strokeWidth={Math.max(24, (node.strokeWidth ?? 8) + 16)} />}
                  {node.type === "TEXT" && !node.text && editing !== node.id && (
                    <rect x={node.x} y={node.y} width={node.width} height={node.height} fill="transparent" stroke="#94a3b8" strokeDasharray="12 8" strokeWidth={2 / scale} />
                  )}
                  {editing === node.id && (
                    <foreignObject x={node.x} y={node.y} width={node.width} height={node.height} transform={node.rotation ? `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})` : undefined}>
                      <textarea
                        autoFocus
                        defaultValue={node.text}
                        placeholder={s.textHint}
                        aria-label={s.names.TEXT}
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
                        }}
                        onBlur={(e) => {
                          const text = e.target.value;
                          setEditing(null);
                          if (!text.trim()) {
                            updateSlide((x) => ({ ...x, nodes: x.nodes.filter((n) => n.id !== node.id) }));
                            setSelected([]);
                          } else if (text !== node.text) updateNodes([node.id], (n) => ({ ...n, text }));
                        }}
                        style={{
                          width: "100%",
                          height: "100%",
                          fontSize: node.fontSize ?? 64,
                          lineHeight: 1.2,
                          color: node.color ?? "#111827",
                          fontWeight: node.bold ? 700 : 400,
                          textAlign: node.align ?? "left",
                          background: "transparent",
                          border: "none",
                          outline: "2px solid #3b82f6",
                          resize: "none",
                          padding: 0,
                          fontFamily: "inherit",
                        }}
                        data-text-editor
                      />
                    </foreignObject>
                  )}
                </g>
              ))}
              {/* Smart guides and the selection frame */}
              {guides.map((g, i) =>
                g.axis === "x" ? (
                  <line key={i} x1={g.at} y1={0} x2={g.at} y2={SLIDE_H} stroke="#f43f5e" strokeWidth={1.5 / scale} pointerEvents="none" data-guide />
                ) : (
                  <line key={i} x1={0} y1={g.at} x2={SLIDE_W} y2={g.at} stroke="#f43f5e" strokeWidth={1.5 / scale} pointerEvents="none" data-guide />
                ),
              )}
              {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} fill="#3b82f622" stroke="#3b82f6" strokeWidth={1.5 / scale} pointerEvents="none" data-marquee />}
              {/* Selection */}
              {slide.nodes
                .filter((n) => selected.includes(n.id))
                .map((n) =>
                  LINEAR(n.type) ? (
                    <g key={`sel-${n.id}`}>
                      {[
                        { h: "start", x: n.x, y: n.y },
                        { h: "end", x: n.x + n.width, y: n.y + n.height },
                      ].map((p) => (
                        <circle key={p.h} cx={p.x} cy={p.y} r={handleSize / 1.4} fill="#fff" stroke="#3b82f6" strokeWidth={2 / scale} className="cursor-pointer" onPointerDown={(e) => one && onHandleDown(e, p.h)} onPointerMove={onMove} onPointerUp={onUp} />
                      ))}
                    </g>
                  ) : (
                    <rect
                      key={`sel-${n.id}`}
                      x={n.x}
                      y={n.y}
                      width={n.width}
                      height={n.height}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth={2 / scale}
                      pointerEvents="none"
                      transform={n.rotation ? `rotate(${n.rotation} ${n.x + n.width / 2} ${n.y + n.height / 2})` : undefined}
                    />
                  ),
                )}
              {editable && box && editing !== box.id && (
                <g transform={box.rotation ? `rotate(${box.rotation} ${box.x + box.width / 2} ${box.y + box.height / 2})` : undefined} data-selection-handles>
                  <line x1={box.x + box.width / 2} y1={box.y} x2={box.x + box.width / 2} y2={box.y - 40 / scale} stroke="#3b82f6" strokeWidth={2 / scale} />
                  <circle cx={box.x + box.width / 2} cy={box.y - 40 / scale} r={handleSize / 1.4} fill="#fff" stroke="#3b82f6" strokeWidth={2 / scale} className="cursor-grab" onPointerDown={(e) => onHandleDown(e, "rotate")} onPointerMove={onMove} onPointerUp={onUp} data-handle="rotate" />
                  {HANDLES.map((h) => {
                    const hx = h.includes("w") ? box.x : h.includes("e") ? box.x + box.width : box.x + box.width / 2;
                    const hy = h.includes("n") ? box.y : h.includes("s") ? box.y + box.height : box.y + box.height / 2;
                    return (
                      <rect
                        key={h}
                        x={hx - handleSize / 2}
                        y={hy - handleSize / 2}
                        width={handleSize}
                        height={handleSize}
                        fill="#fff"
                        stroke="#3b82f6"
                        strokeWidth={2 / scale}
                        style={{ cursor: `${h}-resize` }}
                        onPointerDown={(e) => onHandleDown(e, h)}
                        onPointerMove={onMove}
                        onPointerUp={onUp}
                        data-handle={h}
                      />
                    );
                  })}
                </g>
              )}
            </svg>
          </div>
        </div>

        {/* Design and layers */}
        {editable && (
          <aside className="shrink-0 space-y-3 overflow-y-auto text-sm md:max-h-[calc(100dvh-12rem)] md:w-64" aria-label={s.sideTabs[sideTab]} data-deck-inspector>
            <div className="flex gap-1" role="tablist">
              {(["design", "layers"] as const).map((tab) => (
                <button key={tab} type="button" role="tab" aria-selected={sideTab === tab} onClick={() => setSideTab(tab)} className={`min-h-11 flex-1 rounded-md border text-sm md:min-h-9 ${sideTab === tab ? "border-accent bg-accent/10" : "border-border"}`} data-side-tab={tab}>
                  {s.sideTabs[tab]}
                </button>
              ))}
            </div>
            {sideTab === "layers" ? (
              <LayersPanel
                slide={slide}
                selected={selected}
                onSelect={(ids, add) => setSelected(add ? [...new Set([...selected, ...ids])] : ids)}
                onNode={(id, change) => updateNodes([id], change)}
                onReorder={moveLayer}
              />
            ) : picked.length > 1 ? (
              <div className="space-y-3">
                <p className="text-muted">{s.selectedCount(picked.length)}</p>
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{s.alignTitle}</legend>
                  <div className="grid grid-cols-3 gap-1">
                    {(["left", "centerX", "right", "top", "middle", "bottom"] as AlignMode[]).map((m) => (
                      <button key={m} type="button" onClick={() => place(align(picked, m))} className={iconButton} title={s.aligns[m]} aria-label={s.aligns[m]} data-align={m}>
                        {{ left: "⇤", centerX: "↔", right: "⇥", top: "⤒", middle: "↕", bottom: "⤓" }[m]}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button type="button" disabled={picked.length < 3} onClick={() => place(distribute(picked, "x"))} className={iconButton} title={s.distributeX} aria-label={s.distributeX}>
                      ⋯
                    </button>
                    <button type="button" disabled={picked.length < 3} onClick={() => place(distribute(picked, "y"))} className={iconButton} title={s.distributeY} aria-label={s.distributeY}>
                      ⋮
                    </button>
                  </div>
                </fieldset>
              </div>
            ) : (
              <DesignPanel node={one ?? null} slide={slide} onNode={(change) => one && updateNodes([one.id], change)} onSlide={(change) => updateSlide(change)} />
            )}
            {picked.length > 0 && (
              <fieldset className="space-y-2 border-t border-border pt-3">
                <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{s.arrange}</legend>
                <div className="grid grid-cols-2 gap-1">
                  <button type="button" onClick={group} disabled={picked.length < 2} className={iconButton} data-group>
                    ▣ {s.group.split(" (")[0]}
                  </button>
                  <button type="button" onClick={ungroup} disabled={!picked.some((n) => n.groupId)} className={iconButton} data-ungroup>
                    ▢ {s.ungroup.split(" (")[0]}
                  </button>
                  <button type="button" onClick={() => reorder("front")} className={iconButton} title={s.toFront} aria-label={s.toFront}>
                    ⬆
                  </button>
                  <button type="button" onClick={() => reorder("back")} className={iconButton} title={s.toBack} aria-label={s.toBack}>
                    ⬇
                  </button>
                </div>
                <button type="button" onClick={removeSelected} className={`${iconButton} w-full text-danger`} data-delete-node>
                  🗑 {s.deleteNode}
                </button>
              </fieldset>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function SlideThumb({ slide, index, active, shortId, draggable, onPick }: { slide: Slide; index: number; active: boolean; shortId: string; draggable: boolean; onPick: () => void }) {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: slide.id, disabled: !draggable });
  const { setNodeRef, transform, isDragging, listeners, attributes } = useDraggable({ id: slide.id, disabled: !draggable });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div
      ref={(node) => {
        dropRef(node);
        setNodeRef(node);
      }}
      style={style}
      className={`relative w-36 shrink-0 md:w-full ${isDragging ? "z-20 opacity-80" : ""}`}
      data-slide-thumb={index + 1}
    >
      <button
        type="button"
        {...(draggable ? listeners : {})}
        {...(draggable ? attributes : {})}
        onClick={onPick}
        aria-current={active ? "true" : undefined}
        aria-label={draggable ? s.dragSlide(index + 1) : s.slideN(index + 1)}
        className={`block w-full touch-none overflow-hidden rounded-md border-2 ${active ? "border-accent" : isOver ? "border-accent/60" : "border-border"}`}
      >
        <SlideView slide={slide} shortId={shortId} className="block aspect-video w-full" />
      </button>
      <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/50 px-1 text-xs text-white">{index + 1}</span>
    </div>
  );
}
