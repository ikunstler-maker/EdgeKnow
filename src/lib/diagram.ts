// The diagram block's data: rounded-rectangle nodes and the links between them.
// Stored as a JSON string in the block's `data` prop; everything read back is
// checked and clamped, so a hand-edited document can't break the page.

export const GRID = 16;
export const NODE_MIN_WIDTH = 128;
export const NODE_MIN_HEIGHT = 64;
export const MAX_NODES = 200;
export const MAX_EDGES = 400;
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 1000;

// Colours are picked from a palette by name, never stored as free CSS.
export const FILLS = {
  white: "#ffffff",
  gray: "#f1f1ef",
  yellow: "#fbf3db",
  orange: "#fbecdd",
  red: "#fdebec",
  green: "#edf3ec",
  blue: "#e7f3f8",
  purple: "#f4f0f7",
  pink: "#faf1f5",
} as const;

export const STROKES = {
  gray: "#9b9a97",
  dark: "#37352f",
  yellow: "#dfab01",
  orange: "#d9730d",
  red: "#e03e3e",
  green: "#0f7b6c",
  blue: "#0b6e99",
  purple: "#6940a5",
  pink: "#ad1a72",
} as const;

export type FillName = keyof typeof FILLS;
export type StrokeName = keyof typeof STROKES;

export const STATUS_EMOJI = ["", "✅", "🟡", "🔴", "⏳", "🚧", "❗", "💡", "🔒", "⭐"] as const;

export const HEIGHTS = { s: 320, m: 480, l: 640 } as const;

export type DiagramNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  description: string;
  fill: FillName;
  stroke: StrokeName;
  emoji: string;
};

export type DiagramEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
};

export type Diagram = { nodes: DiagramNode[]; edges: DiagramEdge[] };

const HANDLES = new Set(["top", "right", "bottom", "left"]);
const ID = /^[A-Za-z0-9_-]{1,40}$/;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
const number = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const snap = (value: number) => Math.round(value / GRID) * GRID;

export function newId(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

export function parseDiagram(data: string): Diagram {
  let raw: { nodes?: unknown; edges?: unknown } = {};
  try {
    raw = data ? JSON.parse(data) : {};
  } catch {
    raw = {};
  }
  const nodes: DiagramNode[] = [];
  const ids = new Set<string>();
  for (const item of Array.isArray(raw.nodes) ? raw.nodes.slice(0, MAX_NODES) : []) {
    const n = item as Record<string, unknown>;
    const id = typeof n.id === "string" && ID.test(n.id) && !ids.has(n.id) ? n.id : null;
    if (!id) continue;
    ids.add(id);
    nodes.push({
      id,
      x: number(n.x, -100000, 100000, 0),
      y: number(n.y, -100000, 100000, 0),
      width: number(n.width, NODE_MIN_WIDTH, 1600, 192),
      height: number(n.height, NODE_MIN_HEIGHT, 1600, 96),
      title: text(n.title, TITLE_MAX),
      description: text(n.description, DESCRIPTION_MAX),
      fill: typeof n.fill === "string" && n.fill in FILLS ? (n.fill as FillName) : "white",
      stroke: typeof n.stroke === "string" && n.stroke in STROKES ? (n.stroke as StrokeName) : "gray",
      emoji: text(n.emoji, 8),
    });
  }
  const edges: DiagramEdge[] = [];
  const edgeIds = new Set<string>();
  for (const item of Array.isArray(raw.edges) ? raw.edges.slice(0, MAX_EDGES) : []) {
    const e = item as Record<string, unknown>;
    if (typeof e.id !== "string" || !ID.test(e.id) || edgeIds.has(e.id)) continue;
    if (typeof e.source !== "string" || typeof e.target !== "string" || !ids.has(e.source) || !ids.has(e.target)) continue;
    edgeIds.add(e.id);
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: typeof e.sourceHandle === "string" && HANDLES.has(e.sourceHandle) ? e.sourceHandle : null,
      targetHandle: typeof e.targetHandle === "string" && HANDLES.has(e.targetHandle) ? e.targetHandle : null,
    });
  }
  return { nodes, edges };
}

export function serializeDiagram(diagram: Diagram): string {
  return JSON.stringify(diagram);
}

export function makeNode(x: number, y: number): DiagramNode {
  return {
    id: newId("n"),
    x: snap(x),
    y: snap(y),
    width: 192,
    height: 96,
    title: "",
    description: "",
    fill: "white",
    stroke: "gray",
    emoji: "",
  };
}

export { snap };

// --- Alignment guides ---------------------------------------------------------

export type Box = { x: number; y: number; width: number; height: number };
export type Guides = { vertical: number | null; horizontal: number | null };

// Within this distance (in diagram pixels) a node "sticks" to another node's
// edge or centre line.
export const MAGNET = 8;

// Moves `box` onto the nearest left/centre/right and top/middle/bottom line of
// another node when one is close enough, and returns the lines to draw.
export function alignToOthers(box: Box, others: Box[]): { x: number; y: number; guides: Guides } {
  const xs = (b: Box) => [b.x, b.x + b.width / 2, b.x + b.width];
  const ys = (b: Box) => [b.y, b.y + b.height / 2, b.y + b.height];
  let best = { dx: Infinity, line: null as number | null };
  let bestY = { dy: Infinity, line: null as number | null };
  for (const other of others) {
    for (const own of xs(box)) {
      for (const line of xs(other)) {
        const d = line - own;
        if (Math.abs(d) <= MAGNET && Math.abs(d) < Math.abs(best.dx)) best = { dx: d, line };
      }
    }
    for (const own of ys(box)) {
      for (const line of ys(other)) {
        const d = line - own;
        if (Math.abs(d) <= MAGNET && Math.abs(d) < Math.abs(bestY.dy)) bestY = { dy: d, line };
      }
    }
  }
  return {
    x: box.x + (best.line === null ? 0 : best.dx),
    y: box.y + (bestY.line === null ? 0 : bestY.dy),
    guides: { vertical: best.line, horizontal: bestY.line },
  };
}
