// Bordy «Дизайн»: a file of pages; a page is an endless canvas of layers. Layers nest
// through `parentId` (frames and groups hold others) and keep absolute coordinates, so
// hit-testing and drawing are simple; moving a container moves its descendants.
import { newId, readNode, type AutoLayout, type Constraints, type SlideNode } from "./slides";

export type Flow = { id: string; name: string; start: string };
export type DesignPage = { id: string; name: string; background: string; nodes: SlideNode[]; flows: Flow[] };
export type DesignDoc = { version: 1; kind: "design"; pages: DesignPage[] };

export const emptyPage = (name: string): DesignPage => ({ id: newId(), name, background: "#1e1f24", nodes: [], flows: [] });
export const emptyDesign = (name: string): DesignDoc => ({ version: 1, kind: "design", pages: [emptyPage(name)] });

export function readDesign(data: unknown, pageName: string): DesignDoc {
  const raw = (data && typeof data === "object" ? data : {}) as { pages?: unknown };
  const pages = (Array.isArray(raw.pages) ? raw.pages : []).flatMap((p): DesignPage[] => {
    if (!p || typeof p !== "object") return [];
    const page = p as Record<string, unknown>;
    const nodes = (Array.isArray(page.nodes) ? page.nodes : []).flatMap(readNode);
    const ids = new Set(nodes.map((n) => n.id));
    // A parent that is gone (or a loop) puts the layer back at the top.
    for (const n of nodes) if (n.parentId && (!ids.has(n.parentId) || n.parentId === n.id)) delete n.parentId;
    const flows = (Array.isArray(page.flows) ? page.flows : []).flatMap((f): Flow[] => {
      if (!f || typeof f !== "object") return [];
      const x = f as Record<string, unknown>;
      return typeof x.start === "string" && ids.has(x.start) ? [{ id: typeof x.id === "string" ? x.id : newId(), name: typeof x.name === "string" ? x.name.slice(0, 80) : "Flow", start: x.start }] : [];
    });
    return [{ id: typeof page.id === "string" ? page.id : newId(), name: typeof page.name === "string" ? page.name.slice(0, 80) : pageName, background: typeof page.background === "string" ? page.background : "#1e1f24", nodes, flows }];
  });
  return { version: 1, kind: "design", pages: pages.length ? pages : [emptyPage(pageName)] };
}

export const isContainer = (n: SlideNode) => n.type === "FRAME" || n.type === "GROUP";
export const childrenOf = (nodes: SlideNode[], parentId: string | null) => nodes.filter((n) => (n.parentId ?? null) === parentId);

export function descendants(nodes: SlideNode[], id: string): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const n of nodes)
      if (n.parentId === pid) {
        out.push(n.id);
        walk(n.id);
      }
  };
  walk(id);
  return out;
}

export function ancestors(nodes: SlideNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (let at = byId.get(id)?.parentId, i = 0; at && i < 50; at = byId.get(at)?.parentId, i++) out.push(at);
  return out;
}

// The top-most frame under a point (drawing or dropping goes into it).
export function frameAt(nodes: SlideNode[], x: number, y: number, skip: Set<string> = new Set()): SlideNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.type !== "FRAME" || n.hidden || skip.has(n.id)) continue;
    if (x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height) return n;
  }
  return null;
}

// Draw order: a parent, then its children (in their order), depth first.
export function drawOrder(nodes: SlideNode[]): SlideNode[] {
  const out: SlideNode[] = [];
  const walk = (pid: string | null) => {
    for (const n of childrenOf(nodes, pid)) {
      out.push(n);
      walk(n.id);
    }
  };
  walk(null);
  return out;
}

// Groups take the box of what they hold.
export function fitGroups(nodes: SlideNode[]): SlideNode[] {
  let list = nodes;
  for (const g of [...nodes].filter((n) => n.type === "GROUP").reverse()) {
    const kids = list.filter((n) => n.parentId === g.id);
    if (!kids.length) continue;
    const x = Math.min(...kids.map((k) => Math.min(k.x, k.x + k.width)));
    const y = Math.min(...kids.map((k) => Math.min(k.y, k.y + k.height)));
    const r = Math.max(...kids.map((k) => Math.max(k.x, k.x + k.width)));
    const b = Math.max(...kids.map((k) => Math.max(k.y, k.y + k.height)));
    list = list.map((n) => (n.id === g.id ? { ...n, x, y, width: Math.max(1, r - x), height: Math.max(1, b - y) } : n));
  }
  return list;
}

// Moving layers moves everything inside them too.
export function moveTree(nodes: SlideNode[], ids: string[], dx: number, dy: number): SlideNode[] {
  const all = new Set(ids.flatMap((id) => [id, ...descendants(nodes, id)]));
  return nodes.map((n) => (all.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy, ...(n.points ? { points: n.points.map((p) => shiftPoint(p, dx, dy)) } : {}) } : n));
}

const shiftPoint = (p: NonNullable<SlideNode["points"]>[number], dx: number, dy: number) => ({
  x: p.x + dx,
  y: p.y + dy,
  ...(p.inX !== undefined ? { inX: p.inX + dx, inY: (p.inY ?? p.y) + dy } : {}),
  ...(p.outX !== undefined ? { outX: p.outX + dx, outY: (p.outY ?? p.y) + dy } : {}),
});

// A layer into another parent (or the top), placed last there.
export function reparent(nodes: SlideNode[], id: string, parentId: string | null): SlideNode[] {
  if (parentId && (parentId === id || descendants(nodes, id).includes(parentId))) return nodes;
  const moving = new Set([id, ...descendants(nodes, id)]);
  const rest = nodes.filter((n) => !moving.has(n.id));
  const block = nodes.filter((n) => moving.has(n.id)).map((n) => (n.id === id ? { ...n, parentId: parentId ?? undefined } : n));
  if (parentId === null) delete block[0].parentId;
  return [...rest, ...block];
}

// Remove layers with everything inside them.
export function removeTree(nodes: SlideNode[], ids: string[]): SlideNode[] {
  const gone = new Set(ids.flatMap((id) => [id, ...descendants(nodes, id)]));
  return nodes.filter((n) => !gone.has(n.id));
}

// Copies of layers (with their insides) under new ids, shifted.
export function cloneTree(nodes: SlideNode[], ids: string[], dx: number, dy: number): SlideNode[] {
  const map = new Map<string, string>();
  const picked = nodes.filter((n) => ids.some((id) => id === n.id || descendants(nodes, id).includes(n.id)));
  for (const n of picked) map.set(n.id, newId());
  return picked.map((n) => ({
    ...n,
    id: map.get(n.id)!,
    x: n.x + dx,
    y: n.y + dy,
    ...(n.points ? { points: n.points.map((p) => shiftPoint(p, dx, dy)) } : {}),
    ...(n.parentId && map.has(n.parentId) ? { parentId: map.get(n.parentId) } : {}),
  }));
}

// ---- Step Д-2: auto layout and constraints ----------------------------------------------------

// Children of a frame with auto layout placed in a row, a column or wrapping lines;
// "fill" children stretch, a "hug" frame takes the size of its contents.
export function layoutFrame(nodes: SlideNode[], frameId: string): SlideNode[] {
  const frame = nodes.find((n) => n.id === frameId);
  const al: AutoLayout | undefined = frame?.autoLayout;
  if (!frame || !al) return nodes;
  const kids = nodes.filter((n) => n.parentId === frame.id && !n.hidden);
  if (!kids.length) return nodes;
  const [pt, pr, pb, pl] = al.padding;
  const row = al.dir !== "column";
  const innerW = frame.width - pl - pr;
  const innerH = frame.height - pt - pb;
  const main = (n: SlideNode) => (row ? n.width : n.height);
  // Sizes: "fill" shares the free main space; across, "fill" takes the full width/height.
  const fills = kids.filter((k) => (row ? k.sizeW : k.sizeH) === "fill");
  const fixedMain = kids.filter((k) => !fills.includes(k)).reduce((s, k) => s + main(k), 0);
  const gaps = al.gap * (kids.length - 1);
  const free = Math.max(0, (row ? innerW : innerH) - fixedMain - gaps);
  const sized = kids.map((k) => {
    let w = k.width;
    let h = k.height;
    if (al.dir !== "wrap" && fills.includes(k)) {
      if (row) w = Math.max(1, free / fills.length);
      else h = Math.max(1, free / fills.length);
    }
    if ((row ? k.sizeH : k.sizeW) === "fill") {
      if (row) h = Math.max(1, innerH);
      else w = Math.max(1, innerW);
    }
    return { ...k, width: w, height: h };
  });
  // Lines (one unless wrapping).
  const lines: SlideNode[][] = [[]];
  let used = 0;
  for (const k of sized) {
    const m = row ? k.width : k.height;
    if (al.dir === "wrap" && lines[lines.length - 1].length && used + al.gap + m > innerW) {
      lines.push([]);
      used = 0;
    }
    used += (lines[lines.length - 1].length ? al.gap : 0) + m;
    lines[lines.length - 1].push(k);
  }
  const placed = new Map<string, SlideNode>();
  let crossAt = row ? pt : pl;
  let contentMain = 0;
  let contentCross = 0;
  for (const line of lines) {
    const lineMain = line.reduce((s, k) => s + (row ? k.width : k.height), 0);
    const lineCross = Math.max(...line.map((k) => (row ? k.height : k.width)));
    const space = (row ? innerW : innerH) - lineMain;
    const between = al.spaceBetween && line.length > 1 ? space / (line.length - 1) : al.gap;
    const used2 = lineMain + between * (line.length - 1);
    let at = (row ? pl : pt) + (al.spaceBetween ? 0 : al.alignMain === "center" ? ((row ? innerW : innerH) - used2) / 2 : al.alignMain === "end" ? (row ? innerW : innerH) - used2 : 0);
    for (const k of line) {
      const kc = row ? k.height : k.width;
      const room = al.dir === "wrap" ? lineCross : row ? innerH : innerW;
      const off = al.alignCross === "center" ? (room - kc) / 2 : al.alignCross === "end" ? room - kc : 0;
      const x = frame.x + (row ? at : crossAt + off);
      const y = frame.y + (row ? crossAt + off : at);
      placed.set(k.id, { ...k, x: Math.round(x), y: Math.round(y) });
      at += (row ? k.width : k.height) + between;
    }
    contentMain = Math.max(contentMain, used2);
    contentCross += lineCross + (contentCross ? al.gap : 0);
    crossAt += lineCross + al.gap;
  }
  // Move what is inside the children with them.
  let out = nodes;
  for (const [id, k] of placed) {
    const old = nodes.find((n) => n.id === id)!;
    out = moveTree(out, [id], k.x - old.x, k.y - old.y).map((n) => (n.id === id ? { ...n, width: k.width, height: k.height } : n));
  }
  // Hug: the frame takes the size of its contents.
  const hugW = frame.sizeW === "hug";
  const hugH = frame.sizeH === "hug";
  if (hugW || hugH) {
    const w = row ? contentMain : contentCross;
    const h = row ? contentCross : contentMain;
    out = out.map((n) => (n.id === frame.id ? { ...n, ...(hugW ? { width: Math.max(1, Math.round(w + pl + pr)) } : {}), ...(hugH ? { height: Math.max(1, Math.round(h + pt + pb)) } : {}) } : n));
  }
  return out;
}

// Every auto layout on a page, innermost first (so a hugging child is sized before its parent).
// ---- BORDY-1: components and variants -----------------------------------------------------

// The set a component belongs to: its name up to the last "/" ("Button/Primary" → "Button").
export const componentSet = (name: string) => (name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : name);
export const variantName = (name: string) => (name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name);

// Every copy of a component takes the component's look and layers again: its own place stays,
// its layers are the component's, shifted there (ids stable per copy, so nothing jumps).
// A copy whose component is gone keeps what it has. Copies inside a component follow too
// (a few rounds settle nested ones).
export function syncInstances(nodes: SlideNode[]): SlideNode[] {
  let out = nodes;
  for (let round = 0; round < 4; round++) {
    const instances = out.filter((n) => n.instanceOf && n.type === "FRAME");
    if (!instances.length) return out;
    let changed = false;
    for (const copy of instances) {
      const main = out.find((n) => n.id === copy.instanceOf && n.component && n.type === "FRAME");
      if (!main || main.id === copy.id || descendants(out, copy.id).includes(main.id)) continue;
      const dx = copy.x - main.x;
      const dy = copy.y - main.y;
      const source = descendants(out, main.id).map((id) => out.find((n) => n.id === id)!).filter(Boolean);
      const idOf = (sourceId: string) => `${copy.id}~${sourceId}`.slice(0, 120);
      const fresh: SlideNode[] = source.map((n) => ({
        ...n,
        id: idOf(n.id),
        x: n.x + dx,
        y: n.y + dy,
        parentId: n.parentId === main.id ? copy.id : idOf(n.parentId!),
        fromComponent: n.id,
        locked: true,
        component: undefined,
        ...(n.points ? { points: n.points.map((p) => shiftPoint(p, dx, dy)) } : {}),
      }));
      const look: SlideNode = { ...main, id: copy.id, x: copy.x, y: copy.y, parentId: copy.parentId, name: copy.name, instanceOf: main.id, component: undefined, hidden: copy.hidden, locked: copy.locked };
      const old = new Set(descendants(out, copy.id));
      const kept = out.filter((n) => !old.has(n.id));
      const next = kept.map((n) => (n.id === copy.id ? look : n));
      const at = next.findIndex((n) => n.id === copy.id);
      const merged = [...next.slice(0, at + 1), ...fresh, ...next.slice(at + 1)];
      if (JSON.stringify(merged) !== JSON.stringify(out)) {
        out = merged;
        changed = true;
      }
    }
    if (!changed) return out;
  }
  return out;
}

// A new copy of a component, placed to its right.
export function newInstance(nodes: SlideNode[], componentId: string): { nodes: SlideNode[]; id: string } | null {
  const main = nodes.find((n) => n.id === componentId && n.component);
  if (!main) return null;
  const id = newId();
  const copy: SlideNode = { ...main, id, x: main.x + main.width + 40, name: variantName(main.component!), instanceOf: main.id, component: undefined, parentId: main.parentId };
  return { nodes: syncInstances([...nodes, copy]), id };
}

// A copy cut loose: it keeps its layers as its own.
export function detachInstance(nodes: SlideNode[], id: string): SlideNode[] {
  const inside = new Set(descendants(nodes, id));
  return nodes.map((n) => (n.id === id ? { ...n, instanceOf: undefined } : inside.has(n.id) ? { ...n, fromComponent: undefined, locked: false } : n));
}

export function layoutAll(nodes: SlideNode[]): SlideNode[] {
  const frames = nodes.filter((n) => n.autoLayout);
  const depth = (id: string) => {
    let d = 0;
    for (let at = nodes.find((n) => n.id === id)?.parentId; at && d < 50; at = nodes.find((n) => n.id === at)?.parentId) d++;
    return d;
  };
  let out = nodes;
  for (const f of [...frames].sort((a, b) => depth(b.id) - depth(a.id))) out = layoutFrame(out, f.id);
  return syncInstances(fitGroups(out));
}

// A frame resized from `before` to its new box: children follow their constraints.
export function applyConstraints(nodes: SlideNode[], before: SlideNode, after: SlideNode): SlideNode[] {
  if (after.autoLayout) return nodes;
  const kids = nodes.filter((n) => n.parentId === after.id);
  let out = nodes;
  for (const k of kids) {
    const c: Constraints = k.constraints ?? { h: "left", v: "top" };
    const fit = (pos: number, size: number, b0: number, bs: number, a0: number, as: number, mode: string) => {
      const start = pos - b0;
      const end = b0 + bs - (pos + size);
      if (mode === "right" || mode === "bottom") return { pos: a0 + as - end - size, size };
      if (mode === "leftRight" || mode === "topBottom") return { pos: a0 + start, size: Math.max(1, as - start - end) };
      if (mode === "center") return { pos: a0 + (start + size / 2) * (as / bs) - size / 2, size };
      if (mode === "scale") return { pos: a0 + start * (as / bs), size: Math.max(1, size * (as / bs)) };
      return { pos: a0 + start, size };
    };
    const h = fit(k.x, k.width, before.x, before.width, after.x, after.width, c.h);
    const v = fit(k.y, k.height, before.y, before.height, after.y, after.height, c.v);
    const dx = h.pos - k.x;
    const dy = v.pos - k.y;
    out = moveTree(out, [k.id], dx, dy).map((n) => (n.id === k.id ? { ...n, x: Math.round(h.pos), y: Math.round(v.pos), width: Math.round(h.size), height: Math.round(v.size) } : n));
    // A frame inside follows the same way for its own children.
    if (k.type === "FRAME") {
      const moved = out.find((n) => n.id === k.id)!;
      out = applyConstraints(out, { ...k, x: k.x + dx, y: k.y + dy }, moved);
    }
  }
  return out;
}

// The words in a design file, for search (also indexed by the database).
export const designText = (doc: DesignDoc) => doc.pages.flatMap((p) => p.nodes.map((n) => n.text ?? "")).join(" ").slice(0, 20000);

export const DEVICES = [
  { id: "phone", w: 390, h: 844 },
  { id: "phoneLarge", w: 430, h: 932 },
  { id: "android", w: 412, h: 915 },
  { id: "tablet", w: 834, h: 1194 },
  { id: "tabletLandscape", w: 1194, h: 834 },
  { id: "laptop", w: 1440, h: 900 },
  { id: "desktop", w: 1920, h: 1080 },
  { id: "watch", w: 198, h: 242 },
] as const;
