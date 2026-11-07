// Presentations (step П-1): the deck model. A deck is a list of slides; each slide
// keeps its layers in drawing order (the last one is on top). The same node shape is
// meant to grow into the design engine of Bordy (frames, auto layout, prototypes), so
// it stays a plain, flat, serialisable record.

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export type NodeType = "TEXT" | "RECTANGLE" | "ELLIPSE" | "LINE" | "ARROW" | "IMAGE";

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
};

export type Slide = { id: string; background: string; nodes: SlideNode[] };
export type Deck = { version: 1; slides: Slide[] };

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
        },
      ];
    });
    return [{ id: str(slide.id) ?? newId(), background: str(slide.background) ?? "#ffffff", nodes }];
  });
  return { version: 1, slides: read.length ? read : [emptySlide()] };
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
