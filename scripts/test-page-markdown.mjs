// Wiki page → Markdown (export) and the browser .zip writer.
// Run: node --experimental-strip-types --no-warnings scripts/test-page-markdown.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRefs, pageToMarkdown } from "../src/lib/page-markdown.ts";
import { crc32, makeZip } from "../src/lib/zip.ts";

const labels = {
  untitled: "Untitled", noAccess: "No access", open: "open", image: "Image", sheet: "Table", chart: "Chart",
  board: "Board", mindmap: "Mind map", flow: "Flow", survey: "Survey", tasks: "Tasks", diagram: "Diagram",
  gallery: "Gallery", youtube: "Video", audio: "Audio", navigation: "Pages", empty: "Empty",
  moreRows: (s, t) => `Showing ${s} of ${t} rows`, moreTasks: (s, t) => `Showing ${s} of ${t} tasks`,
};
const SHEET = "11111111-1111-1111-1111-111111111111";
const HIDDEN = "22222222-2222-2222-2222-222222222222";
const TASK = "33333333-3333-3333-3333-333333333333";
const SECRET_TASK = "44444444-4444-4444-4444-444444444444";
const PROJECT = "55555555-5555-5555-5555-555555555555";
const text = (t, styles = {}) => ({ type: "text", text: t, styles });

const blocks = [
  { type: "heading", props: { level: 1 }, content: [text("Intro")] },
  { type: "paragraph", content: [text("Hello "), text("bold", { bold: true }), text(" and "), text("x*y", { code: true }), text(" 2*3")] },
  { type: "paragraph", content: [{ type: "link", href: "https://example.com/a b", content: [text("site")] }] },
  { type: "bulletListItem", content: [text("one")], children: [{ type: "bulletListItem", content: [text("nested")] }] },
  { type: "numberedListItem", content: [text("first")] },
  { type: "numberedListItem", content: [text("second")] },
  { type: "checkListItem", props: { checked: true }, content: [text("done")] },
  { type: "quote", content: [text("quoted")] },
  { type: "callout", props: { variant: "warning" }, content: [text("careful")] },
  { type: "codeBlock", props: { language: "js" }, content: [text("let a = 1;")] },
  { type: "table", content: { type: "tableContent", rows: [{ cells: [[text("A")], [text("B|C")]] }, { cells: [{ type: "tableCell", content: [text("1")] }, [text("2")]] }] } },
  { type: "image", props: { url: "ek-attachment:ws/p/1.png", caption: "Diagram" } },
  { type: "image", props: { url: "https://cdn.example.com/x.png", caption: "" } },
  { type: "image", props: { url: "javascript:alert(1)", caption: "bad" } },
  { type: "sheetEmbed", props: { sheetId: SHEET, chartId: "" } },
  { type: "sheetEmbed", props: { sheetId: HIDDEN, chartId: "" } },
  { type: "boardEmbed", props: { boardId: HIDDEN } },
  { type: "nodeMap", props: { objectId: "66666666-6666-6666-6666-666666666666" } },
  { type: "surveyEmbed", props: { surveyId: HIDDEN, view: "form" } },
  { type: "tasks", props: { projectId: PROJECT, view: "list", mine: false } },
  { type: "paragraph", content: [{ type: "taskChip", props: { taskId: TASK } }, text(" vs "), { type: "taskChip", props: { taskId: SECRET_TASK } }] },
  { type: "paragraph", content: [{ type: "pageChip", props: { pageId: "p-visible" } }, text(" "), { type: "pageChip", props: { pageId: "p-hidden" } }, text(" "), { type: "personChip", props: { userId: "u1", label: "Olena" } }] },
  { type: "paragraph", content: [{ type: "chip", props: { name: "Status", options: JSON.stringify([{ id: "a", label: "Ready", color: "green" }]), value: "a" } }] },
  { type: "gallery", props: { items: JSON.stringify([{ id: "g1", kind: "image", url: "ek-attachment:ws/p/2.jpg", caption: "Team" }, { id: "g2", kind: "youtube", url: "https://youtu.be/x", caption: "" }]) } },
  { type: "diagram", props: { data: JSON.stringify({ nodes: [{ id: "a", title: "Start" }, { id: "b", title: "End" }, { id: "c", title: "Alone" }], edges: [{ id: "e", source: "a", target: "b", label: "go" }] }) } },
  { type: "navigation", props: { scope: "children" } },
  { type: "paragraph", content: [] },
];

const data = {
  base: "https://site.test/w/abc12",
  pageId: "p-self",
  pages: [
    { id: "p-self", title: "Self", icon: null, parentId: null },
    { id: "p-visible", title: "Visible page", icon: "📘", parentId: "p-self" },
  ],
  sheets: {
    [SHEET]: { id: SHEET, title: "Budget", charts: [], tabs: [{ name: "Sheet1", rows: [["Item", "Sum"], ["Rent", "100"]], totalRows: 900 }] },
    [HIDDEN]: null,
  },
  boards: { [HIDDEN]: null },
  nodes: {},
  surveys: { [HIDDEN]: null },
  taskLists: { [`${PROJECT}:0`]: { key: "OPS", name: "Ops", total: 3, tasks: [{ key: "OPS-1", title: "Fix", status: "Done", done: true, assignee: "Ivan" }, { key: "OPS-2", title: "Plan", status: "To do", done: false, assignee: null }] } },
  taskChips: { [TASK]: { key: "OPS-1", title: "Fix", status: "Done" } },
  image: (url) => ({ "ek-attachment:ws/p/1.png": "files/01.png", "ek-attachment:ws/p/2.jpg": "files/02.jpg" })[url] ?? (url.startsWith("https://") ? url : null),
};

const md = pageToMarkdown("Guide [v2]", "📗", blocks, data, labels);
const has = (piece) => assert.ok(md.includes(piece), `missing: ${piece}\n---\n${md}`);
const lacks = (piece) => assert.ok(!md.includes(piece), `must not contain: ${piece}\n---\n${md}`);

has("# 📗 Guide \\[v2\\]\n");
has("## Intro");
has("Hello **bold** and `x*y` 2\\*3");
has("[site](https://example.com/a%20b)");
has("- one\n  - nested");
has("1. first\n2. second");
has("- [x] done");
has("> quoted");
has("> ⚠️ careful");
has("```js\nlet a = 1;\n```");
has("| A | B\\|C |\n| --- | --- |\n| 1 | 2 |");
has("![Diagram](files/01.png)");
has("![](https://cdn.example.com/x.png)");
lacks("javascript:");
has("*bad*");
// Embeds the reader can see: data; ones they can't: no name, no content.
has("📊 **Table: Budget** — [open](https://site.test/w/abc12/sheets/" + SHEET + ")");
has("| Item | Sum |\n| --- | --- |\n| Rent | 100 |");
has("*Showing 2 of 900 rows*");
assert.equal(md.split("🔒 No access").length - 1, 6, `six hidden things expected\n${md}`);
lacks(HIDDEN);
has("- [x] [OPS-1 Fix](https://site.test/w/abc12/tasks/OPS/1) — Done, Ivan");
has("- [ ] [OPS-2 Plan](https://site.test/w/abc12/tasks/OPS/2) — To do");
has("*Showing 2 of 3 tasks*");
has("[OPS-1 Fix](https://site.test/w/abc12/tasks/OPS/1) — Done vs 🔒 No access");
lacks(SECRET_TASK);
has("[📘 Visible page](https://site.test/w/abc12/p/p-visible) 🔒 No access @Olena");
has("\\[Ready\\]");
has("![Team](files/02.jpg)");
has("- ▶️ [Video](https://youtu.be/x)");
has("- Start → (go) End\n- Alone");
has("🧭 **Pages**\n\n- [📘 Visible page](https://site.test/w/abc12/p/p-visible)");
assert.ok(!/\n{3,}/.test(md), "no runs of blank lines");
assert.ok(md.endsWith("\n") && !md.endsWith("\n\n"));

// What the export reads first.
const refs = collectRefs(blocks);
assert.deepEqual([...refs.sheets].sort(), [SHEET, HIDDEN].sort());
assert.deepEqual([...refs.taskChips].sort(), [TASK, SECRET_TASK].sort());
assert.deepEqual([...refs.taskLists], [`${PROJECT}:0`]);
assert.ok(refs.files.has("ek-attachment:ws/p/1.png") && refs.files.has("ek-attachment:ws/p/2.jpg"));

// Empty or broken content still makes a file.
assert.equal(pageToMarkdown("", null, null, data, labels), "# Untitled\n");

// CRC-32 check value and a real archive that a standard tool opens.
assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
const zip = makeZip([
  { name: "Сторінка.md", data: new TextEncoder().encode(md) },
  { name: "files/01.png", data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) },
]);
const dir = mkdtempSync(join(tmpdir(), "ek-zip-"));
try {
  const file = join(dir, "a.zip");
  writeFileSync(file, zip);
  const listed = execFileSync("python3", ["-I", "-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print('\\n'.join(z.namelist()));print(z.read(z.namelist()[0]).decode())", file]).toString();
  assert.ok(listed.startsWith("Сторінка.md\nfiles/01.png\n"), listed);
  assert.ok(listed.includes("## Intro"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("page-markdown: ok");
