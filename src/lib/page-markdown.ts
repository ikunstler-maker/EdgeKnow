// A wiki page as Markdown (export, Free). Pure: no imports, so the Node test can load it.
// Live embeds are read beforehand with the reader's own access and passed in `data`;
// anything the reader can't see becomes "🔒 no access" without its name.

export type MdBlock = {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: MdBlock[];
};

export type MdLabels = {
  untitled: string;
  noAccess: string;
  open: string;
  image: string;
  sheet: string;
  chart: string;
  board: string;
  wishlist: string;
  vaultFile: string;
  mindmap: string;
  flow: string;
  survey: string;
  tasks: string;
  diagram: string;
  gallery: string;
  youtube: string;
  audio: string;
  navigation: string;
  empty: string;
  moreRows: (shown: number, total: number) => string;
  moreTasks: (shown: number, total: number) => string;
};

export type MdSheetTab = { name: string; rows: string[][]; totalRows: number };
export type MdSheet = { id: string; title: string; tabs: MdSheetTab[]; charts: { id: string; title: string }[] };
export type MdObject = { id: string; title: string; kind?: string };
export type MdTaskList = { key: string; name: string; tasks: { key: string; title: string; status: string; done: boolean; assignee: string | null }[]; total: number };
export type MdTaskChip = { key: string; title: string; status: string };
export type MdPage = { id: string; title: string; icon: string | null; parentId: string | null };

export type MdData = {
  // Absolute workspace address, e.g. https://site/w/abc12 (links in the file must work outside the site).
  base: string;
  pageId: string;
  pages: MdPage[];
  sheets: Record<string, MdSheet | null>;
  boards: Record<string, MdObject | null>;
  wishlists: Record<string, MdObject | null>;
  nodes: Record<string, MdObject | null>;
  surveys: Record<string, MdObject | null>;
  // Keyed by `${projectId}:${mine ? 1 : 0}`.
  taskLists: Record<string, MdTaskList | null>;
  // Missing = the reader can't see the task.
  taskChips: Record<string, MdTaskChip>;
  // Our own file → its path inside the archive; external https → itself; anything else → null.
  image: (url: string) => string | null;
};

export const MAX_SHEET_ROWS = 500;

// --- Text ---------------------------------------------------------------------------------------

const escapeText = (text: string) => text.replace(/([\\`*_[\]<>])/g, "\\$1");
const escapeCell = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
const linkText = (text: string) => text.replace(/([\\[\]])/g, "\\$1");
const linkUrl = (url: string) => url.replace(/[()\s]/g, (c) => encodeURIComponent(c));
const link = (text: string, url: string) => `[${linkText(text)}](${linkUrl(url)})`;

const str = (value: unknown) => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));

function wrapStyles(text: string, styles: Record<string, unknown> | undefined): string {
  if (!text) return "";
  if (styles?.code) return "`" + text.replace(/`/g, "'") + "`";
  let out = escapeText(text);
  // Markers can't sit next to spaces: keep the spaces outside them.
  const lead = out.match(/^\s*/)?.[0] ?? "";
  const tail = out.match(/\s*$/)?.[0] ?? "";
  let core = out.slice(lead.length, out.length - tail.length);
  if (!core) return out;
  if (styles?.bold) core = `**${core}**`;
  if (styles?.italic) core = `*${core}*`;
  if (styles?.strike) core = `~~${core}~~`;
  out = lead + core + tail;
  return out;
}

function inline(content: unknown, data: MdData, labels: MdLabels): string {
  if (typeof content === "string") return escapeText(content);
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const p = part as { type?: string; text?: string; styles?: Record<string, unknown>; href?: string; content?: unknown; props?: Record<string, unknown> };
      switch (p.type) {
        case "text":
          return wrapStyles(str(p.text), p.styles);
        case "link": {
          const text = Array.isArray(p.content) ? p.content.map((c) => str((c as { text?: string }).text)).join("") : str(p.content);
          return link(text || str(p.href), str(p.href));
        }
        case "pageChip": {
          const page = data.pages.find((pg) => pg.id === str(p.props?.pageId));
          return page ? link(`${page.icon ?? "📄"} ${page.title || labels.untitled}`, `${data.base}/p/${page.id}`) : `🔒 ${labels.noAccess}`;
        }
        case "personChip":
          return `@${escapeText(str(p.props?.label) || "?")}`;
        // The title of an event is read in the app with the reader's access; an exported file carries a mark only.
        case "eventChip":
          return "📅";
        case "taskChip": {
          const task = data.taskChips[str(p.props?.taskId)];
          if (!task) return `🔒 ${labels.noAccess}`;
          const [project, number] = [task.key.slice(0, task.key.lastIndexOf("-")), task.key.slice(task.key.lastIndexOf("-") + 1)];
          return `${link(`${task.key} ${task.title}`, `${data.base}/tasks/${project}/${number}`)}${task.status ? ` — ${escapeText(task.status)}` : ""}`;
        }
        case "chip": {
          let options: { id?: string; label?: string }[] = [];
          try {
            const parsed = JSON.parse(str(p.props?.options) || "[]");
            if (Array.isArray(parsed)) options = parsed;
          } catch {
            options = [];
          }
          const chosen = options.find((o) => o?.id === str(p.props?.value))?.label ?? "";
          return `\\[${escapeText(chosen)}\\]`;
        }
        default:
          return "";
      }
    })
    .join("");
}

// --- Embeds -------------------------------------------------------------------------------------

const noAccess = (labels: MdLabels) => `🔒 ${labels.noAccess}`;
const objectLine = (icon: string, kind: string, title: string, url: string, labels: MdLabels) =>
  `${icon} **${escapeText(kind)}: ${escapeText(title || labels.untitled)}** — ${link(labels.open, url)}`;

function sheetTable(sheet: MdSheet, data: MdData, labels: MdLabels): string[] {
  const url = `${data.base}/sheets/${sheet.id}`;
  const lines = [objectLine("📊", labels.sheet, sheet.title, url, labels)];
  for (const tab of sheet.tabs) {
    if (sheet.tabs.length > 1) lines.push("", `**${escapeText(tab.name)}**`);
    const width = Math.max(0, ...tab.rows.map((row) => row.length));
    if (!tab.rows.length || !width) {
      lines.push("", `*${labels.empty}*`);
      continue;
    }
    const rows = tab.rows.map((row) => Array.from({ length: width }, (_, i) => escapeCell(row[i] ?? "")));
    lines.push("", `| ${rows[0].join(" | ")} |`, `| ${rows[0].map(() => "---").join(" | ")} |`);
    for (const row of rows.slice(1)) lines.push(`| ${row.join(" | ")} |`);
    if (tab.totalRows > tab.rows.length) lines.push("", `*${escapeText(labels.moreRows(tab.rows.length, tab.totalRows))}* ${link(labels.open, url)}`);
  }
  return lines;
}

function galleryLines(props: Record<string, unknown>, data: MdData, labels: MdLabels): string[] {
  let items: { kind?: string; url?: string; caption?: string; title?: string }[] = [];
  try {
    const parsed = JSON.parse(str(props.items) || "[]");
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    items = [];
  }
  const lines = [`🖼 **${escapeText(labels.gallery)}**`, ""];
  for (const item of items) {
    const caption = str(item?.caption) || str(item?.title);
    const url = str(item?.url);
    if (item?.kind === "image") {
      const src = data.image(url);
      lines.push(src ? `![${linkText(caption)}](${linkUrl(src)})` : `- ${escapeText(caption || labels.image)}`);
    } else if (item?.kind === "youtube") {
      lines.push(`- ▶️ ${link(caption || labels.youtube, url)}`);
    } else if (item?.kind === "audio") {
      const src = data.image(url);
      lines.push(src ? `- 🎵 ${link(caption || labels.audio, src)}` : `- 🎵 ${escapeText(caption || labels.audio)}`);
    }
  }
  return items.length ? lines : [lines[0]];
}

function diagramLines(props: Record<string, unknown>, labels: MdLabels): string[] {
  const lines = [`🔷 **${escapeText(labels.diagram)}**`];
  try {
    const parsed = JSON.parse(str(props.data) || "{}") as { nodes?: { id?: string; title?: string; emoji?: string }[]; edges?: { source?: string; target?: string; label?: string }[] };
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    const name = (id: string | undefined) => {
      const node = nodes.find((n) => n?.id === id);
      return `${node?.emoji ? `${node.emoji} ` : ""}${str(node?.title).trim()}`.trim() || "…";
    };
    const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
    // Links as "A → B", then boxes without any link.
    const linked = new Set(edges.flatMap((edge) => [edge?.source, edge?.target]));
    const out = [
      ...edges.map((edge) => {
        const label = str(edge?.label).trim();
        return `- ${escapeText(name(edge?.source))} →${label ? ` (${escapeText(label)})` : ""} ${escapeText(name(edge?.target))}`;
      }),
      ...nodes.filter((node) => !linked.has(node?.id)).map((node) => `- ${escapeText(name(node?.id))}`),
    ];
    if (out.length) lines.push("", ...out);
  } catch {
    // An unreadable diagram is just its name.
  }
  return lines;
}

function navigationLines(props: Record<string, unknown>, data: MdData, labels: MdLabels): string[] {
  const list = props.scope === "workspace" ? data.pages.filter((p) => p.parentId === null) : data.pages.filter((p) => p.parentId === data.pageId);
  return [`🧭 **${escapeText(labels.navigation)}**`, "", ...list.map((p) => `- ${link(`${p.icon ?? "📄"} ${p.title || labels.untitled}`, `${data.base}/p/${p.id}`)}`)];
}

// --- Blocks -------------------------------------------------------------------------------------

function tableLines(content: unknown, data: MdData, labels: MdLabels): string[] {
  const rows = (content as { rows?: { cells?: unknown[] }[] } | undefined)?.rows ?? [];
  const cells = rows.map((row) =>
    (row.cells ?? []).map((cell) => {
      const inner = cell && typeof cell === "object" && !Array.isArray(cell) && (cell as { type?: string }).type === "tableCell" ? (cell as { content?: unknown }).content : cell;
      return escapeCell(inline(inner, data, labels));
    }),
  );
  const width = Math.max(0, ...cells.map((r) => r.length));
  if (!cells.length || !width) return [];
  const full = cells.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  return [`| ${full[0].join(" | ")} |`, `| ${full[0].map(() => "---").join(" | ")} |`, ...full.slice(1).map((r) => `| ${r.join(" | ")} |`)];
}

function blockLines(block: MdBlock, data: MdData, labels: MdLabels): string[] {
  const props = block.props ?? {};
  const text = () => inline(block.content, data, labels);
  switch (block.type) {
    case "heading":
      return [`${"#".repeat(Math.min(6, Math.max(1, Number(props.level) || 1) + 1))} ${text()}`];
    case "subtitle":
      return [`*${text()}*`];
    case "paragraph":
      return [text()];
    case "quote":
      return [`> ${text()}`];
    case "callout":
      return [`> ${{ info: "ℹ️", warning: "⚠️", success: "✅", error: "⛔" }[str(props.variant)] ?? "ℹ️"} ${text()}`];
    case "codeBlock": {
      const code = Array.isArray(block.content) ? block.content.map((c) => str((c as { text?: string }).text)).join("") : str(block.content);
      const fence = code.includes("```") ? "````" : "```";
      const language = str(props.language);
      return [`${fence}${language === "text" ? "" : language}`, code, fence];
    }
    case "divider":
      return ["---"];
    case "table":
      return tableLines(block.content, data, labels);
    case "image": {
      const src = data.image(str(props.url));
      const caption = str(props.caption) || str(props.name);
      if (!src) return [`*${escapeText(caption || labels.image)}*`];
      const lines = [`![${linkText(caption)}](${linkUrl(src)})`];
      if (str(props.caption)) lines.push("", `*${escapeText(str(props.caption))}*`);
      return lines;
    }
    case "youtube":
      return str(props.url) ? [`▶️ ${link(str(props.title) || labels.youtube, str(props.url))}`] : [];
    case "linkCard": {
      const url = str(props.url);
      if (!url) return [];
      const description = str(props.description);
      return [`🔗 ${link(str(props.title) || url, url)}${description ? ` — ${escapeText(description)}` : ""}`];
    }
    case "gallery":
      return galleryLines(props, data, labels);
    case "diagram":
      return diagramLines(props, labels);
    case "navigation":
      return navigationLines(props, data, labels);
    case "sheetEmbed": {
      const id = str(props.sheetId);
      if (!id) return [];
      const sheet = data.sheets[id];
      if (!sheet) return [noAccess(labels)];
      const chartId = str(props.chartId);
      if (chartId) {
        const chart = sheet.charts.find((c) => c.id === chartId);
        return [objectLine("📈", labels.chart, `${sheet.title || labels.untitled}${chart ? ` · ${chart.title}` : ""}`, `${data.base}/sheets/${sheet.id}`, labels)];
      }
      return sheetTable(sheet, data, labels);
    }
    case "boardEmbed": {
      const id = str(props.boardId);
      if (!id) return [];
      const board = data.boards[id];
      return board ? [objectLine("🧷", labels.board, board.title, `${data.base}/boards/${board.id}`, labels)] : [noAccess(labels)];
    }
    case "wishlistEmbed": {
      const id = str(props.wishlistId);
      if (!id) return [];
      const wl = data.wishlists[id];
      return wl ? [objectLine("🎁", labels.wishlist, wl.title, `${data.base}/wishlists/${wl.id}`, labels)] : [noAccess(labels)];
    }
    case "vaultFile": {
      // Only a link: the file's name may not be the reader's to see.
      const id = str(props.fileId);
      return id ? [`[${labels.vaultFile}](${data.base}/files?file=${id})`] : [];
    }
    case "nodeMap": {
      const id = str(props.objectId);
      if (!id) return [];
      const map = data.nodes[id];
      return map ? [objectLine(map.kind === "flow" ? "🔀" : "🧠", map.kind === "flow" ? labels.flow : labels.mindmap, map.title, `${data.base}/nodes/${map.id}`, labels)] : [noAccess(labels)];
    }
    case "surveyEmbed": {
      const id = str(props.surveyId);
      if (!id) return [];
      const survey = data.surveys[id];
      return survey ? [objectLine("📝", labels.survey, survey.title, `${data.base}/surveys/${survey.id}`, labels)] : [noAccess(labels)];
    }
    case "tasks": {
      const projectId = str(props.projectId);
      if (!projectId) return [];
      const list = data.taskLists[`${projectId}:${props.mine ? 1 : 0}`];
      if (!list) return [noAccess(labels)];
      const lines = [objectLine("✅", labels.tasks, list.name, `${data.base}/tasks/${list.key}`, labels), ""];
      for (const task of list.tasks) {
        const [project, number] = [task.key.slice(0, task.key.lastIndexOf("-")), task.key.slice(task.key.lastIndexOf("-") + 1)];
        const extra = [task.status, task.assignee].filter(Boolean).map((s) => escapeText(String(s))).join(", ");
        lines.push(`- [${task.done ? "x" : " "}] ${link(`${task.key} ${task.title}`, `${data.base}/tasks/${project}/${number}`)}${extra ? ` — ${extra}` : ""}`);
      }
      if (!list.tasks.length) lines.push(`*${labels.empty}*`);
      if (list.total > list.tasks.length) lines.push("", `*${escapeText(labels.moreTasks(list.tasks.length, list.total))}*`);
      return lines;
    }
    default:
      return block.content !== undefined ? [text()] : [];
  }
}

const LIST_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem", "toggleListItem"]);

function listMarker(block: MdBlock, index: number): string {
  if (block.type === "numberedListItem") return `${index}.`;
  if (block.type === "checkListItem") return block.props?.checked ? "- [x]" : "- [ ]";
  return "-";
}

const indent = (lines: string[], by: string) => lines.map((line) => (line ? by + line : line));

function renderBlocks(blocks: MdBlock[], data: MdData, labels: MdLabels): string[] {
  const out: string[] = [];
  let number = 0;
  let previousList = false;
  for (const block of blocks) {
    const isList = LIST_TYPES.has(block.type);
    number = block.type === "numberedListItem" ? number + 1 : 0;
    const children = block.children?.length ? renderBlocks(block.children, data, labels) : [];
    if (isList) {
      const marker = listMarker(block, number);
      if (out.length && !previousList) out.push("");
      out.push(`${marker} ${inline(block.content, data, labels)}`.trimEnd());
      if (children.length) out.push(...indent(children, " ".repeat(marker.length + 1)));
    } else {
      const lines = blockLines(block, data, labels);
      if (!lines.length && !children.length) {
        previousList = false;
        continue;
      }
      if (out.length) out.push("");
      out.push(...lines);
      // Text nested under a block (BlockNote's indent) stays under it.
      if (children.length) out.push("", ...indent(children, "    "));
    }
    previousList = isList;
  }
  return out;
}

export function pageToMarkdown(title: string, icon: string | null, blocks: unknown, data: MdData, labels: MdLabels): string {
  const list = Array.isArray(blocks) ? (blocks as MdBlock[]) : [];
  const body = renderBlocks(list, data, labels);
  // Empty trailing paragraphs and runs of blank lines collapse.
  const text = [`# ${icon ? `${icon} ` : ""}${escapeText(title || labels.untitled)}`, "", ...body].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return `${text}\n`;
}

// The ids of everything on the page the export has to read first.
export function collectRefs(blocks: unknown) {
  const refs = { sheets: new Set<string>(), boards: new Set<string>(), wishlists: new Set<string>(), nodes: new Set<string>(), surveys: new Set<string>(), taskLists: new Set<string>(), taskChips: new Set<string>(), files: new Set<string>() };
  const walkInline = (content: unknown) => {
    if (!Array.isArray(content)) return;
    for (const part of content) {
      const p = part as { type?: string; props?: Record<string, unknown>; content?: unknown };
      if (p?.type === "taskChip" && p.props?.taskId) refs.taskChips.add(str(p.props.taskId));
      if (p?.type === "tableCell") walkInline(p.content);
    }
  };
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      const block = raw as MdBlock;
      const props = block.props ?? {};
      if (block.type === "sheetEmbed" && props.sheetId) refs.sheets.add(str(props.sheetId));
      if (block.type === "boardEmbed" && props.boardId) refs.boards.add(str(props.boardId));
      if (block.type === "wishlistEmbed" && props.wishlistId) refs.wishlists.add(str(props.wishlistId));
      if (block.type === "nodeMap" && props.objectId) refs.nodes.add(str(props.objectId));
      if (block.type === "surveyEmbed" && props.surveyId) refs.surveys.add(str(props.surveyId));
      if (block.type === "tasks" && props.projectId) refs.taskLists.add(`${str(props.projectId)}:${props.mine ? 1 : 0}`);
      if (block.type === "image" && props.url) refs.files.add(str(props.url));
      if (block.type === "gallery") {
        try {
          const items = JSON.parse(str(props.items) || "[]");
          if (Array.isArray(items)) for (const item of items) if ((item?.kind === "image" || item?.kind === "audio") && typeof item.url === "string") refs.files.add(item.url);
        } catch {
          // Unreadable gallery: nothing to fetch.
        }
      }
      if (block.type === "table") for (const row of (block.content as { rows?: { cells?: unknown[] }[] })?.rows ?? []) for (const cell of row.cells ?? []) walkInline(Array.isArray(cell) ? cell : [cell]);
      else walkInline(block.content);
      walk(block.children);
    }
  };
  walk(blocks);
  return refs;
}
