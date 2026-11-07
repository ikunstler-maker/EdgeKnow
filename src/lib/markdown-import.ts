// Turns Markdown from an external source into editor blocks. The result is plain
// JSON (text, styles, links, images), so no HTML or script from the source can run.
// Images get a URL from `image(url)`; links keep http(s)/mailto only.

type Styles = { bold?: true; italic?: true; strike?: true; code?: true };
type Text = { type: "text"; text: string; styles: Styles };
type Link = { type: "link"; href: string; content: Text[] };
type Inline = Text | Link;
export type ImportedBlock = {
  id: string;
  type: string;
  props: Record<string, string | number | boolean>;
  content?: Inline[];
  children: ImportedBlock[];
};

const MAX_BLOCKS = 3000;

function safeHref(raw: string, base: URL): string {
  try {
    const url = new URL(raw, base);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function parseInline(source: string, base: URL, styles: Styles = {}): Inline[] {
  const out: Inline[] = [];
  const push = (text: string, s: Styles) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === "text" && JSON.stringify(last.styles) === JSON.stringify(s)) last.text += text;
    else out.push({ type: "text", text, styles: { ...s } });
  };
  const pattern = /(`+)([\s\S]+?)\1|!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|(\*\*|__)([\s\S]+?)\7|(\*|_)([^*_\s][\s\S]*?)\9|~~([\s\S]+?)~~|\\([\\`*_{}[\]()#+\-.!~|>])/g;
  let at = 0;
  for (const m of source.matchAll(pattern)) {
    push(source.slice(at, m.index), styles);
    at = m.index + m[0].length;
    if (m[2] !== undefined) push(m[2], { ...styles, code: true });
    else if (m[4] !== undefined) push(m[3] || "", styles); // inline image: keep its alt text
    else if (m[6] !== undefined) {
      const href = safeHref(m[6], base);
      const content = parseInline(m[5], base, styles).filter((i): i is Text => i.type === "text");
      if (href) out.push({ type: "link", href, content });
      else content.forEach((c) => push(c.text, c.styles));
    } else if (m[8] !== undefined) out.push(...parseInline(m[8], base, { ...styles, bold: true }));
    else if (m[10] !== undefined) out.push(...parseInline(m[10], base, { ...styles, italic: true }));
    else if (m[11] !== undefined) out.push(...parseInline(m[11], base, { ...styles, strike: true }));
    else if (m[12] !== undefined) push(m[12], styles);
  }
  push(source.slice(at), styles);
  return out;
}

export function markdownToBlocks(markdown: string, base: URL, image: (url: string) => string | null): ImportedBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").replace(/^﻿/, "").split("\n");
  const root: ImportedBlock[] = [];
  // Open list items by indentation, so nested lists become children.
  let stack: { indent: number; block: ImportedBlock }[] = [];
  let paragraph: string[] = [];
  let count = 0;

  const make = (type: string, props: ImportedBlock["props"], text?: string): ImportedBlock => ({
    id: crypto.randomUUID(),
    type,
    props,
    ...(text !== undefined ? { content: parseInline(text, base) } : {}),
    children: [],
  });
  const add = (block: ImportedBlock, indent = -1) => {
    if (++count > MAX_BLOCKS) return;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (indent >= 0 && stack.length) stack[stack.length - 1].block.children.push(block);
    else root.push(block);
    if (indent >= 0) stack.push({ indent, block });
  };
  const flush = () => {
    if (paragraph.length) add(make("paragraph", {}, paragraph.join(" ").trim()));
    paragraph = [];
  };
  const endBlock = () => {
    flush();
    stack = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      endBlock();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      const block = make("codeBlock", { language: fence[2] || "text" });
      block.content = [{ type: "text", text: body.join("\n"), styles: {} }];
      add(block);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      endBlock();
      add(make("heading", { level: Math.min(3, heading[1].length) }, heading[2]));
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      endBlock();
      add(make("divider", {}));
      continue;
    }
    const img = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/);
    if (img) {
      endBlock();
      const url = image(img[2]);
      if (url) add(make("image", { url, name: img[1], caption: img[1], showPreview: true }));
      else if (img[1]) add(make("paragraph", {}, img[1]));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      endBlock();
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
        const cells = lines[i].trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
      }
      i--;
      const width = Math.max(...rows.map((r) => r.length));
      const block = make("table", {});
      (block as unknown as { content: unknown }).content = {
        type: "tableContent",
        rows: rows.map((r) => ({ cells: Array.from({ length: width }, (_, c) => parseInline(r[c] ?? "", base)) })),
      };
      add(block);
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      endBlock();
      const body = [quote[1]];
      for (; i + 1 < lines.length && /^\s*>/.test(lines[i + 1]); i++) body.push(lines[i + 1].replace(/^\s*>\s?/, ""));
      add(make("quote", {}, body.join(" ").trim()));
      continue;
    }
    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(\[([ xX])\]\s+)?(.*)$/);
    if (item) {
      flush();
      const indent = item[1].replace(/\t/g, "    ").length;
      if (item[3]) add(make("checkListItem", { checked: item[4] !== " " }, item[5]), indent);
      else add(make(/\d/.test(item[2]) ? "numberedListItem" : "bulletListItem", {}, item[5]), indent);
      continue;
    }
    // A wrapped line continues the open list item.
    if (stack.length && !paragraph.length && /^\s+\S/.test(line)) {
      const last = stack[stack.length - 1].block;
      last.content = [...(last.content ?? []), ...parseInline(` ${line.trim()}`, base)];
      continue;
    }
    if (stack.length) stack = [];
    paragraph.push(line.trim());
  }
  flush();
  return root;
}
