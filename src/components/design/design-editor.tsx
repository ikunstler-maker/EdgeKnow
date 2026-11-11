"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { EMBED_KINDS, makeNode, newId, type EmbedKind, type NodeType, type PathPoint, type SlideNode } from "@/lib/slides";
import {
  ancestors,
  applyConstraints,
  childrenOf,
  cloneTree,
  descendants,
  emptyPage,
  fitGroups,
  frameAt,
  isContainer,
  layoutAll,
  moveTree,
  removeTree,
  reparent,
  type DesignDoc,
  type DesignPage,
} from "@/lib/design";
import { align, boxOf, distribute, intersects, snap, unionBox, type AlignMode, type Guide } from "@/lib/slide-guides";
import { NodeShape, pointsPath } from "@/components/slides/slide-view";
import { DesignPanel } from "@/components/slides/inspector";
import { DesignLayers } from "./design-layers";
import { ChildPanel, FramePanel, PaintsPanel, PrototypePanel, Section } from "./design-inspector";
import { exportFrame } from "./design-export";
import { TaskFromText } from "./task-from-text";
import { Icon } from "@/components/ui/icon";
import { ALIGN_ICON, TOOL_ICON } from "@/components/slides/tool-icons";

const g = t.design;
const s = t.slides;
type Tool = "select" | "hand" | "pen" | NodeType;
type Cam = { x: number; y: number; z: number };
type Drag =
  | { kind: "pan"; sx: number; sy: number; cam: Cam }
  | { kind: "move"; start: { x: number; y: number }; before: DesignDoc; ids: string[] }
  | { kind: "resize"; handle: string; start: { x: number; y: number }; before: DesignDoc; node: SlideNode }
  | { kind: "draw"; start: { x: number; y: number }; before: DesignDoc; id: string }
  | { kind: "marquee"; start: { x: number; y: number }; add: string[] }
  | { kind: "point"; index: number; part: "p" | "in" | "out"; before: DesignDoc; id: string }
  | { kind: "noodle"; from: string; at: { x: number; y: number } };

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const LINEAR = (type: NodeType) => type === "LINE" || type === "ARROW";
const btn = "flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm hover:bg-white/10 disabled:opacity-40";
// The editor is always dark; shared panels read these colour tokens.
const DARK = { "--background": "#151922", "--foreground": "#f3f4f6", "--muted": "#9ca3af", "--border": "rgba(255,255,255,.12)", "--surface": "#1d2230" } as React.CSSProperties;
const STYLE_KEYS = ["fill", "gradient", "fills", "stroke", "strokes", "strokeWidth", "dash", "radius", "shadow", "innerShadow", "blur", "bgBlur", "opacity", "color", "fontSize", "fontFamily", "bold", "italic", "underline", "lineHeight", "align", "vAlign"] as const;

// The design editor (Bordy «Дизайн»): pages, an endless canvas, frames with nesting, the
// layer tree, design and prototype panels. Every change goes through commit() (undo,
// saving); auto layouts are recomputed after each change.
export function DesignEditor({ shortId, fileId, initial, editable, onChange, onPlay }: { shortId: string; fileId: string; initial: DesignDoc; editable: boolean; onChange: (doc: DesignDoc) => void; onPlay: (path: string) => void }) {
  const [doc, setDoc] = useState(initial);
  const docRef = useRef(doc);
  const [past, setPast] = useState<DesignDoc[]>([]);
  const [future, setFuture] = useState<DesignDoc[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [cam, setCam] = useState<Cam>({ x: -100, y: -100, z: 1 });
  const [view, setView] = useState({ w: 800, h: 600 });
  const [editing, setEditing] = useState<string | null>(null);
  const [pathEdit, setPathEdit] = useState<string | null>(null);
  const [pen, setPen] = useState<PathPoint[] | null>(null);
  const [mode, setMode] = useState<"design" | "prototype">("design");
  const [side, setSide] = useState<"layers" | "pages">("layers");
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [noodle, setNoodle] = useState<{ from: string; x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const svgFileRef = useRef<HTMLInputElement>(null);
  const fillTarget = useRef<{ id: string; index: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const clipboard = useRef<SlideNode[]>([]);
  const styleClip = useRef<Partial<SlideNode> | null>(null);
  const fitted = useRef(false);

  const page = doc.pages[Math.min(pageIndex, doc.pages.length - 1)];
  const nodes = page.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const one = selected.length === 1 ? byId.get(selected[0]) : undefined;
  const picked = nodes.filter((n) => selected.includes(n.id));

  // ---- state changes -------------------------------------------------------------------------
  const commit = useCallback(
    (next: DesignDoc, record = true, before?: DesignDoc) => {
      if (!editable) return;
      if (record) {
        setPast((list) => [...list.slice(-99), before ?? docRef.current]);
        setFuture([]);
      }
      docRef.current = next;
      setDoc(next);
      onChange(next);
    },
    [editable, onChange],
  );
  const pageAt = (d: DesignDoc) => d.pages[Math.min(pageIndex, d.pages.length - 1)];
  const withPage = (d: DesignDoc, change: (p: DesignPage) => DesignPage): DesignDoc => ({ ...d, pages: d.pages.map((p, i) => (i === Math.min(pageIndex, d.pages.length - 1) ? change(p) : p)) });
  // Layers of the page from `base` (default: now), then layouts.
  const setNodes = (change: (list: SlideNode[]) => SlideNode[], record = true, base?: DesignDoc) =>
    commit(withPage(base ?? docRef.current, (p) => ({ ...p, nodes: layoutAll(change(p.nodes)) })), record, base);
  const update = (ids: string[], change: (n: SlideNode) => SlideNode) => setNodes((list) => list.map((n) => (ids.includes(n.id) ? change(n) : n)));

  const undo = () => {
    const prev = past.at(-1);
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([docRef.current, ...future]);
    docRef.current = prev;
    setDoc(prev);
    onChange(prev);
    setSelected([]);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, docRef.current]);
    docRef.current = next;
    setDoc(next);
    onChange(next);
    setSelected([]);
  };

  // ---- camera ----------------------------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setCam((c) => {
        if (e.ctrlKey || e.metaKey) {
          const z = Math.min(16, Math.max(0.05, c.z * Math.exp(-e.deltaY * 0.01)));
          const px = c.x + (e.clientX - rect.left) / c.z;
          const py = c.y + (e.clientY - rect.top) / c.z;
          return { z, x: px - (e.clientX - rect.left) / z, y: py - (e.clientY - rect.top) / z };
        }
        return { ...c, x: c.x + (e.shiftKey ? e.deltaY : e.deltaX) / c.z, y: c.y + (e.shiftKey ? 0 : e.deltaY) / c.z };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, []);
  const fitAll = useCallback(() => {
    const list = pageAt(docRef.current).nodes.filter((n) => !n.parentId && !n.hidden);
    const box = unionBox(list);
    if (!box) return setCam({ x: -100, y: -100, z: 1 });
    const z = Math.min(2, Math.max(0.05, Math.min(view.w / (box.width + 160), view.h / (box.height + 160))));
    setCam({ z, x: box.x + box.width / 2 - view.w / 2 / z, y: box.y + box.height / 2 - view.h / 2 / z });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.w, view.h, pageIndex]);
  useEffect(() => {
    if (fitted.current || view.w < 50) return;
    fitted.current = true;
    const id = requestAnimationFrame(fitAll);
    return () => cancelAnimationFrame(id);
  }, [view.w, fitAll]);

  const point = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: cam.x + (e.clientX - rect.left) / cam.z, y: cam.y + (e.clientY - rect.top) / cam.z };
  };

  // ---- pictures and SVG ----------------------------------------------------------------------
  const upload = async (file: File) => {
    setNotice(s.uploading);
    const response = await fetch(`/api/boards/files?ws=${shortId}&board=${fileId}&name=${encodeURIComponent(file.name || "image")}`, { method: "POST", headers: { "Content-Type": file.type }, body: file }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { ok: boolean; id?: string; error?: string } | null;
    if (!result?.ok || !result.id) {
      setNotice(s.errors[result?.error ?? ""] ?? s.imageFailed);
      return null;
    }
    setNotice(null);
    return result.id;
  };
  const center = () => ({ x: cam.x + view.w / 2 / cam.z, y: cam.y + view.h / 2 / cam.z });
  const addImage = async (file: File) => {
    if (!editable || !file.type.startsWith("image/") || file.type === "image/svg+xml") return file.type === "image/svg+xml" ? importSvg(file) : undefined;
    const id = await upload(file);
    if (!id) return;
    const size = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
      img.onerror = () => resolve({ w: 400, h: 300 });
      img.src = URL.createObjectURL(file);
    });
    // An image fill for the layer that asked for it, otherwise a picture layer.
    if (fillTarget.current) {
      const { id: target, index } = fillTarget.current;
      fillTarget.current = null;
      return update([target], (n) => ({ ...n, fills: (n.fills ?? []).map((f, i) => (i === index ? { kind: "image", imageId: id, fit: f.kind === "image" ? f.fit : "fill" } : f)) }));
    }
    const c = center();
    const node = { ...makeNode("IMAGE", Math.round(c.x - size.w / 2), Math.round(c.y - size.h / 2), size.w, size.h, s.names), imageId: id, parentId: frameAt(nodes, c.x, c.y)?.id };
    setNodes((list) => [...list, node]);
    setSelected([node.id]);
  };
  // SVG: its shapes become paths in a group (editable look, movable as one).
  const importSvg = async (file: File) => {
    try {
      const text = await file.text();
      const svg = new DOMParser().parseFromString(text, "image/svg+xml").querySelector("svg");
      if (!svg) throw new Error("no svg");
      const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
      const w = vb.length === 4 ? vb[2] : Number(svg.getAttribute("width")) || 100;
      const h = vb.length === 4 ? vb[3] : Number(svg.getAttribute("height")) || 100;
      const ox = vb.length === 4 ? vb[0] : 0;
      const oy = vb.length === 4 ? vb[1] : 0;
      const k = Math.min(1, 600 / Math.max(w, h)) || 1;
      const c = center();
      const gx = Math.round(c.x - (w * k) / 2);
      const gy = Math.round(c.y - (h * k) / 2);
      const group: SlideNode = { ...makeNode("GROUP", gx, gy, w * k, h * k, s.names), name: file.name.replace(/\.svg$/i, "").slice(0, 80) || "SVG" };
      const shapes: SlideNode[] = [];
      const toPath = (el: Element): string | null => {
        const a = (n: string) => Number(el.getAttribute(n) || 0);
        switch (el.tagName.toLowerCase()) {
          case "path":
            return el.getAttribute("d");
          case "rect":
            return `M${a("x")},${a("y")} h${a("width")} v${a("height")} h${-a("width")} Z`;
          case "circle":
            return `M${a("cx") - a("r")},${a("cy")} a${a("r")},${a("r")} 0 1,0 ${2 * a("r")},0 a${a("r")},${a("r")} 0 1,0 ${-2 * a("r")},0 Z`;
          case "ellipse":
            return `M${a("cx") - a("rx")},${a("cy")} a${a("rx")},${a("ry")} 0 1,0 ${2 * a("rx")},0 a${a("rx")},${a("ry")} 0 1,0 ${-2 * a("rx")},0 Z`;
          case "polygon":
          case "polyline": {
            const pts = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
            let d = "";
            for (let i = 0; i + 1 < pts.length; i += 2) d += `${i ? "L" : "M"}${pts[i]},${pts[i + 1]} `;
            return d + (el.tagName.toLowerCase() === "polygon" ? "Z" : "");
          }
        }
        return null;
      };
      svg.querySelectorAll("path, rect, circle, ellipse, polygon, polyline").forEach((el, i) => {
        const d = toPath(el);
        if (!d || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/.test(d)) return;
        const fillAttr = el.getAttribute("fill") ?? (el as SVGElement).style?.fill;
        const strokeAttr = el.getAttribute("stroke");
        // The path in viewBox units, moved so the viewBox starts at 0.
        const moved = ox || oy ? `M${-ox},${-oy}` : "";
        void moved;
        shapes.push({
          ...makeNode("VECTOR", gx, gy, w * k, h * k, s.names),
          name: `${s.names.VECTOR} ${i + 1}`,
          parentId: group.id,
          points: undefined,
          d: ox || oy ? d.replace(/^\s*[Mm]/, (m) => m) : d,
          dW: w,
          dH: h,
          fill: fillAttr && fillAttr !== "none" ? (fillAttr.startsWith("#") ? fillAttr : "#111827") : "none",
          stroke: strokeAttr && strokeAttr !== "none" ? (strokeAttr.startsWith("#") ? strokeAttr : "#111827") : "none",
          strokeWidth: Number(el.getAttribute("stroke-width")) || (strokeAttr ? 1 : 0),
          closed: true,
        });
      });
      if (!shapes.length) throw new Error("empty");
      setNodes((list) => [...list, group, ...shapes]);
      setSelected([group.id]);
    } catch {
      setNotice(g.svgFailed);
    }
  };

  // ---- structure -------------------------------------------------------------------------------
  const pasteNodes = (list: SlideNode[]) => {
    if (!list.length) return;
    const tops = list.filter((n) => !list.some((x) => x.id === n.parentId));
    const copies = cloneTree(list.concat(), tops.map((n) => n.id), 24, 24);
    setNodes((all) => [...all, ...copies]);
    setSelected(copies.filter((c) => !copies.some((x) => x.id === c.parentId)).map((c) => c.id));
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!editable || editing || !wrapRef.current?.contains(document.activeElement)) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      e.preventDefault();
      if (file) void addImage(file);
      else pasteNodes(clipboard.current);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });
  const copySelection = () => (clipboard.current = nodes.filter((n) => selected.some((id) => id === n.id || descendants(nodes, id).includes(n.id))));
  const removeSelected = () => {
    if (!selected.length) return;
    setNodes((list) => removeTree(list, selected));
    setSelected([]);
  };
  // The common parent of the picked layers (for grouping and framing).
  const commonParent = () => {
    const parents = new Set(picked.map((n) => n.parentId ?? null));
    return parents.size === 1 ? [...parents][0] : null;
  };
  const wrap = (type: "GROUP" | "FRAME") => {
    if (!picked.length || (type === "GROUP" && picked.length < 2)) return;
    const box = unionBox(picked)!;
    const container: SlideNode = { ...makeNode(type, Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height), s.names), parentId: commonParent() ?? undefined, ...(type === "FRAME" ? { fill: "#ffffff", clip: false } : {}) };
    setNodes((list) => {
      let out = [...list, container];
      for (const id of selected) out = reparent(out, id, container.id);
      return out;
    });
    setSelected([container.id]);
  };
  const ungroup = () => {
    const groups = picked.filter((n) => n.type === "GROUP");
    if (!groups.length) return;
    setNodes((list) => {
      let out = list;
      for (const grp of groups) {
        for (const kid of out.filter((n) => n.parentId === grp.id)) out = reparent(out, kid.id, grp.parentId ?? null);
        out = out.filter((n) => n.id !== grp.id);
      }
      return out;
    });
    setSelected([]);
  };
  const reorder = (to: "front" | "back") =>
    setNodes((list) => {
      const pickedSet = new Set(selected);
      const moving = list.filter((n) => pickedSet.has(n.id));
      const rest = list.filter((n) => !pickedSet.has(n.id));
      return to === "front" ? [...rest, ...moving] : [...moving, ...rest];
    });
  const placeSpots = (spots: Map<string, { x: number; y: number }>) =>
    setNodes((list) => {
      let out = list;
      for (const [id, pos] of spots) {
        const n = out.find((x) => x.id === id)!;
        out = moveTree(out, [id], pos.x - n.x, pos.y - n.y);
      }
      return out;
    });
  // From the layer tree: into a container, or after a layer under its parent.
  const dropLayer = (id: string, onto: string, inside: boolean) =>
    setNodes((list) => {
      if (inside) return reparent(list, id, onto);
      const target = list.find((n) => n.id === onto)!;
      let out = reparent(list, id, target.parentId ?? null);
      const block = [id, ...descendants(out, id)];
      const moving = out.filter((n) => block.includes(n.id));
      out = out.filter((n) => !block.includes(n.id));
      const at = out.findIndex((n) => n.id === onto);
      out.splice(at + 1, 0, ...moving);
      return out;
    });

  // ---- pointer ---------------------------------------------------------------------------------
  const startPan = (e: React.PointerEvent) => {
    drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, cam };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onCanvasDown = (e: React.PointerEvent) => {
    wrapRef.current?.focus();
    if (e.button === 1 || tool === "hand" || space) return startPan(e);
    if (!editable || e.button !== 0) return;
    const at = point(e);
    if (tool === "pen") return penDown(at);
    if (tool !== "select") {
      const frame = frameAt(nodes, at.x, at.y);
      const node = { ...makeNode(tool, at.x, at.y, LINEAR(tool) ? 0 : 1, LINEAR(tool) ? 0 : 1, s.names), ...(frame ? { parentId: frame.id } : {}) };
      if (tool === "TEXT") Object.assign(node, { fontSize: 24 });
      if (tool === "FRAME") node.name = `${s.names.FRAME} ${nodes.filter((n) => n.type === "FRAME").length + 1}`;
      drag.current = { kind: "draw", start: at, before: docRef.current, id: node.id };
      setNodes((list) => [...list, node], false);
      setSelected([node.id]);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    setEditing(null);
    setPathEdit(null);
    drag.current = { kind: "marquee", start: at, add: e.shiftKey ? selected : [] };
    if (!e.shiftKey) setSelected([]);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  // A click picks the outermost group around the layer (double-click enters it).
  const targetOf = (n: SlideNode) => {
    const groups = ancestors(nodes, n.id).filter((id) => byId.get(id)?.type === "GROUP");
    const outer = groups.at(-1);
    return outer && !selected.some((s2) => s2 === outer || descendants(nodes, outer).includes(s2)) ? outer : n.id;
  };
  const onNodeDown = (e: React.PointerEvent, n: SlideNode) => {
    e.stopPropagation();
    wrapRef.current?.focus();
    if (e.button === 1 || tool === "hand" || space) return startPan(e);
    if (e.button !== 0) return;
    if (!editable || tool !== "select" || n.locked) return onCanvasDown(e);
    if (editing === n.id) return;
    const id = targetOf(n);
    const ids = e.shiftKey ? (selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]) : selected.includes(id) ? selected : [id];
    setSelected(ids);
    if (mode === "prototype") return;
    drag.current = { kind: "move", start: point(e), before: docRef.current, ids };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onHandleDown = (e: React.PointerEvent, handle: string) => {
    e.stopPropagation();
    if (!one || !editable) return;
    drag.current = { kind: "resize", handle, start: point(e), before: docRef.current, node: one };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (pen && !d) return setPenHover(point(e));
    if (!d) return;
    if (d.kind === "pan") return setCam({ ...d.cam, x: d.cam.x - (e.clientX - d.sx) / d.cam.z, y: d.cam.y - (e.clientY - d.sy) / d.cam.z });
    const at = point(e);
    if (d.kind === "noodle") return setNoodle({ from: d.from, x: at.x, y: at.y });
    if (d.kind === "marquee") {
      const box = { x: Math.min(at.x, d.start.x), y: Math.min(at.y, d.start.y), width: Math.abs(at.x - d.start.x), height: Math.abs(at.y - d.start.y) };
      setMarquee(box);
      const hit = nodes.filter((n) => !n.hidden && !n.locked && !n.parentId && intersects(box, boxOf(n))).map((n) => n.id);
      return setSelected([...new Set([...d.add, ...hit])]);
    }
    const base = pageAt(d.before).nodes;
    if (d.kind === "move") {
      let dx = at.x - d.start.x;
      let dy = at.y - d.start.y;
      const moving = base.filter((n) => d.ids.includes(n.id));
      const box = unionBox(moving.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })));
      if (box && !e.altKey) {
        const skip = new Set(d.ids.flatMap((id) => [id, ...descendants(base, id)]));
        const found = snap(box, base.filter((n) => !skip.has(n.id) && !n.hidden), 6 / cam.z, { w: 0, h: 0 });
        dx += found.dx;
        dy += found.dy;
        setGuides(found.guides.filter((gd) => gd.at !== 0));
      } else setGuides([]);
      return setNodes(() => moveTree(base, d.ids, Math.round(dx), Math.round(dy)), false, d.before);
    }
    if (d.kind === "draw") {
      return setNodes(
        () =>
          base.concat(pageAt(docRef.current).nodes.filter((n) => n.id === d.id)).map((n) =>
            n.id !== d.id
              ? n
              : LINEAR(n.type)
                ? { ...n, width: Math.round(at.x - d.start.x), height: Math.round(at.y - d.start.y) }
                : { ...n, x: Math.round(Math.min(at.x, d.start.x)), y: Math.round(Math.min(at.y, d.start.y)), width: Math.max(1, Math.round(Math.abs(at.x - d.start.x))), height: Math.max(1, Math.round(Math.abs(at.y - d.start.y))) },
          ),
        false,
        d.before,
      );
    }
    if (d.kind === "point") {
      return setNodes(
        () =>
          base.map((n) => {
            if (n.id !== d.id || !n.points) return n;
            const pts = n.points.map((p, i) => {
              if (i !== d.index) return p;
              if (d.part === "in") return { ...p, inX: at.x, inY: at.y, outX: 2 * p.x - at.x, outY: 2 * p.y - at.y };
              if (d.part === "out") return { ...p, outX: at.x, outY: at.y, inX: 2 * p.x - at.x, inY: 2 * p.y - at.y };
              const dx = at.x - p.x;
              const dy = at.y - p.y;
              return { x: at.x, y: at.y, ...(p.inX !== undefined ? { inX: p.inX + dx, inY: (p.inY ?? p.y) + dy } : {}), ...(p.outX !== undefined ? { outX: p.outX + dx, outY: (p.outY ?? p.y) + dy } : {}) };
            });
            return withBox({ ...n, points: pts });
          }),
        false,
        d.before,
      );
    }
    // Resize: frames move their children by constraints, groups and paths scale theirs.
    const n = d.node;
    const dx = at.x - d.start.x;
    const dy = at.y - d.start.y;
    if (LINEAR(n.type)) {
      return setNodes(() => base.map((x) => (x.id !== n.id ? x : d.handle === "start" ? { ...x, x: Math.round(n.x + dx), y: Math.round(n.y + dy), width: Math.round(n.width - dx), height: Math.round(n.height - dy) } : { ...x, width: Math.round(n.width + dx), height: Math.round(n.height + dy) })), false, d.before);
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
    if ((e.shiftKey || n.type === "IMAGE") && d.handle.length === 2) {
      const k = Math.max(width / n.width, height / n.height);
      if (d.handle.includes("w")) x = n.x + n.width - n.width * k;
      if (d.handle.includes("n")) y = n.y + n.height - n.height * k;
      width = n.width * k;
      height = n.height * k;
    }
    width = Math.max(1, width);
    height = Math.max(1, height);
    const after = { ...n, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), ...(n.autoLayout ? { sizeW: d.handle.includes("e") || d.handle.includes("w") ? undefined : n.sizeW, sizeH: d.handle.includes("n") || d.handle.includes("s") ? undefined : n.sizeH } : {}) };
    return setNodes(
      () => {
        let out = base.map((o) => (o.id === n.id ? scaleOwn(o, after) : o));
        if (n.type === "FRAME") out = applyConstraints(out, n, after);
        if (n.type === "GROUP") out = scaleTree(out, n, after);
        return out;
      },
      false,
      d.before,
    );
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGuides([]);
    setMarquee(null);
    if (!d || d.kind === "pan" || d.kind === "marquee") return;
    if (d.kind === "noodle") {
      setNoodle(null);
      const at = point(e);
      const target = frameAt(nodes.filter((n) => !n.parentId), at.x, at.y, new Set([d.from, ...ancestors(nodes, d.from)]));
      if (target) update([d.from], (n) => ({ ...n, interactions: [...(n.interactions ?? []), { id: newId(), trigger: "click", action: "navigate", target: target.id, transition: { kind: "none", duration: 300, easing: "ease" } }] }));
      return;
    }
    if (d.kind === "draw") {
      const made = pageAt(docRef.current).nodes.find((n) => n.id === d.id);
      if (made && !LINEAR(made.type) && made.width < 6 && made.height < 6) {
        const size = made.type === "TEXT" ? { w: 240, h: 40 } : made.type === "FRAME" ? { w: 390, h: 844 } : { w: 120, h: 80 };
        setNodes((list) => list.map((n) => (n.id === made.id ? { ...n, width: size.w, height: size.h, ...(made.type === "FRAME" ? { device: "phone" } : {}) } : n)), false);
      }
      if (made && LINEAR(made.type) && Math.abs(made.width) < 6 && Math.abs(made.height) < 6) setNodes((list) => list.map((n) => (n.id === made.id ? { ...n, width: 120 } : n)), false);
      // A frame drawn around layers takes them in.
      if (made?.type === "FRAME") {
        const box = boxOf(pageAt(docRef.current).nodes.find((n) => n.id === made.id)!);
        setNodes((list) => {
          let out = list;
          for (const n of list.filter((x) => x.id !== made.id && (x.parentId ?? null) === (made.parentId ?? null) && !x.locked)) {
            const b = boxOf(n);
            if (b.x >= box.x && b.y >= box.y && b.x + b.width <= box.x + box.width && b.y + b.height <= box.y + box.height) out = reparent(out, n.id, made.id);
          }
          return out;
        }, false);
      }
      if (made?.type === "TEXT") setEditing(made.id);
      setTool("select");
    }
    if (d.kind === "move") {
      // Dropped into another frame (by its centre): it moves there; in an auto layout, its place follows the drop.
      const now = pageAt(docRef.current).nodes;
      let out = now;
      for (const id of d.ids) {
        const n = out.find((x) => x.id === id);
        if (!n || byId.get(n.parentId ?? "")?.type === "GROUP") continue;
        const b = boxOf(n);
        const skip = new Set([id, ...descendants(out, id)]);
        const into = frameAt(out, b.x + b.width / 2, b.y + b.height / 2, skip);
        if ((into?.id ?? null) !== (n.parentId ?? null)) out = reparent(out, id, into?.id ?? null);
        const parent = into ?? null;
        if (parent?.autoLayout) {
          const row = parent.autoLayout.dir !== "column";
          const sibs = out.filter((x) => x.parentId === parent.id && x.id !== id);
          const mine = row ? b.x : b.y;
          const before = sibs.find((x) => (row ? x.x + x.width / 2 : x.y + x.height / 2) > mine);
          const block = [id, ...descendants(out, id)];
          const moving = out.filter((x) => block.includes(x.id));
          out = out.filter((x) => !block.includes(x.id));
          const at = before ? out.findIndex((x) => x.id === before.id) : out.findIndex((x) => x.id === sibs.at(-1)?.id) + 1;
          out.splice(Math.max(0, at), 0, ...moving);
        }
      }
      if (out !== now) setNodes(() => out, false);
    }
    if (JSON.stringify(d.before) !== JSON.stringify(docRef.current)) commit(docRef.current, true, d.before);
  };

  // ---- pen (step Д-2) --------------------------------------------------------------------------
  const [penHover, setPenHover] = useState<{ x: number; y: number } | null>(null);
  const penDown = (at: { x: number; y: number }) => {
    if (!pen) return setPen([{ x: at.x, y: at.y }]);
    const first = pen[0];
    if (pen.length > 2 && Math.hypot(at.x - first.x, at.y - first.y) < 10 / cam.z) return finishPen(true);
    setPen([...pen, { x: at.x, y: at.y }]);
  };
  // Dragging after a click pulls the point's handles (a curve).
  const penDrag = (e: React.PointerEvent) => {
    if (!pen || !(e.buttons & 1)) return;
    const at = point(e);
    const last = pen[pen.length - 1];
    if (Math.hypot(at.x - last.x, at.y - last.y) < 3 / cam.z) return;
    setPen([...pen.slice(0, -1), { ...last, outX: at.x, outY: at.y, inX: 2 * last.x - at.x, inY: 2 * last.y - at.y }]);
  };
  const finishPen = (closed = false) => {
    if (!pen || pen.length < 2) return setPen(null);
    const frame = frameAt(nodes, pen[0].x, pen[0].y);
    const node = withBox({ ...makeNode("VECTOR", 0, 0, 1, 1, s.names), points: pen, closed, ...(closed ? { fill: "#60a5fa" } : {}), ...(frame ? { parentId: frame.id } : {}) });
    setNodes((list) => [...list, node]);
    setSelected([node.id]);
    setPen(null);
    setTool("select");
  };

  // ---- keys ------------------------------------------------------------------------------------
  const onKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (editing || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === " ") return (e.preventDefault(), setSpace(true));
    if (pen) {
      if (e.key === "Enter") return finishPen(false);
      if (e.key === "Escape") return setPen(null);
    }
    if (mod && key === "z" && !e.shiftKey) return (e.preventDefault(), undo());
    if (mod && (key === "y" || (key === "z" && e.shiftKey))) return (e.preventDefault(), redo());
    if (e.shiftKey && e.key === "!") return fitAll();
    if (mod && (key === "=" || key === "+")) return (e.preventDefault(), setCam((c) => zoomAt(c, 1.25)));
    if (mod && key === "-") return (e.preventDefault(), setCam((c) => zoomAt(c, 0.8)));
    if (!editable) return;
    if (mod && e.altKey && key === "c") return (e.preventDefault(), copyStyle());
    if (mod && e.altKey && key === "v") return (e.preventDefault(), pasteStyle());
    if (mod && e.altKey && key === "g") return (e.preventDefault(), wrap("FRAME"));
    if (mod && key === "c") return copySelection();
    if (mod && key === "d") return (e.preventDefault(), copySelection(), pasteNodes(clipboard.current));
    if (mod && key === "a") return (e.preventDefault(), setSelected(childrenOf(nodes, one?.parentId ?? null).filter((n) => !n.locked && !n.hidden).map((n) => n.id)));
    if (mod && key === "g" && e.shiftKey) return (e.preventDefault(), ungroup());
    if (mod && key === "g") return (e.preventDefault(), wrap("GROUP"));
    if (mod && (e.key === "]" || e.key === "[")) return (e.preventDefault(), reorder(e.key === "]" ? "front" : "back"));
    if (e.shiftKey && key === "a" && one?.type === "FRAME") return update([one.id], (n) => ({ ...n, autoLayout: n.autoLayout ?? { dir: "column", gap: 12, padding: [16, 16, 16, 16], alignMain: "start", alignCross: "start" } }));
    if (e.key === "Delete" || e.key === "Backspace") return (e.preventDefault(), removeSelected());
    if (e.key === "Escape") return (setSelected(one?.parentId ? [one.parentId] : []), setTool("select"), setPathEdit(null));
    if (e.key === "Enter" && one && isContainer(one)) return setSelected(childrenOf(nodes, one.id).map((n) => n.id));
    if (e.key === "Enter" && one?.type === "TEXT") return (e.preventDefault(), setEditing(one.id));
    if (e.key.startsWith("Arrow") && selected.length) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      return setNodes((list) => moveTree(list, selected, e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0));
    }
    if (mod || e.altKey) return;
    const tools: Record<string, Tool> = { v: "select", h: "hand", f: "FRAME", r: "RECTANGLE", o: "ELLIPSE", l: "LINE", a: "ARROW", t: "TEXT", p: "pen" };
    if (tools[key]) setTool(tools[key]);
  };
  const zoomAt = (c: Cam, k: number) => {
    const z = Math.min(16, Math.max(0.05, c.z * k));
    const cx = c.x + view.w / 2 / c.z;
    const cy = c.y + view.h / 2 / c.z;
    return { z, x: cx - view.w / 2 / z, y: cy - view.h / 2 / z };
  };

  // ---- style copy (step Д-4) ---------------------------------------------------------------------
  const copyStyle = () => {
    if (!one) return;
    styleClip.current = Object.fromEntries(STYLE_KEYS.map((k) => [k, one[k]])) as Partial<SlideNode>;
  };
  const pasteStyle = () => styleClip.current && update(selected, (n) => ({ ...n, ...styleClip.current }));

  // ---- pages -----------------------------------------------------------------------------------
  const addPage = () => {
    const next = { ...docRef.current, pages: [...docRef.current.pages, emptyPage(g.pageName(docRef.current.pages.length + 1))] };
    commit(next);
    setPageIndex(next.pages.length - 1);
    setSelected([]);
  };

  // ---- drawing ---------------------------------------------------------------------------------
  const frames = nodes.filter((n) => n.type === "FRAME");
  const renderTree = (pid: string | null): React.ReactNode =>
    childrenOf(nodes, pid)
      .filter((n) => !n.hidden)
      .map((n) => (
        <g key={n.id} data-node={n.type} data-node-id={n.id} data-name={n.name}>
          <g onPointerDown={(e) => onNodeDown(e, n)} onDoubleClick={() => editable && (n.type === "TEXT" ? setEditing(n.id) : n.type === "VECTOR" && n.points ? setPathEdit(n.id) : n.type === "GROUP" ? null : n.type === "EMBED" ? setEditing(n.id) : null)} className={editable && tool === "select" && mode === "design" ? "cursor-default" : undefined}>
            <NodeShape node={n} shortId={shortId} editingText={editing === n.id && n.type === "TEXT"} prefix="d" embeds={n.type === "EMBED" && editing === n.id ? "setup" : "view"} onEmbed={(embed) => update([n.id], (x) => ({ ...x, embed }))} />
            {n.type === "VECTOR" && <path d={n.d ? undefined : pointsPath(n.points ?? [], n.closed)} fill="none" stroke="transparent" strokeWidth={Math.max(10, (n.strokeWidth ?? 2) + 8) / Math.max(1, cam.z)} />}
          </g>
          {isContainer(n) && (
            <g clipPath={n.type === "FRAME" && n.clip ? `url(#clip-${n.id})` : undefined}>
              {n.type === "FRAME" && n.clip && (
                <defs>
                  <clipPath id={`clip-${n.id}`}>
                    <rect x={n.x} y={n.y} width={n.width} height={n.height} />
                  </clipPath>
                </defs>
              )}
              {renderTree(n.id)}
            </g>
          )}
          {editing === n.id && n.type === "TEXT" && (
            <foreignObject x={n.x} y={n.y} width={n.width} height={n.height}>
              <textarea
                autoFocus
                defaultValue={n.text}
                aria-label={s.names.TEXT}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
                }}
                onBlur={(e) => {
                  const text = e.target.value;
                  setEditing(null);
                  if (!text.trim()) return (setNodes((list) => removeTree(list, [n.id])), setSelected([]));
                  if (text !== n.text) update([n.id], (x) => ({ ...x, text, name: x.name === s.names.TEXT ? text.slice(0, 40) : x.name }));
                }}
                style={{ width: "100%", height: "100%", fontSize: n.fontSize ?? 24, lineHeight: n.lineHeight ?? 1.2, color: n.color ?? "#111827", fontWeight: n.bold ? 700 : 400, textAlign: n.align ?? "left", background: "transparent", border: "none", outline: "2px solid #3b82f6", resize: "none", padding: 0, fontFamily: n.fontFamily ?? "inherit" }}
                data-text-editor
              />
            </foreignObject>
          )}
        </g>
      ));

  const sw = 1 / cam.z;
  const box = one && !LINEAR(one.type) ? one : null;
  const hs = 8 * sw;

  // Text to a task (step Д-4).
  const textForTask = one?.type === "TEXT" ? one.text?.trim() : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#090B0E] text-gray-100 [color-scheme:dark]" style={DARK} data-design-editor>
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-white/10 bg-[#151922] px-2 py-1" role="toolbar" aria-label={g.tools.select}>
        {editable &&
          (["select", "hand", "FRAME", "RECTANGLE", "ELLIPSE", "LINE", "ARROW", "TEXT", "pen"] as Tool[]).map((x) => (
            <button key={x} type="button" aria-pressed={tool === x} title={g.tools[x]} aria-label={g.tools[x]} onClick={() => (setTool(x), setPen(null))} className={`${btn} ${tool === x ? "bg-sky-500/30" : ""}`} data-tool={x}>
              <Icon name={TOOL_ICON[x as string]} />
            </button>
          ))}
        {editable && (
          <>
            <button type="button" title={g.tools.image} aria-label={g.tools.image} onClick={() => fileRef.current?.click()} className={btn} data-tool="IMAGE">
              <Icon name="image" />
            </button>
            <button type="button" title={g.tools.svg} aria-label={g.tools.svg} onClick={() => svgFileRef.current?.click()} className={btn} data-tool="SVG">
              SVG
            </button>
            <span className="relative">
              <button type="button" onClick={() => setMenu(!menu)} className={btn} aria-expanded={menu} data-embed-add>
                {s.embeds.add}
              </button>
              {menu && (
                <div className="absolute left-0 z-40 mt-1 w-56 rounded-lg border border-white/10 bg-[#151922] p-1 shadow-xl" role="menu">
                  {EMBED_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const c = center();
                        const node = { ...makeNode("EMBED", Math.round(c.x - 300), Math.round(c.y - 200), 600, 400, s.names), name: s.embeds.kinds[k], embed: { kind: k as EmbedKind, id: "" }, zoom: 1, parentId: frameAt(nodes, c.x, c.y)?.id };
                        setNodes((list) => [...list, node]);
                        setSelected([node.id]);
                        setEditing(node.id);
                        setMenu(false);
                      }}
                      className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-white/10"
                      data-embed-kind={k}
                    >
                      {s.embeds.icons[k]} {s.embeds.kinds[k]}
                    </button>
                  ))}
                </div>
              )}
            </span>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" aria-label={g.tools.image} onChange={(e) => (e.target.files?.[0] && void addImage(e.target.files[0]), (e.target.value = ""))} />
            <input ref={svgFileRef} type="file" accept=".svg,image/svg+xml" className="hidden" aria-label={g.tools.svg} onChange={(e) => (e.target.files?.[0] && void importSvg(e.target.files[0]), (e.target.value = ""))} data-svg-input />
          </>
        )}
        <span className="mx-1 h-5 w-px bg-white/10" />
        <button type="button" onClick={undo} disabled={!past.length} className={btn} title={s.undo} aria-label={s.undo}>
          <Icon name="undo" />
        </button>
        <button type="button" onClick={redo} disabled={!future.length} className={btn} title={s.redo} aria-label={s.redo}>
          <Icon name="redo" />
        </button>
        <span className="mx-1 h-5 w-px bg-white/10" />
        <button type="button" onClick={() => setCam((c) => zoomAt(c, 0.8))} className={btn} aria-label={s.zoomOut}>
          −
        </button>
        <button type="button" onClick={fitAll} className={btn} title={g.zoomFit} data-zoom-fit>
          {Math.round(cam.z * 100)}%
        </button>
        <button type="button" onClick={() => setCam((c) => zoomAt(c, 1.25))} className={btn} aria-label={s.zoomIn}>
          +
        </button>
        <span className="flex-1" />
        {pen && <span className="text-xs opacity-70">{g.pen.hint}</span>}
        {notice && (
          <span role="status" className="text-xs opacity-80">
            {notice}
          </span>
        )}
        <div className="flex rounded-md border border-white/10" role="tablist">
          {(["design", "prototype"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`min-h-9 px-3 text-sm ${mode === m ? "bg-sky-500/30" : ""}`} data-mode={m}>
              {m === "design" ? g.prototype.design : g.prototype.tab}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => onPlay(`/prototype?page=${page.id}`)} className={`${btn} border border-sky-400/50`} data-prototype-play>
          {g.prototype.play}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: pages and layers */}
        <aside className="hidden w-60 shrink-0 flex-col gap-2 overflow-y-auto border-r border-white/10 bg-[#151922] p-2 md:flex" data-design-left>
          <div className="flex gap-1" role="tablist">
            {(["layers", "pages"] as const).map((x) => (
              <button key={x} type="button" role="tab" aria-selected={side === x} onClick={() => setSide(x)} className={`min-h-9 flex-1 rounded-md text-sm ${side === x ? "bg-white/10" : ""}`}>
                {x === "layers" ? g.layers : g.pages}
              </button>
            ))}
          </div>
          {side === "pages" ? (
            <ul className="space-y-0.5" data-design-pages>
              {doc.pages.map((pg, i) => (
                <li key={pg.id} className={`flex items-center gap-1 rounded ${i === pageIndex ? "bg-sky-500/25" : "hover:bg-white/5"}`}>
                  <button
                    type="button"
                    className="min-h-9 min-w-0 flex-1 truncate px-2 text-left text-sm"
                    onClick={() => (setPageIndex(i), setSelected([]), (fitted.current = false))}
                    onDoubleClick={() => {
                      const name = editable ? prompt(g.renamePage, pg.name)?.trim() : null;
                      if (name) commit({ ...docRef.current, pages: docRef.current.pages.map((x) => (x.id === pg.id ? { ...x, name: name.slice(0, 80) } : x)) });
                    }}
                    data-page={pg.name}
                  >
                    {pg.name}
                  </button>
                  {editable && doc.pages.length > 1 && (
                    <button
                      type="button"
                      className="h-9 w-7 text-xs opacity-60 hover:opacity-100"
                      aria-label={g.deletePage}
                      onClick={() => {
                        if (!confirm(g.deletePageConfirm(pg.name))) return;
                        commit({ ...docRef.current, pages: docRef.current.pages.filter((x) => x.id !== pg.id) });
                        setPageIndex(0);
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  )}
                </li>
              ))}
              {editable && (
                <li>
                  <button type="button" onClick={addPage} className={`${btn} w-full justify-start`} data-add-page>
                    {g.addPage}
                  </button>
                </li>
              )}
            </ul>
          ) : (
            <DesignLayers nodes={nodes} selected={selected} onSelect={(ids, add) => setSelected(add ? [...new Set([...selected, ...ids])] : ids)} onNode={(id, change) => update([id], change)} onDrop={dropLayer} />
          )}
        </aside>

        {/* Canvas */}
        <div
          ref={wrapRef}
          tabIndex={0}
          onKeyDown={onKey}
          onKeyUp={(e) => e.key === " " && setSpace(false)}
          onDragOver={(e) => editable && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
            if (file) void addImage(file);
          }}
          className="relative min-w-0 flex-1 overflow-hidden outline-none"
          style={{ background: page.background }}
          data-design-canvas
        >
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`${cam.x} ${cam.y} ${view.w / cam.z} ${view.h / cam.z}`}
            className={`absolute inset-0 touch-none ${space || tool === "hand" ? "cursor-grab" : tool !== "select" ? "cursor-crosshair" : ""}`}
            onPointerDown={onCanvasDown}
            onPointerMove={(e) => (pen && penDrag(e), onMove(e))}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            role="img"
            aria-label={page.name}
          >
            {renderTree(null)}
            {/* Names of top frames (click to pick the frame). */}
            {frames
              .filter((f) => !f.parentId && !f.hidden)
              .map((f) => (
                <text key={`label-${f.id}`} x={f.x} y={f.y - 6 * sw} fontSize={12 * sw} fill={selected.includes(f.id) ? "#38bdf8" : "#9ca3af"} className="cursor-default select-none" onPointerDown={(e) => onNodeDown(e, f)} data-frame-label={f.name}>
                  {f.name}
                </text>
              ))}
            {/* Prototype connections */}
            {mode === "prototype" &&
              nodes.flatMap((n) =>
                (n.interactions ?? [])
                  .filter((it) => it.target && byId.has(it.target))
                  .map((it) => {
                    const to = byId.get(it.target!)!;
                    const x1 = n.x + n.width;
                    const y1 = n.y + n.height / 2;
                    const x2 = to.x;
                    const y2 = to.y + Math.min(40, to.height / 2);
                    const mid = Math.max(40 * sw, Math.abs(x2 - x1) / 2);
                    return <path key={it.id} d={`M${x1},${y1} C${x1 + mid},${y1} ${x2 - mid},${y2} ${x2},${y2}`} fill="none" stroke="#38bdf8" strokeWidth={2 * sw} markerEnd="url(#noodle-arrow)" pointerEvents="none" data-noodle />;
                  }),
              )}
            <defs>
              <marker id="noodle-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#38bdf8" />
              </marker>
            </defs>
            {noodle && byId.get(noodle.from) && (
              <line x1={byId.get(noodle.from)!.x + byId.get(noodle.from)!.width} y1={byId.get(noodle.from)!.y + byId.get(noodle.from)!.height / 2} x2={noodle.x} y2={noodle.y} stroke="#38bdf8" strokeWidth={2 * sw} strokeDasharray={`${6 * sw} ${4 * sw}`} pointerEvents="none" />
            )}
            {/* Guides, marquee, pen draft */}
            {guides.map((gd, i) => (gd.axis === "x" ? <line key={i} x1={gd.at} y1={cam.y} x2={gd.at} y2={cam.y + view.h / cam.z} stroke="#f43f5e" strokeWidth={sw} pointerEvents="none" /> : <line key={i} x1={cam.x} y1={gd.at} x2={cam.x + view.w / cam.z} y2={gd.at} stroke="#f43f5e" strokeWidth={sw} pointerEvents="none" />))}
            {marquee && <rect {...marquee} fill="#38bdf822" stroke="#38bdf8" strokeWidth={sw} pointerEvents="none" />}
            {pen && (
              <g pointerEvents="none">
                <path d={pointsPath(penHover ? [...pen, penHover] : pen)} fill="none" stroke="#38bdf8" strokeWidth={2 * sw} />
                {pen.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={4 * sw} fill={i === 0 ? "#38bdf8" : "#fff"} stroke="#38bdf8" strokeWidth={sw} />
                ))}
              </g>
            )}
            {/* Selection */}
            {picked.map((n) =>
              LINEAR(n.type) ? (
                <g key={`sel-${n.id}`}>
                  {[
                    { h: "start", x: n.x, y: n.y },
                    { h: "end", x: n.x + n.width, y: n.y + n.height },
                  ].map((pnt) => (
                    <circle key={pnt.h} cx={pnt.x} cy={pnt.y} r={hs / 1.4} fill="#fff" stroke="#38bdf8" strokeWidth={sw} onPointerDown={(e) => onHandleDown(e, pnt.h)} onPointerMove={onMove} onPointerUp={onUp} />
                  ))}
                </g>
              ) : (
                <rect key={`sel-${n.id}`} x={n.x} y={n.y} width={n.width} height={n.height} fill="none" stroke="#38bdf8" strokeWidth={1.5 * sw} pointerEvents="none" transform={n.rotation ? `rotate(${n.rotation} ${n.x + n.width / 2} ${n.y + n.height / 2})` : undefined} />
              ),
            )}
            {editable && mode === "design" && box && editing !== box.id && pathEdit !== box.id && (
              <g data-selection-handles>
                {HANDLES.map((h) => {
                  const hx = h.includes("w") ? box.x : h.includes("e") ? box.x + box.width : box.x + box.width / 2;
                  const hy = h.includes("n") ? box.y : h.includes("s") ? box.y + box.height : box.y + box.height / 2;
                  return <rect key={h} x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs} fill="#fff" stroke="#38bdf8" strokeWidth={sw} style={{ cursor: `${h}-resize` }} onPointerDown={(e) => onHandleDown(e, h)} onPointerMove={onMove} onPointerUp={onUp} data-handle={h} />;
                })}
                <text x={box.x + box.width / 2} y={box.y + box.height + 16 * sw} fontSize={11 * sw} fill="#38bdf8" textAnchor="middle" pointerEvents="none">
                  {Math.round(box.width)} × {Math.round(box.height)}
                </text>
              </g>
            )}
            {/* Path points (double-click a path) */}
            {editable && pathEdit && byId.get(pathEdit)?.points?.map((pnt, i) => (
              <g key={`pt-${i}`}>
                {pnt.inX !== undefined && <line x1={pnt.x} y1={pnt.y} x2={pnt.inX} y2={pnt.inY} stroke="#38bdf8" strokeWidth={sw} />}
                {pnt.outX !== undefined && <line x1={pnt.x} y1={pnt.y} x2={pnt.outX} y2={pnt.outY} stroke="#38bdf8" strokeWidth={sw} />}
                {pnt.inX !== undefined && <circle cx={pnt.inX} cy={pnt.inY} r={3.5 * sw} fill="#38bdf8" onPointerDown={(e) => startPoint(e, i, "in")} onPointerMove={onMove} onPointerUp={onUp} />}
                {pnt.outX !== undefined && <circle cx={pnt.outX} cy={pnt.outY} r={3.5 * sw} fill="#38bdf8" onPointerDown={(e) => startPoint(e, i, "out")} onPointerMove={onMove} onPointerUp={onUp} />}
                <rect x={pnt.x - 4 * sw} y={pnt.y - 4 * sw} width={8 * sw} height={8 * sw} fill="#fff" stroke="#38bdf8" strokeWidth={sw} onPointerDown={(e) => startPoint(e, i, "p")} onPointerMove={onMove} onPointerUp={onUp} data-path-point={i} />
              </g>
            ))}
            {/* Prototype: drag the dot to a frame */}
            {editable && mode === "prototype" && one && (
              <circle
                cx={one.x + one.width}
                cy={one.y + one.height / 2}
                r={7 * sw}
                fill="#38bdf8"
                stroke="#fff"
                strokeWidth={2 * sw}
                className="cursor-crosshair"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  drag.current = { kind: "noodle", from: one.id, at: point(e) };
                  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                }}
                onPointerMove={onMove}
                onPointerUp={onUp}
                data-noodle-handle
              />
            )}
          </svg>
          {!nodes.length && <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm opacity-60">{g.empty}</p>}
        </div>

        {/* Right: design / prototype */}
        {editable && (
          <aside className="hidden w-72 shrink-0 space-y-3 overflow-y-auto border-l border-white/10 bg-[#151922] p-3 text-sm md:block" data-design-inspector>
            {mode === "prototype" ? (
              <PrototypePanel
                node={one ?? null}
                page={page}
                frames={frames.filter((f) => !f.parentId && f.id !== one?.id)}
                set={(patch) => one && update([one.id], (n) => ({ ...n, ...patch }))}
                onFlows={(flows) => commit(withPage(docRef.current, (p) => ({ ...p, flows })))}
              />
            ) : picked.length > 1 ? (
              <Section title={s.alignTitle}>
                <div className="grid grid-cols-3 gap-1">
                  {(["left", "centerX", "right", "top", "middle", "bottom"] as AlignMode[]).map((m) => (
                    <button key={m} type="button" onClick={() => placeSpots(align(picked, m))} className={btn} aria-label={s.aligns[m]} title={s.aligns[m]}>
                      <Icon name={ALIGN_ICON[m]} />
                    </button>
                  ))}
                  <button type="button" disabled={picked.length < 3} onClick={() => placeSpots(distribute(picked, "x"))} className={btn} aria-label={s.distributeX}>
                    <Icon name="more" />
                  </button>
                  <button type="button" disabled={picked.length < 3} onClick={() => placeSpots(distribute(picked, "y"))} className={btn} aria-label={s.distributeY}>
                    <Icon name="more" className="rotate-90" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button type="button" onClick={() => wrap("GROUP")} className={btn} data-group>
                    <Icon name="group" className="mr-1 inline" />
                    {s.group.split(" (")[0]}
                  </button>
                  <button type="button" onClick={() => wrap("FRAME")} className={btn} data-wrap-frame>
                    # {g.wrapFrame.split(" (")[0]}
                  </button>
                </div>
              </Section>
            ) : one ? (
              <div className="space-y-3 [&_input]:bg-transparent [&_select]:bg-[#151922]">
                {one.type === "FRAME" && <FramePanel node={one} set={(patch) => update([one.id], (n) => ({ ...n, ...patch }))} />}
                {one.parentId && byId.get(one.parentId)?.type === "FRAME" && <ChildPanel node={one} parent={byId.get(one.parentId)!} set={(patch) => update([one.id], (n) => ({ ...n, ...patch }))} />}
                <DesignPanel
                  node={one}
                  slide={{ id: page.id, background: page.background, nodes: [] }}
                  onNode={(change) => setNodes((list) => {
                    const before = list.find((n) => n.id === one.id)!;
                    const after = change(before);
                    let out = list.map((n) => (n.id === one.id ? scaleOwn(n, after) : n));
                    if (after.x !== before.x || after.y !== before.y) out = moveTree(out.map((n) => (n.id === one.id ? before : n)), [one.id], after.x - before.x, after.y - before.y).map((n) => (n.id === one.id ? { ...after } : n));
                    if (before.type === "FRAME" && (after.width !== before.width || after.height !== before.height)) out = applyConstraints(out, before, after);
                    if (before.type === "GROUP" && (after.width !== before.width || after.height !== before.height)) out = scaleTree(out, before, after);
                    return out;
                  })}
                  onSlide={() => {}}
                />
                {(one.type === "RECTANGLE" || one.type === "ELLIPSE" || one.type === "FRAME" || one.type === "VECTOR") && (
                  <PaintsPanel
                    node={one}
                    set={(patch) => update([one.id], (n) => ({ ...n, ...patch }))}
                    onImageFill={(index) => {
                      fillTarget.current = { id: one.id, index };
                      fileRef.current?.click();
                    }}
                  />
                )}
                <Section title={t.slides.arrange}>
                  <div className="grid grid-cols-2 gap-1">
                    <button type="button" onClick={() => reorder("front")} className={btn} aria-label={s.toFront} title={s.toFront}>
                      <Icon name="upload" />
                    </button>
                    <button type="button" onClick={() => reorder("back")} className={btn} aria-label={s.toBack} title={s.toBack}>
                      <Icon name="download" />
                    </button>
                    <button type="button" onClick={copyStyle} className={btn} title={g.copyStyle}>
                      <Icon name="copy" />
                    </button>
                    <button type="button" onClick={pasteStyle} className={btn} title={g.pasteStyle}>
                      <Icon name="edit" />
                    </button>
                    {one.type === "GROUP" && (
                      <button type="button" onClick={ungroup} className={`${btn} col-span-2`} data-ungroup>
                        {s.ungroup.split(" (")[0]}
                      </button>
                    )}
                    <button type="button" onClick={() => wrap("FRAME")} className={`${btn} col-span-2`}>
                      # {g.wrapFrame.split(" (")[0]}
                    </button>
                    <button type="button" onClick={removeSelected} className={`${btn} col-span-2 text-red-400`} data-delete-node>
                      <Icon name="trash" className="mr-1 inline" />
                      {s.deleteNode}
                    </button>
                  </div>
                </Section>
                {textForTask && <TaskFromText shortId={shortId} title={textForTask} onDone={(msg) => setNotice(msg)} />}
                {one.type === "FRAME" && (
                  <Section title={g.exportTitle}>
                    <div className="grid grid-cols-3 gap-1">
                      {(["png", "svg", "pdf"] as const).map((f) => (
                        <button key={f} type="button" className={btn} onClick={() => void exportFrame(svgRef.current!, one, f).catch(() => setNotice(t.common.unknownError))} data-export={f}>
                          {f.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </Section>
                )}
              </div>
            ) : (
              <Section title={s.background}>
                <input type="color" value={page.background.slice(0, 7)} onChange={(e) => commit(withPage(docRef.current, (p) => ({ ...p, background: e.target.value })))} className="h-9 w-full rounded" aria-label={s.background} />
              </Section>
            )}
          </aside>
        )}
      </div>
    </div>
  );

  function startPoint(e: React.PointerEvent, index: number, part: "p" | "in" | "out") {
    e.stopPropagation();
    if (!pathEdit) return;
    drag.current = { kind: "point", index, part, before: docRef.current, id: pathEdit };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
}

// A path's box follows its points (handles included).
function withBox(n: SlideNode): SlideNode {
  const pts = n.points ?? [];
  if (!pts.length) return n;
  const xs = pts.flatMap((p) => [p.x, p.inX ?? p.x, p.outX ?? p.x]);
  const ys = pts.flatMap((p) => [p.y, p.inY ?? p.y, p.outY ?? p.y]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { ...n, x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
}

// A layer given a new box: paths scale their points to it.
function scaleOwn(old: SlideNode, next: SlideNode): SlideNode {
  if (!old.points?.length || (old.width === next.width && old.height === next.height && old.x === next.x && old.y === next.y)) return next;
  const kx = next.width / old.width;
  const ky = next.height / old.height;
  const mx = (v: number) => next.x + (v - old.x) * kx;
  const my = (v: number) => next.y + (v - old.y) * ky;
  return { ...next, points: old.points.map((p) => ({ x: mx(p.x), y: my(p.y), ...(p.inX !== undefined ? { inX: mx(p.inX), inY: my(p.inY ?? p.y) } : {}), ...(p.outX !== undefined ? { outX: mx(p.outX), outY: my(p.outY ?? p.y) } : {}) })) };
}

// Everything inside a group scales with it.
function scaleTree(nodes: SlideNode[], before: SlideNode, after: SlideNode): SlideNode[] {
  const kx = after.width / before.width;
  const ky = after.height / before.height;
  const inside = new Set(descendants(nodes, before.id));
  return fitGroups(
    nodes.map((n) => {
      if (!inside.has(n.id)) return n;
      const next = { ...n, x: after.x + (n.x - before.x) * kx, y: after.y + (n.y - before.y) * ky, width: n.width * kx, height: n.height * ky };
      return scaleOwn(n, next);
    }),
  );
}
