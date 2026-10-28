// Counts for the page counter, computed in the browser from the editor document:
// the same text a reader sees (inline text, links, chips, table cells, children).

type Inline = { type?: string; text?: string; content?: unknown; props?: Record<string, unknown> };
type Block = { type?: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };

export type PageStats = {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  paragraphs: number;
  headings: number;
  images: number;
  links: number;
  tables: number;
  diagrams: number;
  readingMinutes: number;
};

// Text blocks that count as paragraphs when they have text.
const PARAGRAPH_TYPES = new Set([
  "paragraph",
  "quote",
  "callout",
  "subtitle",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
]);
const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const WORDS_PER_MINUTE = 200;

function inlineText(items: unknown, stats: PageStats): string {
  if (!Array.isArray(items)) return "";
  return (items as Inline[])
    .map((item) => {
      if (item.type === "link") {
        stats.links += 1;
        return inlineText(item.content, stats);
      }
      if (item.type === "personChip") return String(item.props?.label ?? "");
      if (item.type === "chip") {
        try {
          const options = JSON.parse(String(item.props?.options ?? "[]")) as { id: string; label: string }[];
          return options.find((o) => o.id === item.props?.value)?.label ?? "";
        } catch {
          return "";
        }
      }
      return item.text ?? "";
    })
    .join("");
}

function blockText(block: Block, stats: PageStats): string {
  if (block.type === "table") {
    const rows = (block.content as { rows?: { cells?: unknown[] }[] })?.rows ?? [];
    return rows
      .flatMap((row) =>
        (row.cells ?? []).map((cell) => inlineText(Array.isArray(cell) ? cell : (cell as { content?: unknown })?.content, stats)),
      )
      .join(" ");
  }
  return inlineText(block.content, stats);
}

function walk(list: Block[], stats: PageStats, texts: string[]) {
  for (const block of list) {
    const text = blockText(block, stats);
    if (text.trim()) {
      texts.push(text);
      if (PARAGRAPH_TYPES.has(block.type ?? "")) stats.paragraphs += 1;
    }
    if (block.type === "heading" && text.trim()) stats.headings += 1;
    if (block.type === "image" && block.props?.url) stats.images += 1;
    if (block.type === "linkCard" || block.type === "youtube") stats.links += 1;
    if (block.type === "table") stats.tables += 1;
    if (block.type === "diagram") stats.diagrams += 1;
    if (block.children?.length) walk(block.children, stats, texts);
  }
}

export function pageStats(content: unknown): PageStats {
  const stats: PageStats = {
    characters: 0,
    charactersNoSpaces: 0,
    words: 0,
    paragraphs: 0,
    headings: 0,
    images: 0,
    links: 0,
    tables: 0,
    diagrams: 0,
    readingMinutes: 0,
  };
  const texts: string[] = [];
  if (Array.isArray(content)) walk(content as Block[], stats, texts);
  // Blocks are separate lines, so they are joined without counting a character between them.
  const chars = (s: string) => [...s].length;
  stats.characters = texts.reduce((sum, text) => sum + chars(text), 0);
  stats.charactersNoSpaces = texts.reduce((sum, text) => sum + chars(text.replace(/\s/g, "")), 0);
  stats.words = texts.reduce((sum, text) => sum + (text.match(WORD)?.length ?? 0), 0);
  stats.readingMinutes = stats.words ? Math.max(1, Math.round(stats.words / WORDS_PER_MINUTE)) : 0;
  return stats;
}
