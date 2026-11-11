import type { ReactNode } from "react";

// The page's text, drawn at once from the saved document while the editor's code
// is still loading: headings, paragraphs, lists, quotes and code. It only reads —
// the editor replaces it as soon as it is ready. Embeds and media keep their
// place as quiet boxes so the text doesn't jump much.

type Inline = { type?: string; text?: string; styles?: Record<string, unknown>; content?: unknown; props?: Record<string, unknown> };
type Block = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: unknown };

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

function inline(content: unknown): ReactNode {
  if (typeof content === "string") return content;
  return asArray<Inline>(content).map((part, i) => {
    if (part.type === "link") return <span key={i} className="underline">{inline(part.content)}</span>;
    if (part.type !== "text" || typeof part.text !== "string") return null;
    const s = part.styles ?? {};
    let node: ReactNode = part.text;
    if (s.code) node = <code>{node}</code>;
    if (s.bold) node = <strong>{node}</strong>;
    if (s.italic) node = <em>{node}</em>;
    if (s.underline) node = <u>{node}</u>;
    if (s.strike) node = <s>{node}</s>;
    return <span key={i}>{node}</span>;
  });
}

// The same sizes and line height as the editor's headings, so the page doesn't jump when it takes over.
const HEADING = ["", "text-[3em] font-bold leading-[1.5]", "text-[2em] font-bold leading-[1.5]", "text-[1.3em] font-bold leading-[1.5]"];

// Page history: blocks of a version that differ from the current text, and a label
// for the parts drawn as boxes (tables, pictures, embeds).
export type PreviewMarks = { marks: Map<string, "changed" | "new">; boxLabel: (type: string) => string };

const MARK_CLASS = {
  changed: "-mx-2 rounded border-l-4 border-amber-500 bg-amber-500/10 px-2",
  new: "-mx-2 rounded border-l-4 border-emerald-500 bg-emerald-500/10 px-2",
};

function block(b: Block, index: number, numbers: Map<number, number>, depth: number, history?: PreviewMarks): ReactNode {
  const key = b.id ?? index;
  const kids = asArray<Block>(b.children);
  const children = kids.length > 0 && (
    <div className="ml-6">{kids.map((child, i) => block(child, i, numbers, depth + 1, history))}</div>
  );
  if (b.type !== "numberedListItem") numbers.delete(depth);
  let body: ReactNode;
  switch (b.type) {
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(b.props?.level) || 1));
      body = <div role="heading" aria-level={level} className={HEADING[level]}>{inline(b.content)}</div>;
      break;
    }
    case "subtitle":
      body = <p className="ek-subtitle">{inline(b.content)}</p>;
      break;
    case "bulletListItem":
      body = <div className="flex gap-2"><span aria-hidden>•</span><div>{inline(b.content)}</div></div>;
      break;
    case "numberedListItem": {
      const n = (numbers.get(depth) ?? 0) + 1;
      numbers.set(depth, n);
      body = <div className="flex gap-2"><span>{n}.</span><div>{inline(b.content)}</div></div>;
      break;
    }
    case "checkListItem":
      body = (
        <div className="flex gap-2">
          <input type="checkbox" checked={Boolean(b.props?.checked)} readOnly disabled className="mt-1.5" />
          <div>{inline(b.content)}</div>
        </div>
      );
      break;
    case "quote":
      body = <blockquote className="border-l-2 border-border pl-4 text-muted">{inline(b.content)}</blockquote>;
      break;
    case "codeBlock":
      body = <pre className="overflow-x-auto rounded-lg bg-surface p-4 text-sm"><code>{inline(b.content)}</code></pre>;
      break;
    case "paragraph":
    case "callout":
      body = <p className="min-h-[1.6em]">{inline(b.content)}</p>;
      break;
    default:
      // Tables, pictures, embeds: the editor draws them; hold a little room meanwhile.
      body = history ? (
        <div className="rounded-lg bg-surface px-3 py-4 text-sm text-muted">{history.boxLabel(String(b.type ?? ""))}</div>
      ) : (
        <div className="h-24 rounded-lg bg-surface" aria-hidden />
      );
  }
  const mark = history && b.id ? history.marks.get(b.id) : undefined;
  return (
    <div key={key} className={`py-[3px]${mark ? ` ${MARK_CLASS[mark]}` : ""}`} data-version-mark={mark}>
      {body}
      {children}
    </div>
  );
}

export function PagePreview({ content, history }: { content: unknown; history?: PreviewMarks }) {
  const blocks = asArray<Block>(content);
  if (blocks.length === 0) return null;
  const numbers = new Map<number, number>();
  return (
    <div
      className={`ek-editor ek-page-preview text-[17px] leading-[1.6] md:text-base ${history ? "" : "pt-12"}`}
      aria-busy={history ? undefined : true}
      data-page-preview={history ? undefined : ""}
    >
      {blocks.map((b, i) => block(b, i, numbers, 0, history))}
    </div>
  );
}

// Blocks of `version` that differ from `current` (by block id, children aside), and how
// many blocks of `current` the version doesn't have.
export function compareVersions(version: unknown, current: unknown): { marks: Map<string, "changed" | "new">; missing: number } {
  const flat = (list: unknown, into: Map<string, string>) => {
    for (const b of asArray<Block>(list)) {
      if (b.id) into.set(b.id, JSON.stringify({ type: b.type, props: b.props, content: b.content }));
      flat(b.children, into);
    }
    return into;
  };
  const was = flat(version, new Map());
  const now = flat(current, new Map());
  const marks = new Map<string, "changed" | "new">();
  for (const [id, body] of was) {
    if (!now.has(id)) marks.set(id, "new");
    else if (now.get(id) !== body) marks.set(id, "changed");
  }
  let missing = 0;
  for (const id of now.keys()) if (!was.has(id)) missing += 1;
  return { marks, missing };
}
