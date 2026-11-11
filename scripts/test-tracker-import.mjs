// Rukh Р-3а: what another tracker says turned into our tasks — formatted text, people,
// statuses, numbers, links — without a network or a database.
// Run: node --experimental-strip-types --no-warnings scripts/test-tracker-import.mjs
import assert from "node:assert/strict";
import { documentToBlocks, documentToText, parseComments, parseMoves, toActivityItem, matchPeople, personRoles, suggestRole, toPersonItems, numberOfKey, parseField, parseIssue, parseTrackerLink, parseStatus, parseType, suggestPriority, suggestStatus, suggestType, toImportItem } from "../src/lib/tracker-convert.ts";

const text = (t, marks) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const doc = {
  type: "doc",
  version: 1,
  content: [
    { type: "heading", attrs: { level: 2 }, content: [text("Steps")] },
    { type: "paragraph", content: [text("Open "), text("the page", [{ type: "strong" }, { type: "link", attrs: { href: "https://example.com/p" } }]), text(" and "), text("wait", [{ type: "em" }]), { type: "hardBreak" }, { type: "mention", attrs: { id: "u1", text: "@Olena" } }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("One")] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("Inner")] }] }] }] }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { state: "DONE" }, content: [text("Checked")] }, { type: "taskItem", attrs: { state: "TODO" }, content: [text("Open")] }] },
    { type: "codeBlock", attrs: { language: "js" }, content: [text("const a = 1;")] },
    { type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [text("Name")] }] }, { type: "tableHeader", content: [{ type: "paragraph", content: [text("Role")] }] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [text("Ann")] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [text("Owner")] }] }] },
    ] },
    { type: "panel", attrs: { panelType: "info" }, content: [{ type: "paragraph", content: [text("Mind this")] }] },
    { type: "rule" },
    { type: "paragraph", content: [text("bad link", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])] },
    { type: "somethingNew", content: [{ type: "paragraph", content: [text("Still kept")] }] },
  ],
};
const blocks = documentToBlocks(doc);
assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "bulletListItem", "checkListItem", "checkListItem", "codeBlock", "table", "quote", "divider", "paragraph", "paragraph"]);
assert.equal(blocks[0].props.level, 2);
assert.deepEqual(blocks[1].content, [
  { type: "text", text: "Open ", styles: {} },
  { type: "link", href: "https://example.com/p", content: [{ type: "text", text: "the page", styles: { bold: true } }] },
  { type: "text", text: " and ", styles: {} },
  { type: "text", text: "wait", styles: { italic: true } },
  { type: "text", text: "\n@Olena", styles: {} },
]);
assert.equal(blocks[2].children[0].content[0].text, "Inner", "a nested list hangs under its item");
assert.deepEqual([blocks[3].props.checked, blocks[4].props.checked], [true, false]);
assert.equal(blocks[5].content[0].text, "const a = 1;");
assert.equal(blocks[6].content.headerRows, 1);
assert.equal(blocks[6].content.rows[1].cells[1][0].text, "Owner");
assert.equal(blocks[9].content[0].type, "text", "a script link is plain text, never a link");
assert.equal(blocks[10].content[0].text, "Still kept", "an unknown block keeps its text");
assert.equal(documentToBlocks(null), null);
assert.equal(documentToBlocks("Line one\n\nLine two").length, 3, "plain text keeps its paragraphs");

assert.equal(numberOfKey("TMD-450"), 450);
assert.equal(numberOfKey("TMD"), null);
assert.equal(suggestType({ id: "1", name: "Bug", subtask: false, epic: false }), "bug");
assert.equal(suggestType({ id: "2", name: "Epic", subtask: false, epic: true }), "epic");
assert.equal(suggestType({ id: "3", name: "Subtask", subtask: true, epic: false }), "task");
assert.deepEqual(["Highest", "High", "Medium", "Low", "Lowest", "Blocker", "Odd"].map(suggestPriority), ["highest", "high", "medium", "low", "lowest", "highest", "medium"]);
const columns = [{ id: "c1", name: "To Do", category: "todo" }, { id: "c2", name: "In Progress", category: "doing" }, { id: "c3", name: "Done", category: "done" }];
assert.equal(suggestStatus({ id: "s", name: "in  progress", category: "doing" }, columns), "c2", "same name wins");
assert.equal(suggestStatus({ id: "s", name: "Ext Review", category: "doing" }, columns), "c2", "else the same kind");
assert.equal(suggestStatus({ id: "s", name: "X", category: "review" }, columns), null);

const members = [{ id: "m1", name: "Olena Koval", email: "olena@team.test" }, { id: "m2", name: "Ivan Bondar", email: "ivan@team.test" }, { id: "m3", name: "Ivan Bondar", email: "ivan2@team.test" }];
assert.deepEqual(
  matchPeople([{ id: "a", name: "Somebody", email: "OLENA@team.test" }, { id: "b", name: "olena  koval", email: null }, { id: "c", name: "Ivan Bondar", email: null }, { id: "d", name: "Gone Person", email: null }], members),
  { a: "m1", b: "m1", c: null, d: null },
  "by email, else by a name only one member has",
);

assert.deepEqual(parseStatus({ id: "10001", name: "In Review", statusCategory: { key: "indeterminate" } }), { id: "10001", name: "In Review", category: "doing" });
assert.deepEqual(parseType({ id: "5", name: "Sub-task", subtask: true, hierarchyLevel: -1 }), { id: "5", name: "Sub-task", subtask: true, epic: false });
assert.equal(parseField({ id: "customfield_1", name: "Budget", custom: true, schema: { type: "number" } }).kind, "number");
assert.equal(parseField({ id: "customfield_2", name: "Channel", custom: true, schema: { type: "array", items: "option" } }).kind, "multiselect");
assert.equal(parseField({ id: "summary", name: "Summary", custom: false, schema: { type: "string" } }), null, "built-in fields are not custom");
assert.equal(parseField({ id: "customfield_3", name: "Sprint", custom: true, schema: { type: "array", items: "json" } }), null, "what we can't carry is left out");

const raw = {
  key: "TMD-7",
  fields: {
    summary: "  Prepare the landing  ",
    description: doc,
    status: { id: "10001", name: "In Review", statusCategory: { key: "indeterminate" } },
    issuetype: { id: "5", name: "Sub-task", subtask: true },
    priority: { name: "High" },
    assignee: { accountId: "a", displayName: "Olena K", emailAddress: "olena@team.test" },
    reporter: { accountId: "d", displayName: "Gone Person" },
    labels: ["marketing", "marketing", " q4 "],
    duedate: "2026-11-20",
    timeoriginalestimate: 5400,
    created: "2025-03-01T10:00:00.000+0200",
    updated: "2025-03-05T10:00:00.000+0200",
    resolutiondate: null,
    parent: { key: "TMD-3" },
    issuelinks: [
      { type: { name: "Blocks" }, outwardIssue: { key: "TMD-9" } },
      { type: { name: "Blocks" }, inwardIssue: { key: "TMD-2" } },
      { type: { name: "Relates" }, inwardIssue: { key: "TMD-4" } },
      { type: { name: "Cloners" }, outwardIssue: { key: "TMD-5" } },
    ],
    customfield_1: 1200,
    customfield_2: [{ value: "Video" }, { value: "Unknown" }],
    customfield_9: "2026-11-02",
  },
};
const issue = parseIssue(raw, "https://team.example.net");
assert.equal(issue.url, "https://team.example.net/browse/TMD-7");
assert.deepEqual(issue.links.map((l) => `${l.kind}:${l.other}:${l.outgoing}`), ["blocks:TMD-9:true", "blocks:TMD-2:false", "relates:TMD-4:false", "duplicates:TMD-5:true"]);
const mapping = {
  statuses: { 10001: "col-review" },
  types: { 5: "task" },
  priorities: {},
  people: { a: "m1", d: null },
  fields: { customfield_1: { id: "f-budget", kind: "number" }, customfield_2: { id: "f-channel", kind: "multiselect", options: { Video: "opt-video" } } },
  startField: "customfield_9",
};
const made = toImportItem(issue, mapping);
assert.ok(!("error" in made));
assert.deepEqual(
  { ...made.item, description: made.item.description.length },
  {
    external_key: "TMD-7", external_url: "https://team.example.net/browse/TMD-7", number: 7, title: "Prepare the landing", description: 11,
    status_id: "col-review", type: "task", priority: "high", assignee_id: "m1", reporter_id: null, imported_assignee: null, imported_reporter: "Gone Person", assignee_ext: "a", reporter_ext: "d", private: false,
    labels: ["marketing", "q4"], start_date: "2026-11-02", due_date: "2026-11-20", estimate: 1.5,
    created_at: "2025-03-01T10:00:00.000+0200", updated_at: "2025-03-05T10:00:00.000+0200", done_at: null,
    custom: { "f-budget": 1200, "f-channel": ["opt-video"] },
  },
);
assert.deepEqual(made.relation, { external_key: "TMD-7", parent_key: "TMD-3", links: [{ kind: "blocks", other_key: "TMD-9" }, { kind: "relates", other_key: "TMD-4" }, { kind: "duplicates", other_key: "TMD-5" }] }, "an incoming “blocks” is written by the task that blocks");
assert.deepEqual(toImportItem({ ...issue, status: "404" }, mapping), { error: "no_status" });
assert.deepEqual(toImportItem({ ...issue, key: "TMD" }, mapping), { error: "bad_key" });
const long = toImportItem({ ...issue, title: "x".repeat(400), labels: Array.from({ length: 25 }, (_, i) => `l${i}`) }, mapping);
assert.deepEqual([long.item.title.length, long.item.labels.length, long.problems.sort()], [300, 20, ["labels_cut", "title_cut"]]);

assert.deepEqual(parseTrackerLink("https://team.atlassian.net/jira/core/projects/TMD/board"), { site: "https://team.atlassian.net", project: "TMD" });
assert.deepEqual(parseTrackerLink("team.atlassian.net/browse/MKT-12"), { site: "https://team.atlassian.net", project: "MKT" });
assert.deepEqual(parseTrackerLink("https://team.atlassian.net"), { site: "https://team.atlassian.net", project: null });
for (const bad of ["http://team.atlassian.net", "https://atlassian.net.evil.example/projects/TMD", "https://localhost/projects/TMD", "https://team.atlassian.net:8443/", "https://10.0.0.1/", "not a link"]) {
  assert.equal(parseTrackerLink(bad), null, `refused: ${bad}`);
}

console.log("tracker import: ok");

// People as seats, the tracker's roles as ours, restricted tasks as private.
{
  const roles = [{ name: "Administrators", users: ["u1"] }, { name: "Developers", users: ["u1", "u2"] }, { name: "Watchers", users: ["u3"] }];
  const held = personRoles(roles, { Administrators: "owner", Developers: "editor", Watchers: null });
  assert.deepEqual(held.ours, { u1: "owner", u2: "editor", u3: null }, "the highest mapped role wins; an unmapped role gives none");
  assert.deepEqual(held.theirs.u1, ["Administrators", "Developers"]);
  assert.deepEqual([suggestRole("Administrators"), suggestRole("Developers"), suggestRole("Viewers"), suggestRole("Service Desk Customers")], ["owner", "editor", "viewer", "commenter"]);
  const mapping = { statuses: {}, types: {}, priorities: {}, people: { u1: "member-1" }, fields: {}, startField: null, personRoles: held.ours, trackerRoles: held.theirs };
  const items = toPersonItems([{ id: "u1", name: "Ann", email: "ann@x.test" }, { id: "u2", name: " Bo ", email: null }, { id: "u2", name: "Bo again", email: null }, { id: "", name: "Nobody", email: null }], mapping);
  assert.deepEqual(items, [
    { external_id: "u1", name: "Ann", email: "ann@x.test", roles: ["Administrators", "Developers"], project_role: "owner", user_id: "member-1" },
    { external_id: "u2", name: "Bo", email: null, roles: ["Developers"], project_role: "editor", user_id: null },
  ]);
  const base = { summary: "T", status: { id: "1" }, issuetype: { id: "2" }, assignee: { accountId: "u2", displayName: "Bo" }, reporter: { accountId: "u1", displayName: "Ann" } };
  const open = parseIssue({ key: "K-1", fields: base }, "https://x.atlassian.net");
  const closed = parseIssue({ key: "K-2", fields: { ...base, security: { name: "Staff" } } }, "https://x.atlassian.net");
  assert.deepEqual([open.restricted, closed.restricted], [false, true]);
  const made = toImportItem(closed, { ...mapping, statuses: { 1: "col" } });
  assert.ok(!("error" in made));
  assert.deepEqual([made.item.assignee_ext, made.item.reporter_ext, made.item.private, made.item.reporter_id, made.item.imported_assignee], ["u2", "u1", true, "member-1", "Bo"]);
}
console.log("people, roles and restricted tasks: ok");

// Comments and the way through the statuses.
{
  const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
  const body = { type: "doc", version: 1, content: [para("First line"), { type: "bulletList", content: [{ type: "listItem", content: [para("One")] }] }, { type: "paragraph", content: [{ type: "text", text: "site", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] }] };
  assert.equal(documentToText(body), "First line\n• One\nsite (https://example.com)");
  const comments = parseComments([{ id: "10", author: { accountId: "u2", displayName: "Bo" }, body, created: "2024-05-01T09:00:00.000+0000", updated: "2024-05-01T09:00:00.000+0000" }, { id: "11", body: { type: "doc", content: [] }, created: "2024-05-02T09:00:00.000+0000", updated: "2024-05-03T09:00:00.000+0000" }, { body }]);
  assert.deepEqual(comments.map((c) => [c.id, c.author?.id ?? null, c.updated]), [["10", "u2", null], ["11", null, "2024-05-03T09:00:00.000+0000"]]);
  const moves = parseMoves([
    { id: "h2", created: "2024-05-04T00:00:00.000+0000", author: { accountId: "u1", displayName: "Ann" }, items: [{ field: "status", from: "2", to: "3" }] },
    { id: "h1", created: "2024-05-02T00:00:00.000+0000", items: [{ field: "assignee", from: "a", to: "b" }, { field: "status", from: "1", to: "2" }] },
    { id: "h3", created: "2024-05-05T00:00:00.000+0000", items: [{ field: "status", from: "3", to: "9" }] },
  ]);
  assert.equal(moves.length, 3);
  const made = toActivityItem({ key: "K-1", comments, moves }, { statuses: { 1: "todo", 2: "doing", 3: "done" }, types: {}, priorities: {}, people: {}, fields: {}, startField: null });
  assert.deepEqual(made.item.comments.map((c) => [c.external_id, c.author_ext, c.edited_at]), [["10", "u2", null]], "an empty comment is left out");
  assert.deepEqual(made.item.moves.map((m) => [m.external_id, m.from_status, m.to_status]), [["h1", "todo", "doing"], ["h2", "doing", "done"]], "moves in the order of time; a status we have no column for is left out");
}
console.log("comments and status history: ok");
