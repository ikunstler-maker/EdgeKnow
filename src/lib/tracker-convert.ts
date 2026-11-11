// Moving tasks in from another tracker (Rukh, step Р-3а): the pure part — what the
// tracker says turned into what our tasks hold. No network and no database here, so
// it is tested by itself (scripts/test-tracker-import.mjs).

export type OurType = "task" | "bug" | "idea" | "epic";
export type OurPriority = "lowest" | "low" | "medium" | "high" | "highest";
export type OurCategory = "todo" | "doing" | "review" | "done";
export type OurFieldKind = "text" | "number" | "date" | "select" | "multiselect" | "person" | "url";

export type TrackerUser = { id: string; name: string; email: string | null };
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
