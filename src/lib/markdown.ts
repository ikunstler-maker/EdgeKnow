// A readable Markdown copy of a page for backups. Lossy on purpose (the JSON copy
// next to it is exact): text, headings, lists, quotes, code, tables, images and
// the custom blocks as plain text.

type Inline = { type?: string; text?: string; styles?: Record<string, unknown>; href?: string; content?: Inline[]; props?: Record<string, unknown> };
type Block = { type?: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };

function inline(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return (items as Inline[])
    .map((item) => {
      if (item.type === "link") return `[${inline(item.content)}](${item.href ?? ""})`;
      if (item.type === "chip") {
        try {
          const options = JSON.parse(String(item.props?.options ?? "[]")) as { id: string; label: string }[];
          return `[${options.find((o) => o.id === item.props?.value)?.label ?? ""}]`;
        } catch {
          return "";
        }
      }
      if (item.type === "personChip") return `@${String(item.props?.label ?? "")}`;
      if (item.type === "pageChip") return "[→ page]";
      if (item.type === "taskChip") return "[task]";
      let text = item.text ?? "";
      if (!text) return "";
      const s = item.styles ?? {};
      if (s.code || s.mono) text = `\`${text}\``;
      if (s.bold) text = `**${text}**`;
      if (s.italic) text = `*${text}*`;
      if (s.strike) text = `~~${text}~~`;
      return text;
    })
    .join("");
}

function table(content: unknown): string[] {
  const rows = (content as { rows?: { cells?: unknown[] }[] })?.rows ?? [];
  const lines = rows.map((row) => `| ${(row.cells ?? []).map((cell) => inline(Array.isArray(cell) ? cell : (cell as { content?: unknown })?.content).replace(/\|/g, "\\|")).join(" | ")} |`);
  if (lines.length) lines.splice(1, 0, `|${" --- |".repeat((rows[0]?.cells ?? []).length)}`);
  return lines;
}

function blocks(list: Block[], depth: number, out: string[]) {
  let number = 0;
  for (const block of list) {
    const indent = "  ".repeat(depth);
    const text = inline(block.content);
    const p = block.props ?? {};
    number = block.type === "numberedListItem" ? number + 1 : 0;
    switch (block.type) {
      case "heading":
        out.push(`${"#".repeat(Math.min(4, Number(p.level ?? 1)))} ${text}`, "");
        break;
      case "subtitle":
        out.push(`*${text}*`, "");
        break;
      case "bulletListItem":
      case "toggleListItem":
        out.push(`${indent}- ${text}`);
        break;
      case "numberedListItem":
        out.push(`${indent}${number}. ${text}`);
        break;
      case "checkListItem":
        out.push(`${indent}- [${p.checked ? "x" : " "}] ${text}`);
        break;
      case "quote":
        out.push(`> ${text}`, "");
        break;
      case "callout":
        out.push(`> **${String(p.variant ?? "info")}:** ${text}`, "");
        break;
      case "codeBlock":
        out.push(`\`\`\`${String(p.language ?? "")}`, text, "```", "");
        break;
      case "divider":
        out.push("---", "");
        break;
      case "table":
        out.push(...table(block.content), "");
        break;
      case "image":
        out.push(`![${String(p.name ?? "")}](${String(p.url ?? "")})`, "");
        break;
      case "gallery":
        // Each item as a line: images as pictures, videos and audio as links.
        try {
          const list = JSON.parse(String(p.items || "[]")) as { kind?: string; url?: string; caption?: string; title?: string }[];
          for (const item of list) {
            const name = String(item.caption || item.title || "");
            out.push(item.kind === "image" ? `![${name}](${String(item.url ?? "")})` : `- [${name || String(item.url ?? "")}](${String(item.url ?? "")})`);
          }
          out.push("");
        } catch {
          // A broken gallery adds nothing.
        }
        break;
      case "youtube":
      case "linkCard":
        out.push(`[${String(p.title || p.url || "")}](${String(p.url ?? "")})`, "");
        break;
      case "diagram":
        try {
          const data = JSON.parse(String(p.data || "{}")) as { nodes?: { id: string; title?: string }[]; edges?: { source: string; target: string }[] };
          const title = new Map((data.nodes ?? []).map((n) => [n.id, n.title || "—"]));
          out.push(...(data.nodes ?? []).map((n) => `- ▭ ${n.title || "—"}`), ...(data.edges ?? []).map((e) => `- ${title.get(e.source)} → ${title.get(e.target)}`), "");
        } catch {
          out.push("");
        }
        break;
      case "navigation":
        break;
      default:
        out.push(text, "");
    }
    if (block.children?.length) blocks(block.children, depth + 1, out);
  }
}

export function pageToMarkdown(title: string, content: unknown): string {
  const out = [`# ${title}`, ""];
  if (Array.isArray(content)) blocks(content as Block[], 0, out);
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
