// Node space (step Н1): a mind map is a tree of nodes kept as a flat list; the
// layout is worked out from the tree, so nothing about positions is stored.

export type NodeColor = "default" | "blue" | "green" | "yellow" | "orange" | "red" | "purple";
export const NODE_COLORS: NodeColor[] = ["default", "blue", "green", "yellow", "orange", "red", "purple"];
export const NODE_COLOR_STYLES: Record<NodeColor, { bg: string; border: string }> = {
  default: { bg: "var(--background)", border: "var(--border)" },
  blue: { bg: "#dbeafe", border: "#3b82f6" },
  green: { bg: "#dcfce7", border: "#22c55e" },
  yellow: { bg: "#fef9c3", border: "#eab308" },
  orange: { bg: "#ffedd5", border: "#f97316" },
  red: { bg: "#fee2e2", border: "#ef4444" },
  purple: { bg: "#f3e8ff", border: "#a855f7" },
};

export type MapNode = { id: string; parent: string | null; text: string; color?: NodeColor; collapsed?: boolean };
export type MapData = { nodes: MapNode[] };

export const MAX_NODES = 2000;
export const newNodeId = () => Math.random().toString(36).slice(2, 10);

export function newMap(rootText: string): MapData {
  return { nodes: [{ id: newNodeId(), parent: null, text: rootText }] };
}

// Only well-formed nodes survive (a broken save never breaks the editor).
export function readMap(data: unknown, rootText: string): MapData {
  const list = Array.isArray((data as MapData | null)?.nodes) ? (data as MapData).nodes : [];
  const nodes = list
    .filter((n) => n && typeof n.id === "string" && typeof n.text === "string")
    .slice(0, MAX_NODES)
    .map((n) => ({ id: n.id, parent: typeof n.parent === "string" ? n.parent : null, text: n.text.slice(0, 500), color: NODE_COLORS.includes(n.color as NodeColor) ? n.color : undefined, collapsed: n.collapsed === true || undefined }));
  const ids = new Set(nodes.map((n) => n.id));
  const roots = nodes.filter((n) => n.parent === null || !ids.has(n.parent));
  if (!roots.length) return newMap(rootText);
  // One root: other parentless nodes hang under it.
  const root = roots[0];
  return { nodes: nodes.map((n) => (n.id !== root.id && (n.parent === null || !ids.has(n.parent)) ? { ...n, parent: root.id } : n)) };
}

export const rootOf = (map: MapData) => map.nodes.find((n) => n.parent === null)!;
export const childrenOf = (map: MapData, id: string) => map.nodes.filter((n) => n.parent === id);

function withoutSubtree(map: MapData, id: string) {
  const gone = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of map.nodes) {
      if (n.parent && gone.has(n.parent) && !gone.has(n.id)) {
        gone.add(n.id);
        grew = true;
      }
    }
  }
  return map.nodes.filter((n) => !gone.has(n.id));
}

export function addChild(map: MapData, parent: string, text = ""): [MapData, string] {
  const id = newNodeId();
  const nodes = map.nodes.map((n) => (n.id === parent ? { ...n, collapsed: undefined } : n));
  return [{ nodes: [...nodes, { id, parent, text }] }, id];
}

// A sibling right after the given node (for the root: a child).
export function addSibling(map: MapData, of: string, text = ""): [MapData, string] {
  const node = map.nodes.find((n) => n.id === of);
  if (!node?.parent) return addChild(map, of, text);
  const id = newNodeId();
  const at = map.nodes.findIndex((n) => n.id === of);
  const nodes = [...map.nodes];
  nodes.splice(at + 1, 0, { id, parent: node.parent, text });
  return [{ nodes }, id];
}

export const removeNode = (map: MapData, id: string): MapData => (map.nodes.find((n) => n.id === id)?.parent ? { nodes: withoutSubtree(map, id) } : map);
export const updateNode = (map: MapData, id: string, patch: Partial<MapNode>): MapData => ({ nodes: map.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });

// Keyboard moves: to the parent, the first child, the sibling above or below.
export function neighbour(map: MapData, id: string, direction: "parent" | "child" | "up" | "down"): string | null {
  const node = map.nodes.find((n) => n.id === id);
  if (!node) return null;
  if (direction === "parent") return node.parent;
  if (direction === "child") return node.collapsed ? null : (childrenOf(map, id)[0]?.id ?? null);
  if (!node.parent) return null;
  const siblings = childrenOf(map, node.parent);
  const at = siblings.findIndex((n) => n.id === id);
  return siblings[direction === "up" ? at - 1 : at + 1]?.id ?? null;
}

export const NODE_WIDTH = 180;
export const NODE_GAP_X = 60;
export const ROW_HEIGHT = 52;

// A tree growing to the right: every visible node gets x by depth and y in the middle of its branch.
export function layoutMap(map: MapData): Map<string, { x: number; y: number; depth: number; hidden: number }> {
  const positions = new Map<string, { x: number; y: number; depth: number; hidden: number }>();
  const kids = new Map<string, MapNode[]>();
  for (const n of map.nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const countAll = (id: string): number => (kids.get(id) ?? []).reduce((sum, k) => sum + 1 + countAll(k.id), 0);
  let row = 0;
  const place = (node: MapNode, depth: number): number => {
    const children = node.collapsed ? [] : (kids.get(node.id) ?? []);
    let y: number;
    if (!children.length) {
      y = row * ROW_HEIGHT;
      row += 1;
    } else {
      const ys = children.map((child) => place(child, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    positions.set(node.id, { x: depth * (NODE_WIDTH + NODE_GAP_X), y, depth, hidden: node.collapsed ? countAll(node.id) : 0 });
    return y;
  };
  place(rootOf(map), 0);
  return positions;
}

// The map as an indented list, and back (step Н2 builds on this).
export function mapToOutline(map: MapData): string {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const node = map.nodes.find((n) => n.id === id)!;
    lines.push(`${"  ".repeat(depth)}- ${node.text}`);
    for (const child of childrenOf(map, id)) walk(child.id, depth + 1);
  };
  walk(rootOf(map).id, 0);
  return lines.join("\n");
}
