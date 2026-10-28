// Chips: small coloured pills inside the text. A dropdown chip switches between
// options the author defines (statuses, versions…); page and person chips point
// at a page or a colleague, like smart chips in Google Docs.

export const CHIP_COLORS = {
  gray: { bg: "#ebeced", fg: "#37352f" },
  blue: { bg: "#d3e5ef", fg: "#183347" },
  green: { bg: "#dbeddb", fg: "#1c3829" },
  yellow: { bg: "#fdecc8", fg: "#402c1b" },
  orange: { bg: "#fadec9", fg: "#49290e" },
  red: { bg: "#ffe2dd", fg: "#5d1715" },
  purple: { bg: "#e8deee", fg: "#412454" },
  pink: { bg: "#f5e0e9", fg: "#4c2337" },
} as const;

export type ChipColor = keyof typeof CHIP_COLORS;
export type ChipOption = { id: string; label: string; color: ChipColor };
export type ChipSet = { name: string; options: ChipOption[] };

export const CHIP_MAX_OPTIONS = 20;
export const CHIP_LABEL_MAX = 40;

const option = (id: string, label: string, color: ChipColor): ChipOption => ({ id, label, color });

// Ready-made sets; the Ukrainian labels are defaults the author can rename.
export const CHIP_PRESETS: ChipSet[] = [
  {
    name: "Статус",
    options: [
      option("todo", "Не розпочато", "gray"),
      option("doing", "В роботі", "blue"),
      option("review", "На перевірці", "yellow"),
      option("done", "Готово", "green"),
      option("blocked", "Заблоковано", "red"),
    ],
  },
  {
    name: "Версія",
    options: [option("v1", "v1", "gray"), option("v2", "v2", "blue"), option("v3", "v3", "purple")],
  },
  {
    name: "Пріоритет",
    options: [option("low", "Низький", "green"), option("mid", "Середній", "yellow"), option("high", "Високий", "red")],
  },
];

// Options are stored as a JSON string prop; whatever comes back is checked.
export function parseOptions(value: string): ChipOption[] {
  let raw: unknown = [];
  try {
    raw = JSON.parse(value || "[]");
  } catch {
    raw = [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ChipOption[] = [];
  for (const item of raw.slice(0, CHIP_MAX_OPTIONS)) {
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id || o.id.length > 40 || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      label: typeof o.label === "string" ? o.label.slice(0, CHIP_LABEL_MAX) : "",
      color: typeof o.color === "string" && o.color in CHIP_COLORS ? (o.color as ChipColor) : "gray",
    });
  }
  return out;
}

export function newOptionId() {
  return `o${Math.random().toString(36).slice(2, 9)}`;
}

type InlineLike = { type?: string; props?: Record<string, unknown>; content?: unknown };
type BlockLike = { content?: unknown; children?: BlockLike[] };

// Option sets already used by dropdown chips on this page, to reuse them.
export function chipSetsIn(blocks: readonly BlockLike[]): ChipSet[] {
  const sets = new Map<string, ChipSet>();
  const visitInline = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items as InlineLike[]) {
      if (item.type === "chip" && item.props) {
        const options = parseOptions(String(item.props.options ?? ""));
        const name = String(item.props.name ?? "");
        const key = JSON.stringify([name, options.map((o) => [o.label, o.color])]);
        if (options.length && !sets.has(key)) sets.set(key, { name, options });
      }
      if (item.type === "link") visitInline(item.content);
    }
  };
  const walk = (list: readonly BlockLike[]) => {
    for (const block of list) {
      visitInline(block.content);
      if (block.children?.length) walk(block.children);
    }
  };
  walk(blocks);
  return [...sets.values()];
}
