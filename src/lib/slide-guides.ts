// Presentations (step П-2): smart guides, alignment and distribution.
import { SLIDE_H, SLIDE_W, type SlideNode } from "./slides";

export type Box = { x: number; y: number; width: number; height: number };
export type Guide = { axis: "x" | "y"; at: number };

// The upright box a layer takes (lines may run either way).
export function boxOf(n: SlideNode): Box {
  const x = Math.min(n.x, n.x + n.width);
  const y = Math.min(n.y, n.y + n.height);
  return { x, y, width: Math.abs(n.width), height: Math.abs(n.height) };
}

export function unionBox(nodes: SlideNode[]): Box | null {
  if (!nodes.length) return null;
  const boxes = nodes.map(boxOf);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}

const lines = (b: Box) => ({ x: [b.x, b.x + b.width / 2, b.x + b.width], y: [b.y, b.y + b.height / 2, b.y + b.height] });

// Moving a box: the shift that makes one of its edges or its centre meet an edge or a
// centre of the slide or of another layer, if one is within `threshold`; and the guides.
export function snap(moving: Box, others: SlideNode[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const targets = { x: [0, SLIDE_W / 2, SLIDE_W], y: [0, SLIDE_H / 2, SLIDE_H] };
  for (const n of others) {
    const l = lines(boxOf(n));
    targets.x.push(...l.x);
    targets.y.push(...l.y);
  }
  const own = lines(moving);
  const best = (axis: "x" | "y") => {
    let found: { shift: number; at: number } | null = null;
    for (const a of own[axis])
      for (const tgt of targets[axis]) {
        const shift = tgt - a;
        if (Math.abs(shift) <= threshold && (!found || Math.abs(shift) < Math.abs(found.shift))) found = { shift, at: tgt };
      }
    return found;
  };
  const bx = best("x");
  const by = best("y");
  const guides: Guide[] = [];
  if (bx) guides.push({ axis: "x", at: bx.at });
  if (by) guides.push({ axis: "y", at: by.at });
  return { dx: bx?.shift ?? 0, dy: by?.shift ?? 0, guides };
}

export type AlignMode = "left" | "centerX" | "right" | "top" | "middle" | "bottom";

// Align several layers to their common box (one layer: to the slide).
export function align(nodes: SlideNode[], mode: AlignMode): Map<string, { x: number; y: number }> {
  const area = nodes.length > 1 ? unionBox(nodes)! : { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H };
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const b = boxOf(n);
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = area.x - b.x;
    if (mode === "centerX") dx = area.x + area.width / 2 - (b.x + b.width / 2);
    if (mode === "right") dx = area.x + area.width - (b.x + b.width);
    if (mode === "top") dy = area.y - b.y;
    if (mode === "middle") dy = area.y + area.height / 2 - (b.y + b.height / 2);
    if (mode === "bottom") dy = area.y + area.height - (b.y + b.height);
    out.set(n.id, { x: Math.round(n.x + dx), y: Math.round(n.y + dy) });
  }
  return out;
}

// Equal gaps between three or more layers, along an axis.
export function distribute(nodes: SlideNode[], axis: "x" | "y"): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length < 3) return out;
  const size = axis === "x" ? "width" : "height";
  const sorted = [...nodes].sort((a, b) => boxOf(a)[axis] - boxOf(b)[axis]);
  const first = boxOf(sorted[0]);
  const last = boxOf(sorted[sorted.length - 1]);
  const total = sorted.reduce((sum, n) => sum + boxOf(n)[size], 0);
  const gap = (last[axis] + last[size] - first[axis] - total) / (sorted.length - 1);
  let at = first[axis];
  for (const n of sorted) {
    const b = boxOf(n);
    const shift = at - b[axis];
    out.set(n.id, { x: Math.round(n.x + (axis === "x" ? shift : 0)), y: Math.round(n.y + (axis === "y" ? shift : 0)) });
    at += b[size] + gap;
  }
  return out;
}

export const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
