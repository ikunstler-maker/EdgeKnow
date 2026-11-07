// Presentations (step П-3а): how one slide turns into the next. "Smart" matches layers
// by name on both slides and moves them from one state to the other.
import type { Slide, SlideNode, Transition } from "./slides";

export const EASINGS: Record<NonNullable<Transition["easing"]>, (t: number) => number> = {
  linear: (t) => t,
  ease: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  "ease-in": (t) => t * t * t,
  "ease-out": (t) => 1 - Math.pow(1 - t, 3),
  "ease-in-out": (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function mixColor(a: string | undefined, b: string | undefined, t: number): string | undefined {
  const parse = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return t < 0.5 ? a : b;
  return `#${x.map((v, i) => Math.round(mix(v, y[i], t)).toString(16).padStart(2, "0")).join("")}`;
}

// The layers of the moment `t` (0..1) between two slides.
export function smartFrame(from: Slide, to: Slide, t: number): SlideNode[] {
  const byName = new Map(from.nodes.filter((n) => !n.hidden).map((n) => [n.name, n]));
  const used = new Set<string>();
  const out: SlideNode[] = [];
  for (const b of to.nodes.filter((n) => !n.hidden)) {
    const a = byName.get(b.name);
    if (a && a.type === b.type && !used.has(a.id)) {
      used.add(a.id);
      const ra = typeof a.radius === "number" ? a.radius : 0;
      const rb = typeof b.radius === "number" ? b.radius : 0;
      out.push({
        ...b,
        x: mix(a.x, b.x, t),
        y: mix(a.y, b.y, t),
        width: mix(a.width, b.width, t),
        height: mix(a.height, b.height, t),
        rotation: mix(a.rotation, b.rotation, t),
        opacity: mix(a.opacity ?? 1, b.opacity ?? 1, t),
        fill: mixColor(a.fill, b.fill, t),
        color: mixColor(a.color, b.color, t),
        stroke: mixColor(a.stroke, b.stroke, t),
        ...(typeof a.radius === "number" || typeof b.radius === "number" ? { radius: mix(ra, rb, t) } : {}),
        ...(a.fontSize && b.fontSize ? { fontSize: mix(a.fontSize, b.fontSize, t) } : {}),
      });
    } else out.push({ ...b, opacity: (b.opacity ?? 1) * t });
  }
  // What leaves fades out.
  for (const a of from.nodes) if (!a.hidden && !used.has(a.id)) out.unshift({ ...a, opacity: (a.opacity ?? 1) * (1 - t) });
  return out;
}

// Where the outgoing and incoming slides stand at `t`, for the moving transitions (in %).
export function slideOffsets(tr: Transition, t: number): { from: { x: number; y: number; opacity: number }; to: { x: number; y: number; opacity: number } } {
  const dir = tr.direction ?? "left";
  const vx = dir === "left" ? -1 : dir === "right" ? 1 : 0;
  const vy = dir === "up" ? -1 : dir === "down" ? 1 : 0;
  if (tr.kind === "fade") return { from: { x: 0, y: 0, opacity: 1 - t }, to: { x: 0, y: 0, opacity: t } };
  // "slide": the new one comes over the old; "push": the new one pushes the old away.
  const inX = -vx * 100 * (1 - t);
  const inY = -vy * 100 * (1 - t);
  if (tr.kind === "push") return { from: { x: vx * 100 * t, y: vy * 100 * t, opacity: 1 }, to: { x: inX, y: inY, opacity: 1 } };
  return { from: { x: 0, y: 0, opacity: 1 }, to: { x: inX, y: inY, opacity: 1 } };
}
