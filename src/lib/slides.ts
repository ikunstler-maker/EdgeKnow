// Presentations (step П-1): the deck model. A deck is a list of slides; each slide
// keeps its layers in drawing order (the last one is on top). The same node shape is
// meant to grow into the design engine of Bordy (frames, auto layout, prototypes), so
// it stays a plain, flat, serialisable record.

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export type NodeType = "TEXT" | "RECTANGLE" | "ELLIPSE" | "LINE" | "ARROW" | "IMAGE";

export type Gradient = { kind: "linear" | "radial"; angle: number; stops: { offset: number; color: string }[] };
export type Shadow = { x: number; y: number; blur: number; color: string };

export type SlideNode = {
  id: string;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  // Text
  text?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  align?: "left" | "center" | "right";
  // Picture: an object file of the deck.
  imageId?: string;
  // Look (step П-2)
  opacity?: number; // 0..1
  gradient?: Gradient; // over fill when set
  dash?: "solid" | "dash" | "dot";
  radius?: number | [number, number, number, number]; // TL, TR, BR, BL
  shadow?: Shadow;
  blur?: number;
  fontFamily?: string;
  italic?: boolean;
  underline?: boolean;
  lineHeight?: number;
  vAlign?: "top" | "middle" | "bottom";
  // Layers
  hidden?: boolean;
  locked?: boolean;
  groupId?: string;
};

export type Slide = { id: string; background: string; nodes: SlideNode[]; notes?: string; transition?: Transition };
export type Size = { w: number; h: number };
// Notes for the speaker and the way the slide comes in (step П-3а).
export type Transition = { kind: "none" | "fade" | "slide" | "push" | "smart"; direction?: "left" | "right" | "up" | "down"; duration?: number; easing?: "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out" };
export type Deck = { version: 1; theme?: string; size?: Size; slides: Slide[] };

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));

export const emptySlide = (): Slide => ({ id: newId(), background: "#ffffff", nodes: [] });
export const emptyDeck = (): Deck => ({ version: 1, slides: [emptySlide()] });

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const TYPES: NodeType[] = ["TEXT", "RECTANGLE", "ELLIPSE", "LINE", "ARROW", "IMAGE"];

// Whatever is stored (older or hand-made data) becomes a valid deck.
export function readDeck(data: unknown): Deck {
  const raw = (data && typeof data === "object" ? data : {}) as { slides?: unknown };
  const slides = Array.isArray(raw.slides) ? raw.slides : [];
  const read = slides.flatMap((s): Slide[] => {
    if (!s || typeof s !== "object") return [];
    const slide = s as Record<string, unknown>;
    const nodes = (Array.isArray(slide.nodes) ? slide.nodes : []).flatMap((n): SlideNode[] => {
      if (!n || typeof n !== "object") return [];
      const node = n as Record<string, unknown>;
      const type = TYPES.includes(node.type as NodeType) ? (node.type as NodeType) : null;
      if (!type) return [];
      return [
        {
          id: str(node.id) ?? newId(),
          type,
          name: str(node.name) ?? type,
          x: num(node.x, 0),
          y: num(node.y, 0),
          // Lines and arrows run from (x, y) by (width, height), either way.
          width: type === "LINE" || type === "ARROW" ? num(node.width, 100) : Math.max(1, num(node.width, 100)),
          height: type === "LINE" || type === "ARROW" ? num(node.height, 0) : Math.max(1, num(node.height, 100)),
          rotation: num(node.rotation, 0),
          fill: str(node.fill),
          stroke: str(node.stroke),
          strokeWidth: typeof node.strokeWidth === "number" ? node.strokeWidth : undefined,
          text: str(node.text),
          fontSize: typeof node.fontSize === "number" ? node.fontSize : undefined,
          color: str(node.color),
          bold: node.bold === true,
          align: node.align === "center" || node.align === "right" ? node.align : node.align === "left" ? "left" : undefined,
          imageId: str(node.imageId),
          ...readLook(node),
        },
      ];
    });
    const tr = slide.transition as Record<string, unknown> | undefined;
    const kinds = ["none", "fade", "slide", "push", "smart"];
    const transition: Transition | undefined =
      tr && kinds.includes(tr.kind as string)
        ? {
            kind: tr.kind as Transition["kind"],
            ...(["left", "right", "up", "down"].includes(tr.direction as string) ? { direction: tr.direction as Transition["direction"] } : {}),
            duration: Math.min(3000, Math.max(100, num(tr.duration, 500))),
            ...(["linear", "ease", "ease-in", "ease-out", "ease-in-out"].includes(tr.easing as string) ? { easing: tr.easing as Transition["easing"] } : {}),
          }
        : undefined;
    const notes = str(slide.notes);
    return [{ id: str(slide.id) ?? newId(), background: str(slide.background) ?? "#ffffff", nodes, ...(notes ? { notes: notes.slice(0, 20000) } : {}), ...(transition ? { transition } : {}) }];
  });
  const theme = str((raw as Record<string, unknown>).theme);
  const sz = (raw as Record<string, unknown>).size as Record<string, unknown> | undefined;
  const size = sz && typeof sz.w === "number" && typeof sz.h === "number" ? { w: Math.round(Math.min(MAX_SIDE, Math.max(MIN_SIDE, sz.w))), h: Math.round(Math.min(MAX_SIDE, Math.max(MIN_SIDE, sz.h))) } : undefined;
  return { version: 1, ...(theme ? { theme } : {}), ...(size ? { size } : {}), slides: read.length ? read : [emptySlide()] };
}

const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{3,8}$|^rgba?\(/i.test(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// The optional look of a layer, kept only when well-formed.
function readLook(node: Record<string, unknown>): Partial<SlideNode> {
  const out: Partial<SlideNode> = {};
  if (typeof node.opacity === "number") out.opacity = clamp(node.opacity, 0, 1);
  const g = node.gradient as Record<string, unknown> | undefined;
  if (g && (g.kind === "linear" || g.kind === "radial") && Array.isArray(g.stops)) {
    const stops = g.stops.flatMap((x) => (x && typeof x === "object" && isColor((x as { color?: unknown }).color) ? [{ offset: clamp(num((x as { offset?: unknown }).offset, 0), 0, 1), color: (x as { color: string }).color }] : []));
    if (stops.length >= 2) out.gradient = { kind: g.kind, angle: num(g.angle, 135), stops: stops.slice(0, 6) };
  }
  if (node.dash === "dash" || node.dash === "dot" || node.dash === "solid") out.dash = node.dash;
  if (typeof node.radius === "number") out.radius = Math.max(0, node.radius);
  else if (Array.isArray(node.radius) && node.radius.length === 4 && node.radius.every((r) => typeof r === "number")) out.radius = node.radius.map((r) => Math.max(0, r)) as [number, number, number, number];
  const sh = node.shadow as Record<string, unknown> | undefined;
  if (sh && isColor(sh.color)) out.shadow = { x: num(sh.x, 0), y: num(sh.y, 8), blur: Math.max(0, num(sh.blur, 16)), color: sh.color };
  if (typeof node.blur === "number" && node.blur > 0) out.blur = Math.min(200, node.blur);
  if (typeof node.fontFamily === "string") out.fontFamily = node.fontFamily.slice(0, 80);
  if (node.italic === true) out.italic = true;
  if (node.underline === true) out.underline = true;
  if (typeof node.lineHeight === "number") out.lineHeight = clamp(node.lineHeight, 0.6, 4);
  if (node.vAlign === "top" || node.vAlign === "middle" || node.vAlign === "bottom") out.vAlign = node.vAlign;
  if (node.hidden === true) out.hidden = true;
  if (node.locked === true) out.locked = true;
  if (typeof node.groupId === "string") out.groupId = node.groupId;
  return out;
}

// A new layer of a kind, at a place, with sensible defaults.
export function makeNode(type: NodeType, x: number, y: number, width: number, height: number, names: Record<NodeType, string>): SlideNode {
  const base = { id: newId(), type, name: names[type], x, y, width, height, rotation: 0 };
  switch (type) {
    case "TEXT":
      return { ...base, text: "", fontSize: 64, color: "#111827", align: "left" };
    case "RECTANGLE":
      return { ...base, fill: "#60a5fa", stroke: "none", strokeWidth: 0 };
    case "ELLIPSE":
      return { ...base, fill: "#f472b6", stroke: "none", strokeWidth: 0 };
    case "LINE":
    case "ARROW":
      return { ...base, stroke: "#111827", strokeWidth: 8 };
    case "IMAGE":
      return base;
  }
}

// The words in a deck, for search.
export const deckText = (deck: Deck) =>
  deck.slides
    .flatMap((s) => s.nodes.map((n) => n.text ?? ""))
    .join(" ")
    .slice(0, 20000);

// Slide sizes (step П-3а): any aspect, the long side 1920 for the presets; own pixels too.
export const DEFAULT_SIZE: Size = { w: SLIDE_W, h: SLIDE_H };
export const MIN_SIDE = 100;
export const MAX_SIDE = 8000;
export const ASPECTS = ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9", "9:21", "5:4", "4:5", "2:1", "1:2"] as const;
export const sizeOf = (deck: Deck): Size => deck.size ?? DEFAULT_SIZE;
export function aspectSize(aspect: string): Size {
  const [a, b] = aspect.split(":").map(Number);
  return a >= b ? { w: 1920, h: Math.round((1920 * b) / a) } : { w: Math.round((1920 * a) / b), h: 1920 };
}
export const aspectOf = (size: Size) => ASPECTS.find((x) => {
  const t = aspectSize(x);
  return t.w === size.w && t.h === size.h;
});

// Layers made for one size, fitted into another: scaled evenly and centred.
export function fitNodes(nodes: SlideNode[], from: Size, to: Size): SlideNode[] {
  const k = Math.min(to.w / from.w, to.h / from.h);
  const ox = (to.w - from.w * k) / 2;
  const oy = (to.h - from.h * k) / 2;
  const r = (v: number) => Math.round(v * 100) / 100;
  return nodes.map((n) => ({
    ...n,
    x: r(ox + n.x * k),
    y: r(oy + n.y * k),
    width: r(n.width * k),
    height: r(n.height * k),
    ...(n.fontSize ? { fontSize: r(n.fontSize * k) } : {}),
    ...(n.strokeWidth ? { strokeWidth: r(n.strokeWidth * k) } : {}),
    ...(typeof n.radius === "number" ? { radius: r(n.radius * k) } : Array.isArray(n.radius) ? { radius: n.radius.map((v) => r(v * k)) as [number, number, number, number] } : {}),
    ...(n.shadow ? { shadow: { ...n.shadow, x: r(n.shadow.x * k), y: r(n.shadow.y * k), blur: r(n.shadow.blur * k) } } : {}),
    ...(n.blur ? { blur: r(n.blur * k) } : {}),
  }));
}

// A new size for the whole deck; `fit` scales what is on the slides, otherwise it stays put.
export function resizeDeck(deck: Deck, size: Size, fit: boolean): Deck {
  const from = sizeOf(deck);
  return { ...deck, size, slides: fit ? deck.slides.map((s) => ({ ...s, nodes: fitNodes(s.nodes, from, size) })) : deck.slides };
}
