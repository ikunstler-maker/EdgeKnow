// Moving tasks in from another tracker (Rukh, step Р-3а): the pure part — what the
// tracker says turned into what our tasks hold. No network and no database here, so
// it is tested by itself (scripts/test-tracker-import.mjs).

export type OurType = "task" | "bug" | "idea" | "epic";
export type OurPriority = "lowest" | "low" | "medium" | "high" | "highest";
export type OurCategory = "todo" | "doing" | "review" | "done";
export type OurFieldKind = "text" | "number" | "date" | "select" | "multiselect" | "person" | "url";

export type TrackerUser = { id: string; name: string; email: string | null };
// A role of the tracker's project and the ids of the people who hold it directly.
export type TrackerRole = { name: string; users: string[] };
export type OurRole = "owner" | "editor" | "commenter" | "viewer";
export const OUR_ROLES: OurRole[] = ["owner", "editor", "commenter", "viewer"];
export type TrackerStatus = { id: string; name: string; category: OurCategory };
export type TrackerType = { id: string; name: string; subtask: boolean; epic: boolean };
export type TrackerField = { id: string; name: string; kind: OurFieldKind };
export type TrackerLink = { kind: "blocks" | "relates" | "duplicates"; other: string; outgoing: boolean };
export type TrackerIssue = {
  key: string;
  url: string;
  title: string;
  description: unknown;
  status: string;
  type: string;
  priority: string | null;
  assignee: TrackerUser | null;
  reporter: TrackerUser | null;
  labels: string[];
  due: string | null;
  estimateSeconds: number | null;
  created: string;
  updated: string;
  resolved: string | null;
  parent: string | null;
  links: TrackerLink[];
  // The tracker limits who sees this task (it comes over private).
  restricted: boolean;
  // Every other field as the tracker gave it (custom fields by their id).
  raw: Record<string, unknown>;
};

// How the tracker's things map to ours; made in the wizard, kept with the import.
export type ImportMapping = {
  // tracker status id → our column id
  statuses: Record<string, string>;
  // tracker type id → our type
  types: Record<string, OurType>;
  // tracker priority name → ours
  priorities: Record<string, OurPriority>;
  // tracker user id → our member id (null: keep the name as text)
  people: Record<string, string | null>;
  // tracker custom field id → our field (options: tracker's value → our option id)
  fields: Record<string, { id: string; kind: OurFieldKind; options?: Record<string, string> }>;
  // The tracker field that holds the start date, if any.
  startField: string | null;
  // tracker user id → the role of ours their tracker roles map to (highest of them)
  personRoles?: Record<string, OurRole | null>;
  // A catch-up run: only what changed in the tracker since this moment. And when the run
  // now going began (it becomes the next run's "since").
  since?: string | null;
  runStarted?: string;
  // Where the move of files stands between steps (server only; see lib/tracker/files).
  fileWork?: unknown;
  // tracker user id → the names of their roles in the tracker's project
  trackerRoles?: Record<string, string[]>;
};

// ---- Formatted text: the tracker's document → our editor's blocks ---------------------------

type Adf = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Adf[]; marks?: { type?: string; attrs?: Record<string, unknown> }[] };
type Text = { type: "text"; text: string; styles: Record<string, boolean> };
type Inline = Text | { type: "link"; href: string; content: Text[] };
export type Block = { type: string; props?: Record<string, unknown>; content?: Inline[] | { type: "tableContent"; headerRows?: number; rows: { cells: Inline[][] }[] }; children?: Block[] };

const str = (value: unknown) => (typeof value === "string" ? value : "");
const safeHref = (value: unknown) => (/^(https?:\/\/|mailto:)/i.test(str(value)) ? str(value) : null);
const MARKS: Record<string, string> = { strong: "bold", em: "italic", underline: "underline", strike: "strike", code: "code" };

function inlineOf(nodes: Adf[] | undefined): Inline[] {
  const out: Inline[] = [];
  const push = (text: string, marks: Adf["marks"] = []) => {
    if (!text) return;
    const styles: Record<string, boolean> = {};
    let href: string | null = null;
    for (const mark of marks ?? []) {
      if (mark.type && MARKS[mark.type]) styles[MARKS[mark.type]] = true;
      if (mark.type === "link") href = safeHref(mark.attrs?.href);
    }
    const piece: Text = { type: "text", text, styles };
    if (href) return void out.push({ type: "link", href, content: [piece] });
    const last = out.at(-1);
    // Neighbours of one style are one run.
    if (last?.type === "text" && JSON.stringify(last.styles) === JSON.stringify(styles)) last.text += text;
    else out.push(piece);
  };
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "text":
        push(str(node.text), node.marks);
        break;
      case "hardBreak":
        push("\n");
        break;
      case "mention":
        push(`@${str(node.attrs?.text).replace(/^@/, "") || "?"}`);
        break;
      case "emoji":
        push(str(node.attrs?.text) || str(node.attrs?.shortName));
        break;
      case "date": {
        const at = Number(node.attrs?.timestamp);
        push(Number.isFinite(at) && at > 0 ? new Date(at).toISOString().slice(0, 10) : "");
        break;
      }
      case "status":
        push(`[${str(node.attrs?.text)}]`);
        break;
      case "inlineCard":
      case "blockCard":
      case "embedCard": {
        const href = safeHref(node.attrs?.url);
        if (href) out.push({ type: "link", href, content: [{ type: "text", text: href, styles: {} }] });
        break;
      }
      case "media":
      case "mediaInline":
        push(`[${str(node.attrs?.alt) || str(node.attrs?.__fileName) || "file"}]`);
        break;
      default:
        out.push(...inlineOf(node.content));
    }
  }
  return out;
}

const plainOf = (nodes: Adf[] | undefined): string =>
  (nodes ?? []).map((n) => (n.type === "text" ? str(n.text) : n.type === "hardBreak" ? "\n" : plainOf(n.content))).join("");

function listItems(node: Adf, type: string, depth: number): Block[] {
  return (node.content ?? []).map((item) => {
    // The first paragraph is the item's own line; the rest hangs under it.
    const [first, ...rest] = item.content ?? [];
    const own = first?.type === "paragraph" ? first.content : undefined;
    const below = blocksOf(own ? rest : (item.content ?? []), depth + 1);
    return { type, content: inlineOf(own), ...(below.length ? { children: below } : {}) };
  });
}

function blocksOf(nodes: Adf[] | undefined, depth = 0): Block[] {
  const out: Block[] = [];
  if (depth > 8) return out;
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "paragraph":
        out.push({ type: "paragraph", content: inlineOf(node.content) });
        break;
      case "heading":
        out.push({ type: "heading", props: { level: Math.min(3, Math.max(1, Number(node.attrs?.level) || 1)) }, content: inlineOf(node.content) });
        break;
      case "bulletList":
        out.push(...listItems(node, "bulletListItem", depth));
        break;
      case "orderedList":
        out.push(...listItems(node, "numberedListItem", depth));
        break;
      case "taskList":
        for (const item of node.content ?? []) {
          if (item.type === "taskList") out.push(...blocksOf([item], depth + 1));
          else out.push({ type: "checkListItem", props: { checked: item.attrs?.state === "DONE" }, content: inlineOf(item.content) });
        }
        break;
      case "codeBlock":
        out.push({ type: "codeBlock", props: { language: str(node.attrs?.language) || "text" }, content: [{ type: "text", text: plainOf(node.content), styles: {} }] });
        break;
      case "blockquote":
      case "panel":
        for (const inner of blocksOf(node.content, depth + 1)) out.push(inner.type === "paragraph" ? { ...inner, type: "quote" } : inner);
        break;
      case "rule":
        out.push({ type: "divider" });
        break;
      case "table": {
        const rows = (node.content ?? []).filter((row) => row.type === "tableRow");
        const width = Math.max(1, ...rows.map((row) => row.content?.length ?? 0));
        if (!rows.length) break;
        out.push({
          type: "table",
          content: {
            type: "tableContent",
            headerRows: rows[0].content?.some((cell) => cell.type === "tableHeader") ? 1 : 0,
            rows: rows.map((row) => ({
              // A cell's paragraphs become one run of text, a line break between them.
              cells: Array.from({ length: width }, (_, i) =>
                (row.content?.[i]?.content ?? []).flatMap((part, at) => [...(at ? [{ type: "text", text: "\n", styles: {} } as Text] : []), ...inlineOf(part.content ?? [part])]),
              ),
            })),
          },
        });
        break;
      }
      case "mediaSingle":
      case "mediaGroup":
        // The files themselves arrive in the next step; here only their place is marked.
        out.push({ type: "paragraph", content: inlineOf(node.content) });
        break;
      case "expand":
      case "nestedExpand":
        if (str(node.attrs?.title)) out.push({ type: "paragraph", content: [{ type: "text", text: str(node.attrs?.title), styles: { bold: true } }] });
        out.push(...blocksOf(node.content, depth + 1));
        break;
      default:
        if (node.content?.length) out.push(...blocksOf(node.content, depth + 1));
    }
  }
  return out;
}

// The tracker's formatted text (or a plain string from an older one) as editor blocks.
export function documentToBlocks(value: unknown): Block[] | null {
  if (typeof value === "string") {
    const lines = value.split(/\r?\n/).filter((line, i, all) => line.trim() || (i > 0 && all[i - 1].trim()));
    return lines.length ? lines.map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line, styles: {} }] : [] })) : null;
  }
  if (!value || typeof value !== "object") return null;
  const blocks = blocksOf((value as Adf).content);
  return blocks.length ? blocks : null;
}

// ---- Suggestions for the wizard --------------------------------------------------------------

export const numberOfKey = (key: string) => {
  const number = Number(key.split("-").at(-1));
  return Number.isInteger(number) && number > 0 ? number : null;
};

// Formatted text as plain lines: a comment of ours is text.
export function documentToText(value: unknown): string {
  const inline = (content: unknown): string => {
    if (!Array.isArray(content)) return "";
    return content
      .map((part) => {
        const node = part as { type?: string; text?: string; href?: string; content?: unknown };
        if (node.type === "link") return `${inline(node.content)}${node.href && inline(node.content) !== node.href ? ` (${node.href})` : ""}`;
        return typeof node.text === "string" ? node.text : "";
      })
      .join("");
  };
  const lines: string[] = [];
  const walk = (blocks: Block[], depth: number) => {
    for (const block of blocks) {
      const raw = block as unknown as { type: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };
      const pad = "  ".repeat(depth);
      const table = raw.content as { rows?: { cells?: unknown[] }[] } | undefined;
      if (raw.type === "table" && table?.rows) {
        for (const row of table.rows) lines.push(pad + (row.cells ?? []).map((cell) => inline(Array.isArray(cell) ? cell : (cell as { content?: unknown })?.content)).join(" | "));
      } else if (raw.type === "divider") {
        lines.push(`${pad}———`);
      } else {
        const mark = raw.type === "bulletListItem" ? "• " : raw.type === "numberedListItem" ? "– " : raw.type === "checkListItem" ? (raw.props?.checked ? "[x] " : "[ ] ") : "";
        lines.push(pad + mark + inline(raw.content));
      }
      if (raw.children?.length) walk(raw.children, depth + 1);
    }
  };
  walk(documentToBlocks(value) ?? [], 0);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---- What happened to a task in the tracker: comments and its way through the statuses ----

export type TrackerComment = { id: string; author: TrackerUser | null; body: unknown; created: string; updated: string | null };
export type TrackerMove = { id: string; author: TrackerUser | null; from: string | null; to: string; at: string };
// Time someone wrote down on the task in the tracker.
export type TrackerWorklog = { id: string; author: TrackerUser | null; seconds: number; started: string; note: unknown };
export type TrackerActivity = { key: string; comments: TrackerComment[]; moves: TrackerMove[]; worklogs?: TrackerWorklog[] };
export type ImportTimeItem = { external_key: string; entries: { external_id: string; author_ext: string | null; minutes: number; spent_on: string; note: string | null }[] };

export function parseWorklogs(value: unknown): TrackerWorklog[] {
  return (Array.isArray(value) ? value : []).flatMap((raw) => {
    const log = obj(raw);
    const id = str(log.id);
    const started = str(log.started);
    const seconds = typeof log.timeSpentSeconds === "number" ? log.timeSpentSeconds : 0;
    if (!id || !/^\d{4}-\d{2}-\d{2}/.test(started) || seconds <= 0) return [];
    return [{ id, author: parseUser(log.author), seconds, started, note: log.comment ?? null }];
  });
}

// The day is the one the tracker shows (the entry's own time zone), not turned into ours.
export function toTimeItem(activity: TrackerActivity): ImportTimeItem {
  return {
    external_key: activity.key,
    entries: (activity.worklogs ?? []).map((log) => ({
      external_id: log.id.slice(0, 100),
      author_ext: log.author?.id ?? null,
      minutes: Math.max(1, Math.round(log.seconds / 60)),
      spent_on: log.started.slice(0, 10),
      note: documentToText(log.note).slice(0, 500) || null,
    })),
  };
}
export type ImportActivityItem = {
  external_key: string;
  comments: { external_id: string; author_ext: string | null; body: string; created_at: string; edited_at: string | null }[];
  moves: { external_id: string; actor_ext: string | null; from_status: string | null; to_status: string; at: string }[];
};

export function parseComments(value: unknown): TrackerComment[] {
  return (Array.isArray(value) ? value : []).flatMap((raw) => {
    const comment = obj(raw);
    const id = str(comment.id);
    const created = str(comment.created);
    if (!id || !created) return [];
    const updated = str(comment.updated);
    return [{ id, author: parseUser(comment.author), body: comment.body ?? null, created, updated: updated && updated !== created ? updated : null }];
  });
}

// Each change of status in the task's history (one history entry can hold several fields).
export function parseMoves(value: unknown): TrackerMove[] {
  return (Array.isArray(value) ? value : []).flatMap((raw) => {
    const history = obj(raw);
    const id = str(history.id);
    const at = str(history.created);
    if (!id || !at) return [];
    return (Array.isArray(history.items) ? history.items : []).flatMap((entry) => {
      const item = obj(entry);
      const to = str(item.to);
      return str(item.field) === "status" && to ? [{ id, author: parseUser(history.author), from: str(item.from) || null, to, at }] : [];
    });
  });
}

// A file attached to a task in the tracker.
export type TrackerFile = { id: string; name: string; mime: string; size: number; author: TrackerUser | null; created: string };
export function parseFiles(value: unknown): TrackerFile[] {
  return (Array.isArray(value) ? value : []).flatMap((raw) => {
    const file = obj(raw);
    const id = str(file.id);
    if (!/^[0-9A-Za-z_-]{1,100}$/.test(id)) return [];
    return [{ id, name: (str(file.filename) || id).slice(0, 200), mime: str(file.mimeType).toLowerCase() || "application/octet-stream", size: typeof file.size === "number" ? file.size : 0, author: parseUser(file.author), created: str(file.created) }];
  });
}
export const FILE_LIMIT = 250 * 1024 * 1024;
export const ZIP_LIMIT = 10 * 1024 * 1024 * 1024;
export const fileLimit = (file: Pick<TrackerFile, "mime">) => (file.mime === "application/zip" ? ZIP_LIMIT : FILE_LIMIT);

export function toActivityItem(activity: TrackerActivity, mapping: ImportMapping): { item: ImportActivityItem; problems: string[] } {
  const problems: string[] = [];
  const comments = activity.comments.flatMap((comment) => {
    const text = documentToText(comment.body);
    if (!text) return [];
    if (text.length > 10000) problems.push("comment_cut");
    return [{ external_id: comment.id.slice(0, 100), author_ext: comment.author?.id ?? null, body: text.slice(0, 10000), created_at: comment.created, edited_at: comment.updated }];
  });
  const moves = activity.moves
    .flatMap((move) => {
      const to = mapping.statuses[move.to];
      return to ? [{ external_id: move.id.slice(0, 100), actor_ext: move.author?.id ?? null, from_status: (move.from && mapping.statuses[move.from]) || null, to_status: to, at: move.at }] : [];
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { item: { external_key: activity.key, comments, moves }, problems };
}

export function suggestType(type: TrackerType): OurType {
  const name = type.name.toLowerCase();
  if (type.epic || /epic|епік/.test(name)) return "epic";
  if (/bug|defect|помилк|баг/.test(name)) return "bug";
  if (/idea|ідея|improvement|feature/.test(name)) return "idea";
  return "task";
}

export function suggestPriority(name: string): OurPriority {
  const n = name.toLowerCase();
  if (/highest|blocker|critical|найвищ|критич/.test(n)) return "highest";
  if (/high|major|висок/.test(n)) return "high";
  if (/lowest|trivial|найнижч/.test(n)) return "lowest";
  if (/low|minor|низьк/.test(n)) return "low";
  return "medium";
}

const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

// A tracker status goes to our column of the same name, else to one of the same kind.
export function suggestStatus(status: TrackerStatus, columns: { id: string; name: string; category: string }[]): string | null {
  return (columns.find((c) => sameName(c.name, status.name)) ?? columns.find((c) => c.category === status.category))?.id ?? null;
}

// People are matched by email when the tracker shows it, else by a name only one member has.
export function matchPeople(users: TrackerUser[], members: { id: string; name: string | null; email: string }[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const user of users) {
    const byEmail = user.email ? members.find((m) => m.email.toLowerCase() === user.email!.toLowerCase()) : undefined;
    const byName = members.filter((m) => m.name && sameName(m.name, user.name));
    out[user.id] = byEmail?.id ?? (byName.length === 1 ? byName[0].id : null);
  }
  return out;
}

// The role of ours a person gets: the highest among those their tracker roles map to.
export function personRoles(roles: TrackerRole[], chosen: Record<string, OurRole | null>): { ours: Record<string, OurRole | null>; theirs: Record<string, string[]> } {
  const ours: Record<string, OurRole | null> = {};
  const theirs: Record<string, string[]> = {};
  for (const role of roles) {
    const mapped = chosen[role.name] ?? null;
    for (const user of role.users) {
      theirs[user] = [...(theirs[user] ?? []), role.name].slice(0, 20);
      const now = ours[user] ?? null;
      if (mapped && (!now || OUR_ROLES.indexOf(mapped) < OUR_ROLES.indexOf(now))) ours[user] = mapped;
      else if (!(user in ours)) ours[user] = null;
    }
  }
  return { ours, theirs };
}

// A sensible first guess for a tracker role by its name.
export function suggestRole(name: string): OurRole | null {
  const n = name.toLowerCase();
  if (/admin|адмін|owner|власник/.test(n)) return "owner";
  if (/view|read|observer|перегляд|спостер/.test(n)) return "viewer";
  if (/comment|client|customer|комент|клієнт/.test(n)) return "commenter";
  if (/atlassian-addons/.test(n)) return null;
  return "editor";
}

// What import_people takes for these tracker people.
export type ImportPersonItem = { external_id: string; name: string; email: string | null; roles: string[]; project_role: OurRole | null; user_id: string | null };
export function toPersonItems(users: TrackerUser[], mapping: ImportMapping): ImportPersonItem[] {
  const seen = new Set<string>();
  return users.flatMap((user) => {
    if (!user.id || !user.name.trim() || seen.has(user.id)) return [];
    seen.add(user.id);
    return [{ external_id: user.id.slice(0, 200), name: user.name.trim().slice(0, 120), email: user.email, roles: mapping.trackerRoles?.[user.id] ?? [], project_role: mapping.personRoles?.[user.id] ?? null, user_id: mapping.people[user.id] ?? null }];
  });
}

// ---- One issue → what import_tasks takes -----------------------------------------------------

export type ImportItem = {
  external_key: string;
  external_url: string | null;
  number: number;
  title: string;
  description: Block[] | null;
  status_id: string;
  type: OurType;
  priority: OurPriority;
  assignee_id: string | null;
  reporter_id: string | null;
  imported_assignee: string | null;
  imported_reporter: string | null;
  // The tracker's ids of the two people: their seats are tied to the task.
  assignee_ext: string | null;
  reporter_ext: string | null;
  private: boolean;
  labels: string[];
  start_date: string | null;
  due_date: string | null;
  estimate: number | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  custom: Record<string, unknown>;
};
export type ImportRelation = { external_key: string; parent_key: string | null; links: { kind: TrackerLink["kind"]; other_key: string }[] };

const dateOf = (value: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(str(value)) ? str(value).slice(0, 10) : null);

function customValue(kind: OurFieldKind, raw: unknown, field: ImportMapping["fields"][string], people: ImportMapping["people"]): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  const label = (v: unknown) => (v && typeof v === "object" ? str((v as { value?: unknown; name?: unknown }).value) || str((v as { name?: unknown }).name) : String(v));
  switch (kind) {
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    case "date":
      return dateOf(raw);
    case "select":
      return field.options?.[label(raw)] ?? null;
    case "multiselect": {
      const ids = (Array.isArray(raw) ? raw : [raw]).map((v) => field.options?.[label(v)]).filter(Boolean);
      return ids.length ? ids : null;
    }
    case "person":
      return people[str((raw as { accountId?: unknown }).accountId)] ?? null;
    case "url":
      return safeHref(raw);
    default:
      return typeof raw === "string" ? raw.slice(0, 2000) : typeof raw === "number" ? String(raw) : (plainOf((raw as Adf).content).slice(0, 2000) || null);
  }
}

// `problems` says what could not be carried over exactly (shown in the report).
export function toImportItem(issue: TrackerIssue, mapping: ImportMapping): { item: ImportItem; relation: ImportRelation; problems: string[] } | { error: string } {
  const number = numberOfKey(issue.key);
  if (!number) return { error: "bad_key" };
  const status = mapping.statuses[issue.status];
  if (!status) return { error: "no_status" };
  const problems: string[] = [];
  const person = (user: TrackerUser | null) => {
    const id = user ? (mapping.people[user.id] ?? null) : null;
    return { id, name: user && !id ? user.name.slice(0, 120) : null };
  };
  const assignee = person(issue.assignee);
  const reporter = person(issue.reporter);
  const title = issue.title.trim() || issue.key;
  if (title.length > 300) problems.push("title_cut");
  const labels = [...new Set(issue.labels.map((l) => l.trim().slice(0, 40)).filter(Boolean))];
  if (labels.length > 20) problems.push("labels_cut");
  const custom: Record<string, unknown> = {};
  for (const [trackerId, field] of Object.entries(mapping.fields)) {
    const value = customValue(field.kind, issue.raw[trackerId], field, mapping.people);
    if (value !== null) custom[field.id] = value;
    else if (issue.raw[trackerId] !== null && issue.raw[trackerId] !== undefined && issue.raw[trackerId] !== "") problems.push("field_skipped");
  }
  return {
    item: {
      external_key: issue.key,
      external_url: safeHref(issue.url)?.slice(0, 500) ?? null,
      number,
      title: title.slice(0, 300),
      description: documentToBlocks(issue.description),
      status_id: status,
      type: mapping.types[issue.type] ?? "task",
      priority: issue.priority ? (mapping.priorities[issue.priority] ?? suggestPriority(issue.priority)) : "medium",
      assignee_id: assignee.id,
      reporter_id: reporter.id,
      imported_assignee: assignee.name,
      imported_reporter: reporter.name,
      assignee_ext: issue.assignee?.id ?? null,
      reporter_ext: issue.reporter?.id ?? null,
      private: issue.restricted,
      labels: labels.slice(0, 20),
      start_date: mapping.startField ? dateOf(issue.raw[mapping.startField]) : null,
      due_date: dateOf(issue.due),
      estimate: issue.estimateSeconds && issue.estimateSeconds > 0 ? Math.round((issue.estimateSeconds / 3600) * 100) / 100 : null,
      created_at: issue.created,
      updated_at: issue.updated,
      done_at: issue.resolved,
      custom,
    },
    relation: {
      external_key: issue.key,
      parent_key: issue.parent,
      // Each link is written once, from the side that "does" it.
      links: issue.links.filter((l) => l.outgoing || l.kind === "relates").map((l) => ({ kind: l.kind, other_key: l.other })),
    },
    problems,
  };
}

// ---- The cloud tracker's answers → the shapes above ------------------------------------------

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw => (value && typeof value === "object" ? (value as Raw) : {});
const CATEGORY: Record<string, OurCategory> = { new: "todo", undefined: "todo", indeterminate: "doing", done: "done" };

export const parseUser = (value: unknown): TrackerUser | null => {
  const u = obj(value);
  const id = str(u.accountId) || str(u.key) || str(u.name);
  return id ? { id, name: str(u.displayName) || str(u.emailAddress) || id, email: str(u.emailAddress) || null } : null;
};

export const parseStatus = (value: unknown): TrackerStatus | null => {
  const s = obj(value);
  return str(s.id) ? { id: str(s.id), name: str(s.name) || str(s.id), category: CATEGORY[str(obj(s.statusCategory).key)] ?? "todo" } : null;
};

export const parseType = (value: unknown): TrackerType | null => {
  const t = obj(value);
  return str(t.id) ? { id: str(t.id), name: str(t.name) || str(t.id), subtask: t.subtask === true, epic: Number(t.hierarchyLevel) >= 1 } : null;
};

// Custom fields we can carry: text, number, date, one or several options, a person, a link.
export function parseField(value: unknown): TrackerField | null {
  const f = obj(value);
  const schema = obj(f.schema);
  if (f.custom !== true || !str(f.id)) return null;
  const type = str(schema.type);
  const custom = str(schema.custom);
  const kind: OurFieldKind | null =
    type === "number" ? "number"
    : type === "date" || type === "datetime" ? "date"
    : type === "option" ? "select"
    : type === "array" && str(schema.items) === "option" ? "multiselect"
    : type === "user" ? "person"
    : custom.endsWith(":url") ? "url"
    : type === "string" ? "text"
    : null;
  return kind ? { id: str(f.id), name: (str(f.name) || str(f.id)).slice(0, 60), kind } : null;
}

const LINK_KIND = (name: string): TrackerLink["kind"] => (/block/i.test(name) ? "blocks" : /duplicat|clone/i.test(name) ? "duplicates" : "relates");

export function parseIssue(value: unknown, site: string): TrackerIssue | null {
  const issue = obj(value);
  const fields = obj(issue.fields);
  const key = str(issue.key);
  if (!key) return null;
  const links: TrackerLink[] = [];
  for (const raw of Array.isArray(fields.issuelinks) ? fields.issuelinks : []) {
    const link = obj(raw);
    const kind = LINK_KIND(str(obj(link.type).name));
    // outwardIssue: this issue does it to the other ("blocks" → we block it).
    const outward = str(obj(link.outwardIssue).key);
    const inward = str(obj(link.inwardIssue).key);
    if (outward) links.push({ kind, other: outward, outgoing: true });
    else if (inward) links.push({ kind, other: inward, outgoing: false });
  }
  return {
    key,
    url: `${site}/browse/${key}`,
    title: str(fields.summary),
    description: fields.description ?? null,
    status: str(obj(fields.status).id),
    type: str(obj(fields.issuetype).id),
    priority: str(obj(fields.priority).name) || null,
    assignee: parseUser(fields.assignee),
    reporter: parseUser(fields.reporter) ?? parseUser(fields.creator),
    labels: (Array.isArray(fields.labels) ? fields.labels : []).filter((l): l is string => typeof l === "string"),
    due: str(fields.duedate) || null,
    estimateSeconds: typeof fields.timeoriginalestimate === "number" ? fields.timeoriginalestimate : null,
    created: str(fields.created) || new Date(0).toISOString(),
    updated: str(fields.updated) || str(fields.created) || new Date(0).toISOString(),
    resolved: str(fields.resolutiondate) || null,
    parent: str(obj(fields.parent).key) || null,
    links,
    restricted: fields.security !== null && fields.security !== undefined,
    raw: fields,
  };
}

// ---- The tracker's address ---------------------------------------------------------------------

// Any link copied from the cloud tracker (a board, a task, the site itself) gives the
// site and, when it is in the link, the project's key. Only the vendor's own cloud
// addresses are accepted, so the server never calls an address someone made up.
export function parseTrackerLink(input: string): { site: string; project: string | null } | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/^[a-z0-9][a-z0-9-]{0,61}\.atlassian\.net$/.test(url.hostname) || url.port) return null;
  const key = url.pathname.match(/\/projects\/([A-Z][A-Z0-9_]{1,19})(\/|$)/)?.[1] ?? url.pathname.match(/\/browse\/([A-Z][A-Z0-9_]{1,19})-\d+/)?.[1] ?? null;
  return { site: `https://${url.hostname}`, project: key };
}
