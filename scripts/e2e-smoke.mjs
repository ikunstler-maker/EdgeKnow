// Browser smoke test of the workspace screens against a local Supabase, run after
// scripts/api-isolation.mjs (reuses its users: alice owns "Alpha", bob owns "Beta").
//
// Usage: node scripts/e2e-smoke.mjs status.json http://localhost:3000

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";

const status = JSON.parse(readFileSync(process.argv[2] ?? "status.json", "utf8"));
const APP = process.argv[3] ?? "http://localhost:3000";
const API = status.API_URL;
const ANON = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const sql = (query) => execFileSync("psql", [status.DB_URL, "-Atc", query], { encoding: "utf8" }).trim();

const results = [];
// A crash (timeout, missing element) is reported as an annotation with the last passed step.
const consoleErrors = [];
let lastPage = null;
const crash = async (error) => {
  const message = String(error?.message ?? error).split("\n").slice(0, 3).join(" ").slice(0, 600);
  console.log(`::error title=E2E crashed::${message} — after: ${results.at(-1)?.name ?? "start"}`);
  const alerts = await lastPage?.locator("[role=alert]").allInnerTexts().catch(() => []);
  if (alerts?.length) console.log(`::error title=On-screen alerts::${alerts.join(" | ").slice(0, 600)}`);
  if (consoleErrors.length) console.log(`::error title=Browser console::${consoleErrors.slice(-4).join(" | ").slice(0, 900)}`);
  process.exit(1);
};
process.on("unhandledRejection", crash);
process.on("uncaughtException", crash);
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// Signs in with a password and returns the auth cookies exactly as @supabase/ssr writes them.
async function sessionCookies(email) {
  const jar = new Map();
  const client = createServerClient(API, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: "Test-password-1!" });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { cookies: [...jar].map(([name, value]) => ({ name, value, url: APP })), client };
}

const browser = await chromium.launch();
const problems = [];

async function newPage(cookies = []) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  if (cookies.length) await context.addCookies(cookies);
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  lastPage = page;
  page.on("dialog", (d) => d.accept().catch(() => {}));
  page.on("response", (r) => {
    // 503 from the feedback route is expected in CI: no Google Sheet is connected there.
    if (r.status() >= 500 && !(r.status() === 503 && r.url().endsWith("/api/feedback"))) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return page;
}

const alphaShort = sql("select short_id from public.workspaces where name = 'Alpha'");
const alphaPage = sql("select id from public.pages where title = 'Alpha secret'");

const { cookies: aliceCookies, client: aliceClient } = await sessionCookies("alice@alpha.test");
const alice = await newPage(aliceCookies);

// "/" opens the user's workspace.
await alice.goto(APP);
await alice.waitForURL(new RegExp(`/w/${alphaShort}$`));
check("root opens the workspace", alice.url().endsWith(`/w/${alphaShort}`), alice.url());
check("workspace home greets the user", await alice.getByText("Вітаємо").count() > 0);
check("switcher shows the workspace name", await alice.getByRole("button", { name: "Перемкнути workspace" }).innerText().then((t) => t.includes("Alpha")));

// Existing page with author and dates.
await alice.goto(`${APP}/w/${alphaShort}/p/${alphaPage}`);
await alice.waitForSelector("textarea");
check("page title loads", (await alice.locator("textarea").inputValue()) === "Alpha secret");
check("page shows author and dates", (await alice.getByText("Автор: alice@alpha.test").count()) > 0 && (await alice.getByText("Створено").count()) > 0);

// New page from the sidebar, renamed, survives a reload.
await alice.getByRole("button", { name: "Нова сторінка" }).first().click();
await alice.waitForURL(new RegExp(`/w/${alphaShort}/p/[0-9a-f-]{36}$`));
// Wait for the new, empty page to be on screen before typing (as a person would).
await alice.waitForFunction(() => document.querySelector("textarea")?.value === "");
await alice.locator("textarea").fill("Created in browser");
await alice.locator("textarea").blur();
await alice.waitForTimeout(1500);
await alice.reload();
await alice.waitForSelector("textarea");
check("new page saved in this workspace", (await alice.locator("textarea").inputValue()) === "Created in browser");
check("sidebar lists the new page", (await alice.locator("aside").getByText("Created in browser").count()) > 0);
const newPageWs = sql("select w.name from public.pages p join public.workspaces w on w.id = p.workspace_id where p.title = 'Created in browser'");
check("new page stored with workspace_id", newPageWs === "Alpha", newPageWs);
const original = sql(`select title from public.pages where id = '${alphaPage}'`);
check("the other page kept its title", original === "Alpha secret", original);

// Settings tabs.
for (const [tab, text] of [
  ["general", "Передати власність"],
  ["members", "Запросити"],
  ["domains", "alpha.test"],
  ["log", "Журнал змін"],
]) {
  await alice.goto(`${APP}/w/${alphaShort}/settings?tab=${tab}`);
  check(`settings tab ${tab}`, (await alice.getByText(text).count()) > 0);
}
await alice.goto(`${APP}/w/${alphaShort}/settings?tab=members`);
await alice.getByLabel("Пошта").fill("Teammate@Else.test");
await alice.getByRole("button", { name: "Запросити", exact: true }).click();
await alice.waitForSelector("input[readonly]");
const inviteLink = await alice.locator("input[readonly]").inputValue();
check("invitation link shown once", /\/invite\/[0-9a-f]{64}$/.test(inviteLink), inviteLink);

// Trash and legacy link.
await alice.goto(`${APP}/w/${alphaShort}/trash`);
check("trash opens", (await alice.getByText("Кошик").count()) > 0);
await alice.goto(`${APP}/p/${alphaPage}`);
await alice.waitForLoadState("networkidle");
check("old /p/<id> link redirects into the workspace", alice.url().endsWith(`/w/${alphaShort}/p/${alphaPage}`), alice.url());

// Platform admin page: refused, then statistics once alice is platform admin.
await alice.goto(`${APP}/admin`);
check("admin page refused for non platform admin", (await alice.getByText("лише супер-адміністратору").count()) > 0);
sql("update public.profiles set is_platform_admin = true where email = 'alice@alpha.test'");
await alice.reload();
check("admin page lists all workspaces", (await alice.getByRole("cell", { name: /Alpha/ }).count()) > 0 && (await alice.getByRole("cell", { name: /Beta/ }).count()) > 0);
check("admin page shows no page titles", (await alice.getByText("Alpha secret").count()) === 0);

// New workspace from the switcher.
await alice.goto(`${APP}/new`);
await alice.getByLabel("Назва").fill("Gamma");
await alice.getByRole("button", { name: "Створити" }).click();
await alice.waitForURL(/\/w\/[a-z0-9]{8}$/);
check("new workspace opens", (await alice.getByRole("button", { name: "Перемкнути workspace" }).innerText()).includes("Gamma"));
check("new workspace has an empty tree", (await alice.locator("aside").getByText("Alpha secret").count()) === 0);

// Bob can't open Alpha in the browser either.
const { cookies: bobCookies } = await sessionCookies("bob@beta.test");
const bob = await newPage(bobCookies);
await bob.goto(`${APP}/w/${alphaShort}/p/${alphaPage}`);
check("bob gets 'no access' for alpha's page", (await bob.getByText("Немає доступу до workspace").count()) > 0);
check("bob's screen doesn't leak the title", (await bob.getByText("Alpha secret").count()) === 0);
await bob.goto(`${APP}/p/${alphaPage}`);
await bob.waitForLoadState("networkidle");
check("legacy link doesn't reveal alpha to bob", !bob.url().includes(alphaShort), bob.url());

// Invitation page for someone not signed in.
const anon = await newPage();
await anon.goto(inviteLink);
check("invitation page shows the workspace", (await anon.getByText("Запрошення до «Alpha»").count()) > 0);
await anon.goto(`${APP}/w/${alphaShort}`);
await anon.waitForURL(/\/login\?/);
check("signed-out visitor goes to the workspace login link", anon.url().includes(`w=${alphaShort}`), anon.url());

// --- Stage 3: the editor ------------------------------------------------------

const fixture = JSON.parse(readFileSync(new URL("./fixtures/all-blocks.json", import.meta.url), "utf8"));
const pageContent = (id) => JSON.parse(sql(`select coalesce(content, 'null'::jsonb)::text from public.pages where id = '${id}'`));
const pageVersion = (id) => Number(sql(`select version from public.pages where id = '${id}'`));

// Types and erases a character at the end so the unchanged document gets saved.
async function nudge(page) {
  await page.getByText("Last paragraph").click();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await page.waitForFunction(() => document.body.innerText.includes("Збережено"), null, { timeout: 15000 });
  await page.waitForTimeout(300);
}

const docPage = (await aliceClient.rpc("create_page", { ws: sql("select id from public.workspaces where name = 'Alpha'"), parent: null, new_title: "All blocks" })).data.id;
const seeded = await aliceClient.rpc("save_page_content", { target_page: docPage, new_content: fixture, base_version: 1 });
check("fixture saved through the API", seeded.data?.ok === true, JSON.stringify(seeded.data));

await alice.goto(`${APP}/w/${alphaShort}/p/${docPage}`);
await alice.waitForSelector(".bn-editor");
await nudge(alice);
const roundTrip1 = pageContent(docPage);
const types = new Set();
const walk = (list) => list.forEach((b) => { types.add(b.type); if (b.children) walk(b.children); });
walk(roundTrip1);
const expected = ["heading", "paragraph", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "codeBlock", "divider", "table", "callout", "youtube"];
check("editor: every block type survives a save", expected.every((type) => types.has(type)), [...types].join(","));
const saved = JSON.stringify(roundTrip1);
const needles = ['"bold":true', '"italic":true', '"underline":true', '"strike":true', '"code":true', '"textColor":"red"', '"backgroundColor":"yellow"', "https://example.com/", '"textAlignment":"center"', '"checked":true', '"isToggleable":true', '"language":"javascript"', '"headerRows":1', '"variant":"warning"', "dQw4w9WgXcQ", "Nested bullet", "Hidden detail", "Inside the toggle heading"];
const missing = needles.filter((n) => !saved.includes(n));
check("editor: every style and nested block survives a save", missing.length === 0, missing.join(" "));

await alice.reload();
await alice.waitForSelector(".bn-editor");
await nudge(alice);
check("editor: reopening and saving again changes nothing", JSON.stringify(pageContent(docPage)) === saved);
check("editor: each save bumps the version", pageVersion(docPage) === 4, String(pageVersion(docPage)));
check("editor: table of contents lists the headings", (await alice.locator('nav[aria-label="Зміст"] button').count()) === 3);

// Typing through the "/" menu, as a person would.
await alice.getByText("Last paragraph").click();
await alice.keyboard.press("End");
await alice.keyboard.press("Enter");
await alice.keyboard.type("/плашка");
await alice.getByRole("option", { name: /Плашка/ }).first().waitFor();
await alice.keyboard.press("Enter");
await alice.keyboard.type("Typed in the browser");
await alice.waitForFunction(() => document.body.innerText.includes("Збережено"), null, { timeout: 15000 });
await alice.waitForTimeout(1500);
check("editor: block inserted with / is saved", JSON.stringify(pageContent(docPage)).includes("Typed in the browser"));

// Two tabs on one page: the second save is a conflict, nothing is overwritten silently.
const tab1 = await newPage(aliceCookies);
const tab2 = await newPage(aliceCookies);
for (const tab of [tab1, tab2]) {
  await tab.goto(`${APP}/w/${alphaShort}/p/${docPage}`);
  await tab.waitForSelector(".bn-editor");
}
await tab1.getByText("Last paragraph").click();
await tab1.keyboard.press("End");
await tab1.keyboard.type(" from tab one");
await tab1.waitForFunction(() => document.body.innerText.includes("Збережено"), null, { timeout: 15000 });
await tab1.waitForTimeout(1200);
await tab2.getByText("Last paragraph").click();
await tab2.keyboard.press("End");
await tab2.keyboard.type(" from tab two");
await tab2.getByText(/Сторінку щойно змінив/).waitFor({ timeout: 15000 });
check("editor: second tab gets the conflict banner", true);
check("editor: first tab's text is kept", JSON.stringify(pageContent(docPage)).includes("from tab one") && !JSON.stringify(pageContent(docPage)).includes("from tab two"));
await tab2.getByRole("button", { name: "Залишити мою" }).click();
await tab2.waitForFunction(() => document.body.innerText.includes("Збережено"), null, { timeout: 15000 });
await tab2.waitForTimeout(500);
check("editor: 'keep mine' overwrites on purpose", JSON.stringify(pageContent(docPage)).includes("from tab two"));

// Bob can't save into Alice's page even straight through the route.
const bobSave = await bob.evaluate(async (id) => {
  const r = await fetch(`/api/pages/${id}/content`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: [], baseVersion: 1, force: true }) });
  return r.json();
}, docPage);
check("editor: another workspace can't save the page", bobSave?.error === "forbidden", JSON.stringify(bobSave));

// Content written straight through the API (bypassing the editor) still can't run code.
const evilPage = (await aliceClient.rpc("create_page", { ws: sql("select id from public.workspaces where name = 'Alpha'"), parent: null, new_title: "Evil" })).data.id;
await aliceClient.rpc("save_page_content", {
  target_page: evilPage,
  base_version: 1,
  new_content: [
    { type: "paragraph", content: [{ type: "link", href: "javascript:alert(1)", content: [{ type: "text", text: "click me", styles: {} }] }] },
    { type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>", styles: {} }] },
    { type: "youtube", props: { url: "https://evil.example/embed/x", title: "Fake", author: "" } },
    { type: "youtube", props: { url: "javascript:alert(1)", title: "Fake2", author: "" } },
  ],
});
let alerted = false;
alice.on("dialog", () => (alerted = true));
await alice.goto(`${APP}/w/${alphaShort}/p/${evilPage}`);
await alice.waitForSelector(".bn-editor");
await alice.getByText("click me").click().catch(() => {});
await alice.waitForTimeout(500);
check("no javascript: links reach the page", (await alice.locator('a[href^="javascript"]').count()) === 0);
check("HTML in text stays text", (await alice.locator(".bn-editor img").count()) === 0 && (await alice.getByText("<img src=x onerror=alert(1)>").count()) === 1);
check("non-YouTube embeds are not rendered", (await alice.locator("iframe").count()) === 0 && (await alice.getByText("Fake").count()) === 0);
check("nothing executed", !alerted);

// --- Stage 4: images ------------------------------------------------------------

// A 4K PNG over 10 MB, drawn in the browser (gradient + noise, like a photo).
const png = await alice.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 3840;
  canvas.height = 2160;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const x = (i / 4) % canvas.width;
    const y = Math.floor(i / 4 / canvas.width);
    image.data[i] = (x / 15 + Math.random() * 40) | 0;
    image.data[i + 1] = (y / 9 + Math.random() * 40) | 0;
    image.data[i + 2] = (((x + y) / 24) + Math.random() * 40) | 0;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
});
const pngBuffer = Buffer.from(png, "base64");
check("test image is a 4K PNG over 10 MB", pngBuffer.length > 10 * 1024 * 1024, `${(pngBuffer.length / 1048576).toFixed(1)} MB`);

lastPage = alice;
const imagePage = (await aliceClient.rpc("create_page", { ws: sql("select id from public.workspaces where name = 'Alpha'"), parent: null, new_title: "Images" })).data.id;
await alice.goto(`${APP}/w/${alphaShort}/p/${imagePage}`);
await alice.waitForSelector(".bn-editor");
await alice.locator(".bn-editor").click();
await alice.keyboard.type("/зображення");
await alice.getByRole("option", { name: /Зображення/ }).first().waitFor();
await alice.keyboard.press("Enter");
await alice.locator(".bn-panel input[type=file]").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: pngBuffer });
await alice.locator(".bn-editor img.bn-visual-media[src^='http']").first().waitFor({ timeout: 60000 });
await alice.waitForFunction(() => document.body.innerText.includes("Збережено"), null, { timeout: 15000 });
await alice.waitForTimeout(1500);
const stored = sql(`select mime_type || '|' || bytes || '|' || width || 'x' || height || '|' || storage_path from public.attachments where page_id = '${imagePage}'`).split("|");
check("stored as WebP", stored[0] === "image/webp", stored[0]);
check("stored under 1 MB", Number(stored[1]) <= 1024 * 1024, `${(Number(stored[1]) / 1024).toFixed(0)} KB`);
check("resized to Full HD", stored[2] === "1920x1080", stored[2]);
check("file sits in the workspace folder", stored[3]?.startsWith(sql("select id from public.workspaces where name = 'Alpha'") + "/"), stored[3]);
check("document keeps the storage path, not a URL", JSON.stringify(pageContent(imagePage)).includes(`ek-attachment:${stored[3]}`));
const shownSrc = await alice.locator(".bn-editor img.bn-visual-media").first().getAttribute("src");
check("image shown through a signed URL", /\/storage\/v1\/object\/sign\//.test(shownSrc ?? ""), shownSrc?.slice(0, 80));
check("image loads lazily", (await alice.locator(".bn-editor img.bn-visual-media").first().getAttribute("loading")) === "lazy");

// Width steps from the toolbar.
await alice.locator(".bn-editor img.bn-visual-media").first().click();
await alice.getByRole("button", { name: "50%", exact: true }).click();
await alice.waitForTimeout(1800);
const width50 = JSON.stringify(pageContent(imagePage)).match(/"previewWidth":(\d+)/)?.[1];
// 50% of 1920 px, capped by the column width.
check("50% width step applied", Number(width50) > 0 && Number(width50) <= 960, String(width50));

// Nobody without access gets the file, signed URL or not.
const bobSession = await sessionCookies("bob@beta.test");
const bobUrl = await bobSession.client.storage.from("attachments").createSignedUrl(stored[3], 60);
check("bob can't get a signed URL for alpha's image", !bobUrl.data?.signedUrl, JSON.stringify(bobUrl.error?.message ?? bobUrl.data));
const anonFile = await fetch(`${API}/storage/v1/object/attachments/${stored[3]}`, { headers: { apikey: ANON } });
check("the file isn't public", anonFile.status >= 400, String(anonFile.status));
const svg = await aliceClient.rpc("register_attachment", { target_page: imagePage, file_type: "image/svg+xml", file_bytes: 100, file_width: 1, file_height: 1 });
check("SVG refused", svg.data?.error === "unsupported_type", JSON.stringify(svg.data));
const bigUpload = await aliceClient.storage.from("attachments").upload(`${stored[3]}.big.webp`, new Blob([new Uint8Array(3 * 1024 * 1024)], { type: "image/webp" }));
check("storage refuses unregistered / oversized uploads", Boolean(bigUpload.error), bigUpload.error?.message);

// Security headers and the video info route.
const headers = (await alice.goto(`${APP}/w/${alphaShort}/p/${docPage}`)).headers();
check("only YouTube may be framed (CSP)", (headers["content-security-policy"] ?? "").includes("frame-src https://www.youtube-nocookie.com"), headers["content-security-policy"]);
const anonVideo = await fetch(`${APP}/api/youtube?url=https://youtu.be/dQw4w9WgXcQ`, { redirect: "manual" });
check("video info route needs a session", anonVideo.status === 401 || (anonVideo.status >= 300 && anonVideo.status < 400), String(anonVideo.status));

// Phone layout.
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
await phone.context().addCookies(aliceCookies);
await phone.goto(`${APP}/w/${alphaShort}/p/${docPage}`);
await phone.waitForSelector(".bn-editor");
check("phone: no horizontal page scroll", (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 390);
check("phone: text is 17px", (await phone.evaluate(() => getComputedStyle(document.querySelector(".bn-editor")).fontSize)) === "17px");
await phone.getByRole("button", { name: /Зміст/ }).tap();
check("phone: contents open in a bottom sheet", (await phone.getByRole("dialog", { name: "Зміст" }).count()) > 0);

// --- Stage 5: access -------------------------------------------------------------

// The API test left the colleague as a commenter on "Alpha secret".
const until = async (condition, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
};
const { cookies: colleagueCookies } = await sessionCookies("colleague@alpha.test");
const colleague = await newPage(colleagueCookies);
await colleague.goto(`${APP}/w/${alphaShort}`);
await colleague.waitForSelector("aside");
check("shared page is under 'Поділились зі мною'", (await colleague.getByRole("region", { name: "Поділились зі мною" }).getByText("Alpha secret").count()) > 0);
check("colleague doesn't see alice's private pages", (await colleague.locator("aside").getByText("Images").count()) === 0);
await colleague.goto(`${APP}/w/${alphaShort}/p/${alphaPage}`);
await colleague.waitForSelector(".bn-editor");
check(
  "commenter sees the page read-only",
  (await colleague.locator("textarea").count()) === 0 &&
    (await colleague.getByRole("heading", { name: "Alpha secret" }).count()) > 0 &&
    (await colleague.getByText("Лише перегляд").count()) > 0 &&
    (await colleague.locator('.bn-editor[contenteditable="true"]').count()) === 0,
);
await colleague.getByRole("button", { name: "Поділитися" }).click();
const colleagueDialog = colleague.getByRole("dialog", { name: "Доступ до сторінки" });
await colleagueDialog.getByText("Змінювати доступ може лише власник").waitFor();
check("non-owner sees who has access but no controls", (await colleagueDialog.locator("select").count()) === 0 && (await colleagueDialog.locator('[title="alice@alpha.test"]').count()) > 0);

// The owner makes the colleague an editor and opens the page to the whole workspace.
await alice.goto(`${APP}/w/${alphaShort}/p/${alphaPage}`);
await alice.getByRole("button", { name: "Поділитися" }).click();
const aliceDialog = alice.getByRole("dialog", { name: "Доступ до сторінки" });
await aliceDialog.getByLabel(/^Роль: /).selectOption("editor");
const grantRole = () => sql(`select a.role from public.page_access a join auth.users u on u.id = a.user_id where a.page_id = '${alphaPage}' and u.email = 'colleague@alpha.test'`);
check("owner changes a role in the share dialog", await until(() => grantRole() === "editor"), grantRole());
await aliceDialog.getByLabel("Весь workspace").selectOption("viewer");
const wsRole = () => sql(`select coalesce(workspace_role, '-') from public.pages where id = '${alphaPage}'`);
check("owner opens the page to the whole workspace", await until(() => wsRole() === "viewer"), wsRole());
await colleague.goto(`${APP}/w/${alphaShort}/p/${alphaPage}`);
await colleague.waitForSelector("textarea");
// The editor loads after the page itself.
const editableEditor = await colleague.waitForSelector('.bn-editor[contenteditable="true"]', { timeout: 15000 }).then(() => true, () => false);
check("editor can now edit the page", editableEditor);
check("page moved to the 'Весь workspace' section", (await colleague.getByRole("region", { name: "Весь workspace" }).getByText("Alpha secret").count()) > 0);

// --- Stage 6: comments -----------------------------------------------------------

const alphaId = sql("select id from public.workspaces where name = 'Alpha'");
const colleagueId = sql("select id from auth.users where email = 'colleague@alpha.test'");
const para = (id, text) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
const talkPage = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Discussion" })).data.id;
await aliceClient.rpc("save_page_content", {
  target_page: talkPage,
  new_content: [para("p1", "Intro text."), para("p2", "Middle paragraph."), para("p3", "The commented phrase lives here.")],
  base_version: 1,
});
await aliceClient.rpc("set_page_member_role", { target_page: talkPage, member: colleagueId, new_role: "commenter" });

// Selects characters [start, end) of a paragraph's text, as a mouse drag would.
const selectText = async (page, text, start, end) => {
  await page.locator(".bn-inline-content", { hasText: text }).first().evaluate((el, [s, e]) => {
    const range = document.createRange();
    range.setStart(el.firstChild, s);
    range.setEnd(el.firstChild, e);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, [start, end]);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
};
const threadsOf = (id) => sql(`select coalesce(string_agg(t.id || ':' || t.status, ',' order by t.created_at), '') from public.comment_threads t where t.page_id = '${id}'`);

await alice.goto(`${APP}/w/${alphaShort}/p/${talkPage}`);
await alice.waitForSelector('.bn-editor[contenteditable="true"]');
await selectText(alice, "The commented phrase", 4, 20);
await alice.getByRole("button", { name: "Коментар", exact: true }).click();
const draftField = alice.getByLabel("Напишіть коментар… @ — згадати колегу");
await draftField.fill("Please check @coll");
await alice.getByRole("option", { name: /colleague/ }).click();
await draftField.press("End");
await draftField.type("thanks");
await alice.getByRole("button", { name: "Коментувати" }).click();
check("thread created", await until(() => threadsOf(talkPage).includes(":open")), threadsOf(talkPage));
const thread1 = threadsOf(talkPage).split(":")[0];
const markSaved = () => sql(`select (content::text like '%${thread1}%')::text from public.pages where id = '${talkPage}'`) === "true";
check("editor's comment mark saved in the document", await until(markSaved, 10000));
check("mention stored", sql(`select array_to_string(mentions, ',') from public.comments where thread_id = '${thread1}'`) === colleagueId);

// "Готово, коли": edits above the fragment keep the comment on it.
const versionBefore = pageVersion(talkPage);
await alice.locator(".bn-inline-content", { hasText: "Intro text." }).click();
await alice.keyboard.press("Home");
await alice.keyboard.type("Added above. ");
await alice.keyboard.press("Enter");
await alice.keyboard.type("A whole new paragraph.");
check("edits above saved", await until(() => pageVersion(talkPage) > versionBefore, 10000));
await alice.reload();
await alice.waitForSelector(".bn-editor");
const marked = alice.locator(`[data-comment-thread="${thread1}"]`);
await marked.first().waitFor();
check("comment still on its words after edits above", (await marked.allInnerTexts()).join("") === "commented phrase", (await marked.allInnerTexts()).join("|"));
check("thread still open after edits", threadsOf(talkPage) === `${thread1}:open`, threadsOf(talkPage));
check("open thread is highlighted", (await marked.first().evaluate((el) => getComputedStyle(el).backgroundColor)) !== "rgba(0, 0, 0, 0)");

// A commenter: the server marks the fragment for them; the rest of the text is unchanged.
const textBefore = sql(`select string_agg(value #>> '{}', '') from public.pages, jsonb_path_query(content, 'strict $.**.text') value where id = '${talkPage}'`);
await colleague.goto(`${APP}/w/${alphaShort}/p/${talkPage}`);
await colleague.waitForSelector(".bn-editor");
await colleague.waitForTimeout(500);
await selectText(colleague, "Middle paragraph.", 0, 6);
await colleague.getByRole("button", { name: "Коментар", exact: true }).click();
await colleague.getByLabel("Напишіть коментар… @ — згадати колегу").fill("Commenter's note");
await colleague.getByRole("button", { name: "Коментувати" }).click();
check("commenter's thread created", await until(() => threadsOf(talkPage).split(",").length === 2), threadsOf(talkPage));
const thread2 = threadsOf(talkPage).split(",")[1]?.split(":")[0];
check("server marked the commenter's fragment", sql(`select (content::text like '%${thread2}%')::text from public.pages where id = '${talkPage}'`) === "true");
const textAfter = sql(`select string_agg(value #>> '{}', '') from public.pages, jsonb_path_query(content, 'strict $.**.text') value where id = '${talkPage}'`);
check("commenter's mark changed no text", textBefore === textAfter, `${textBefore} -> ${textAfter}`);
check("commenter's quote recorded", sql(`select quoted_text from public.comment_threads where id = '${thread2}'`) === "Middle");

// The mention shows on the colleague's home page.
await colleague.goto(`${APP}/w/${alphaShort}`);
check("mention listed under 'Вас згадали'", (await colleague.getByText("Please check @colleague").count()) > 0 || (await colleague.getByText(/Please check @/).count()) > 0);

// Reply and resolve; the resolved thread moves to the archive and loses its highlight.
await alice.goto(`${APP}/w/${alphaShort}/p/${talkPage}?thread=${thread1}`);
await alice.waitForSelector(".bn-editor");
await alice.locator(`[data-comment-thread="${thread1}"]`).first().click();
const card = alice.locator(`[data-thread-card="${thread1}"]`);
await card.getByLabel("Відповісти… @ — згадати колегу").fill("Done, fixed.");
await card.getByRole("button", { name: "Відповісти" }).click();
check("reply saved", await until(() => sql(`select count(*) from public.comments where thread_id = '${thread1}'`) === "2"));
await card.getByRole("button", { name: "Вирішено" }).click();
check("thread resolved", await until(() => threadsOf(talkPage).includes(`${thread1}:resolved`)), threadsOf(talkPage));
await alice.reload();
await alice.waitForSelector(".bn-editor");
await alice.locator(`[data-comment-thread="${thread1}"]`).first().waitFor();
check("resolved fragment no longer highlighted", (await alice.locator(`[data-comment-thread="${thread1}"]`).first().evaluate((el) => getComputedStyle(el).backgroundColor)) === "rgba(0, 0, 0, 0)");
check("archive button lists the resolved thread", (await alice.getByRole("button", { name: "Архів коментарів (1)" }).count()) > 0);

// Deleting the commented text keeps the thread, marked "Фрагмент видалено".
const contentNow = pageContent(talkPage).filter((b) => !JSON.stringify(b).includes(thread2));
const deleted = await aliceClient.rpc("save_page_content", { target_page: talkPage, new_content: contentNow, base_version: pageVersion(talkPage) });
check("fragment deleted", deleted.data?.ok === true, JSON.stringify(deleted.data));
check("thread orphaned, not lost", threadsOf(talkPage).includes(`${thread2}:orphaned`), threadsOf(talkPage));
await alice.reload();
await alice.waitForSelector(".bn-editor");
await alice.getByRole("button", { name: /Коментарі: 1/ }).click();
check("orphaned thread shown as 'Фрагмент видалено'", (await alice.getByRole("dialog", { name: "Коментарі" }).getByText("Фрагмент видалено").count()) > 0);

// --- Diagram block -----------------------------------------------------------------

const diagramPage = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Diagram" })).data.id;
await aliceClient.rpc("set_page_member_role", { target_page: diagramPage, member: colleagueId, new_role: "viewer" });
const wide = await newPage(aliceCookies);
await wide.setViewportSize({ width: 1400, height: 1000 });
await wide.goto(`${APP}/w/${alphaShort}/p/${diagramPage}`);
await wide.waitForSelector('.bn-editor[contenteditable="true"]');
await wide.locator(".bn-editor").click();
await wide.keyboard.type("/схема");
await wide.getByRole("option", { name: /Схема/ }).first().click();
await wide.waitForSelector(".ek-diagram .react-flow", { timeout: 20000 });
const addNode = wide.getByRole("button", { name: /Нода/ });
await addNode.click();
await wide.getByLabel("Назва", { exact: true }).fill("<b>Brief</b>");
await wide.getByLabel("Опис").fill("From the client");
await wide.getByRole("group", { name: "Налаштування ноди" }).getByRole("button", { name: "Жовтий" }).first().click();
await wide.getByRole("button", { name: "✅" }).click();
await addNode.click();
await wide.getByLabel("Назва", { exact: true }).fill("Design");
check("two nodes on the canvas", (await wide.locator(".react-flow__node").count()) === 2);
// The second node lands on top of the first: move it to the right, along the grid.
const second = wide.locator(".react-flow__node").nth(1);
const sb = await second.boundingBox();
await wide.mouse.move(sb.x + 40, sb.y + 40);
await wide.mouse.down();
await wide.mouse.move(sb.x + 140, sb.y + 45, { steps: 6 });
await wide.mouse.move(sb.x + 300, sb.y + 43, { steps: 6 });
await wide.mouse.up();
const firstNode = wide.locator(".react-flow__node").nth(0);
await firstNode.hover();
const from = await firstNode.locator(".react-flow__handle-right").boundingBox();
await wide.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
await wide.mouse.down();
await second.hover({ force: true });
const to = await second.locator(".react-flow__handle-left").boundingBox();
await wide.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
await wide.mouse.up();
check("nodes connected", (await wide.locator(".react-flow__edge").count()) === 1);
const diagramData = () => {
  const block = (pageContent(diagramPage) ?? []).find((b) => b.type === "diagram");
  return block ? JSON.parse(block.props.data || "{}") : null;
};
const savedDiagram = await until(() => diagramData()?.edges?.length === 1 && diagramData()?.nodes?.[1]?.title === "Design", 12000);
const dd = diagramData();
check("diagram saved with the page", savedDiagram, JSON.stringify(dd).slice(0, 300));
check("node settings saved (title, description, fill, status)", dd?.nodes?.[0]?.title === "<b>Brief</b>" && dd.nodes[0].description === "From the client" && dd.nodes[0].fill === "yellow" && dd.nodes[0].emoji === "✅", JSON.stringify(dd?.nodes?.[0]));
check("positions snap to the 16px grid", dd?.nodes?.every((n) => n.x % 16 === 0 && n.y % 16 === 0), JSON.stringify(dd?.nodes?.map((n) => [n.x, n.y])));
check("dragged node stays aligned with its neighbour", dd?.nodes?.[0]?.y === dd?.nodes?.[1]?.y, JSON.stringify(dd?.nodes?.map((n) => n.y)));

// Readers see the same diagram, can't change it, and node text is never HTML.
await colleague.goto(`${APP}/w/${alphaShort}/p/${diagramPage}`);
await colleague.waitForSelector(".ek-diagram .react-flow__node", { timeout: 20000 });
check("reader sees the nodes", (await colleague.locator(".react-flow__node").count()) === 2 && (await colleague.locator(".react-flow__edge").count()) === 1);
check("node title shown as text, not HTML", (await colleague.getByText("<b>Brief</b>").count()) > 0 && (await colleague.locator(".react-flow__node b").count()) === 0);
check("reader has no diagram toolbar", (await colleague.getByRole("toolbar", { name: "Дії зі схемою" }).count()) === 0);
const rb = await colleague.locator(".react-flow__node").first().boundingBox();
await colleague.mouse.move(rb.x + 20, rb.y + 20);
await colleague.mouse.down();
await colleague.mouse.move(rb.x + 220, rb.y + 220, { steps: 5 });
await colleague.mouse.up();
const nodeLeft = async (p, i) => (await p.locator(".react-flow__node").nth(i).boundingBox()).x;
check("reader can't move nodes", Math.round((await nodeLeft(colleague, 1)) - (await nodeLeft(colleague, 0))) === Math.round((await nodeLeft(wide, 1)) - (await nodeLeft(wide, 0))));

// --- Diagram: several nodes at once ---------------------------------------------

await wide.goto(`${APP}/w/${alphaShort}/p/${diagramPage}`);
await wide.waitForSelector(".ek-diagram .react-flow__node", { timeout: 20000 });
const before2 = diagramData();
const n0 = wide.locator(".react-flow__node").nth(0);
const n1 = wide.locator(".react-flow__node").nth(1);
await n0.click();
await wide.keyboard.down("Shift");
await n1.click();
await wide.keyboard.up("Shift");
check("Shift+click selects two nodes", (await wide.locator(".react-flow__node.selected").count()) === 2);
const g0 = await n0.boundingBox();
await wide.mouse.move(g0.x + 30, g0.y + 30);
await wide.mouse.down();
await wide.mouse.move(g0.x + 60, g0.y + 80, { steps: 6 });
await wide.mouse.move(g0.x + 30, g0.y + 160, { steps: 6 });
await wide.mouse.up();
const movedTogether = await until(() => diagramData()?.nodes?.[0]?.y !== before2.nodes[0].y, 10000);
const after2 = diagramData();
const dx = after2.nodes.map((nd, i) => nd.x - before2.nodes[i].x);
const dy = after2.nodes.map((nd, i) => nd.y - before2.nodes[i].y);
check("selected nodes move together on the grid", movedTogether && dx[0] === dx[1] && dy[0] === dy[1] && dy[0] % 16 === 0 && dy[0] > 0, JSON.stringify({ dx, dy }));
await wide.getByRole("button", { name: /Виділення/ }).click();
const paneBox = await wide.locator(".ek-diagram .react-flow__pane").boundingBox();
await wide.locator(".ek-diagram .react-flow__pane").click({ position: { x: 4, y: 4 } });
await wide.mouse.move(paneBox.x + 4, paneBox.y + 4);
await wide.mouse.down();
await wide.mouse.move(paneBox.x + paneBox.width - 8, paneBox.y + paneBox.height - 8, { steps: 10 });
await wide.mouse.up();
check("selection tool frames all nodes", (await wide.locator(".react-flow__node.selected").count()) === 2);

// --- Editor extras: headings, chips, cards, navigation, images by link --------------

const privatePage = imagePage; // alice's own page, not shared with the colleague
const extrasPage = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Extras" })).data.id;
const extrasChild = (await aliceClient.rpc("create_page", { ws: alphaId, parent: extrasPage, new_title: "Extras child" })).data.id;
await aliceClient.rpc("set_page_member_role", { target_page: extrasPage, member: colleagueId, new_role: "viewer" });
const extrasThread = (await aliceClient.rpc("create_comment_thread", { target_page: extrasPage, quoted: "Body", body: "Note", mention_ids: [] })).data.id;
const statusSet = JSON.stringify([{ id: "todo", label: "Не розпочато", color: "gray" }, { id: "done", label: "Готово", color: "green" }]);
const extrasContent = [
  { id: "x1", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Section one", styles: {} }], children: [] },
  { id: "x2", type: "subtitle", props: {}, content: [{ type: "text", text: "A subtitle line", styles: {} }], children: [] },
  { id: "x3", type: "heading", props: { level: 4, isToggleable: true }, content: [{ type: "text", text: "Small heading", styles: {} }], children: [para("x3a", "Hidden under H4")] },
  { id: "x4", type: "paragraph", props: {}, content: [
    { type: "text", text: "Body ", styles: { comment: extrasThread } },
    { type: "text", text: "mono", styles: { mono: true } },
    { type: "text", text: " status ", styles: {} },
    { type: "chip", props: { name: "Статус", options: statusSet, value: "todo" } },
    { type: "text", text: " see ", styles: {} },
    { type: "pageChip", props: { pageId: privatePage } },
    { type: "text", text: " ask ", styles: {} },
    { type: "personChip", props: { userId: colleagueId, label: "Colleague" } },
  ], children: [] },
  { id: "x5", type: "linkCard", props: { url: "https://example.com/", title: "Example card", description: "Card description", image: "", icon: "", siteName: "example.com" }, children: [] },
  { id: "x6", type: "navigation", props: { scope: "children" }, children: [] },
  { id: "x7", type: "image", props: { url: "https://example.com/picture.png", name: "picture", previewWidth: 320 }, children: [] },
  { id: "x8", type: "table", content: { type: "tableContent", columnWidths: [null, null], rows: [{ cells: [{ type: "tableCell", props: { backgroundColor: "yellow", textColor: "default", textAlignment: "left", colspan: 1, rowspan: 1 }, content: [{ type: "text", text: "Cell", styles: {} }] }, { type: "tableCell", props: { backgroundColor: "default", textColor: "default", textAlignment: "left", colspan: 1, rowspan: 1 }, content: [] }] }] }, children: [] },
];
const extrasSaved = await aliceClient.rpc("save_page_content", { target_page: extrasPage, new_content: extrasContent, base_version: 1 });
check("extras page saved", extrasSaved.data?.ok === true, JSON.stringify(extrasSaved.data));

await wide.goto(`${APP}/w/${alphaShort}/p/${extrasPage}`);
await wide.waitForSelector('.bn-editor[contenteditable="true"]');
await wide.waitForTimeout(500);
check("subtitle shown", (await wide.locator(".ek-subtitle", { hasText: "A subtitle line" }).count()) === 1);
check("collapsible H4 shown", (await wide.locator('[data-content-type="heading"][data-level="4"]').count()) === 1);
check("monospace text shown", (await wide.locator(".ek-mono", { hasText: "mono" }).count()) === 1);
check("table cell colour kept", (await wide.locator('td[data-background-color="yellow"], th[data-background-color="yellow"]').count()) === 1);
check("link card shown", (await wide.locator(".ek-link-card-title", { hasText: "Example card" }).count()) === 1);
check("navigation lists subpages", (await wide.locator(".ek-navigation").getByText("Extras child").count()) === 1);
check("image by link marked external", (await wide.locator('[data-external="true"] img[referrerpolicy="no-referrer"]').count()) === 1);
check("page chip shows the title to someone with access", (await wide.locator(".ek-chip-link", { hasText: "Images" }).count()) === 1);
const chipButton = wide.getByRole("button", { name: "Статус: Не розпочато" });
await chipButton.click();
await wide.getByRole("menuitemradio", { name: "Готово" }).click();
const chipValue = () => JSON.stringify(pageContent(extrasPage)).includes('"value":"done"');
check("dropdown chip switch saved", await until(chipValue, 10000));

// The slash menu offers the new blocks.
// The caret goes to the end of the line by clicking its right edge.
const lineBox = await wide.locator(".bn-inline-content", { hasText: "Body" }).first().boundingBox();
await wide.mouse.click(lineBox.x + lineBox.width - 2, lineBox.y + lineBox.height / 2);
await wide.keyboard.press("Enter");
await wide.keyboard.type("/");
await wide.waitForSelector(".bn-suggestion-menu-item");
const menu = (await wide.locator(".bn-suggestion-menu-item").allInnerTexts()).join("\n");
const wanted = ["Заголовок 4", "Згортаний заголовок 4", "Підзаголовок", "Навігація", "Картка посилання", "Чіп-перемикач"];
check("slash menu has the new items", wanted.every((w) => menu.includes(w)), wanted.filter((w) => !menu.includes(w)).join(", "));
await wide.keyboard.press("Escape");
await wide.keyboard.press("Backspace");

// Right column on a page with comments: contents/comments switch and placement.
check("contents/comments tabs", (await wide.getByRole("tab", { name: "Зміст" }).count()) === 1 && (await wide.getByRole("tab", { name: /Коментарі/ }).count()) === 1);
await wide.getByRole("tab", { name: "Зміст" }).click();
check("contents tab lists headings", (await wide.getByRole("navigation", { name: "Зміст" }).getByText("Section one").count()) > 0);
await wide.getByRole("button", { name: "Зміст:" }).click();
await wide.getByRole("radio", { name: "ліворуч замість дерева" }).click();
await wide.waitForTimeout(300);
check("contents move to the sidebar instead of the tree", (await wide.locator("aside").getByRole("region", { name: "Зміст" }).getByText("Section one").count()) > 0 && (await wide.locator("aside").getByRole("button", { name: /Дерево сторінок/ }).count()) > 0);
await wide.locator("aside").getByRole("button", { name: /Дерево сторінок/ }).click();
check("tree comes back on request", (await wide.locator("aside").getByRole("tree").count()) > 0);
await wide.getByRole("button", { name: "Зміст:" }).click();
await wide.getByRole("radio", { name: "праворуч (перемикач)" }).click();

// A reader: chip is read-only, a page they can't open shows no title.
await colleague.goto(`${APP}/w/${alphaShort}/p/${extrasPage}`);
await colleague.waitForSelector(".bn-editor");
await colleague.waitForTimeout(500);
check("reader can't switch the chip", await colleague.getByRole("button", { name: /Статус:/ }).isDisabled());
check("page chip hides a page the reader can't open", (await colleague.locator(".ek-chip", { hasText: "Немає доступу" }).count()) === 1 && (await colleague.locator(".ek-chip", { hasText: "Images" }).count()) === 0);
check("person chip shows the colleague", (await colleague.locator(".ek-chip", { hasText: /colleague|Colleague/ }).count()) === 1);

// Link previews: only public https addresses, only for signed-in people.
const preview = (url) => wide.evaluate(async (u) => (await fetch(`/api/link-preview?url=${encodeURIComponent(u)}`)).status, url);
for (const [label, url, expected] of [
  ["http refused", "http://example.com/", 400],
  ["loopback refused", "https://127.0.0.1/", 400],
  ["localhost refused", "https://localhost/", 400],
  ["private network refused", "https://192.168.1.1/", 400],
  ["metadata address refused", "https://169.254.169.254/latest/meta-data", 400],
  ["other port refused", "https://example.com:8443/", 400],
  ["name pointing inside refused", "https://localtest.me/", 422],
]) {
  const status = await preview(url);
  check(`link preview: ${label}`, status === expected, String(status));
}
const anonPreview = await fetch(`${APP}/api/link-preview?url=https://example.com/`, { redirect: "manual" });
check("link preview needs a session", anonPreview.status === 401 || (anonPreview.status >= 300 && anonPreview.status < 400), String(anonPreview.status));
const realPreview = await wide.evaluate(async () => {
  const r = await fetch("/api/link-preview?url=https://example.com/");
  return r.ok ? (await r.json()).title : `HTTP ${r.status}`;
});
check("link preview reads a public page", /Example Domain/i.test(String(realPreview)), String(realPreview));

// Search: titles and text, only pages the person can open.
await wide.keyboard.press("Control+k");
const searchBox = wide.getByLabel("Шукати в назвах і тексті сторінок…");
await searchBox.fill("Hidden");
const searchResults = wide.getByRole("list", { name: "Результати пошуку" });
await searchResults.waitFor({ timeout: 10000 });
check("search finds text inside a page", (await searchResults.getByText("Extras").count()) > 0);
await searchBox.fill("Imag");
await wide.waitForTimeout(800);
check("search matches word beginnings in titles", (await searchResults.getByText("Images").count()) > 0);
await wide.keyboard.press("Escape");
await colleague.keyboard.press("Control+k");
const colleagueSearch = colleague.getByLabel("Шукати в назвах і тексті сторінок…");
await colleagueSearch.fill("Images");
await colleague.waitForTimeout(1200);
check("search hides pages the person can't open", (await colleague.getByRole("list", { name: "Результати пошуку" }).getByText("Images").count()) === 0);
await colleagueSearch.fill("Extras");
await colleague.getByRole("list", { name: "Результати пошуку" }).waitFor({ timeout: 10000 });
check("search finds shared pages", (await colleague.getByRole("list", { name: "Результати пошуку" }).getByText("Extras").count()) > 0);
await colleague.keyboard.press("Escape");

// --- Contents/comments switch follows the scroll ---------------------------------

await wide.goto(`${APP}/w/${alphaShort}/p/${extrasPage}`);
await wide.waitForSelector(".bn-editor");
await wide.evaluate(() => {
  const spacer = document.createElement("div");
  spacer.style.height = "3000px";
  document.querySelector(".ek-editor").parentElement.appendChild(spacer);
});
await wide.mouse.wheel(0, 2000);
await wide.waitForTimeout(400);
const pill = await wide.getByRole("tab", { name: /Зміст/ }).boundingBox();
check("contents/comments switch stays on screen while scrolling", pill !== null && pill.y >= 0 && pill.y < 200, JSON.stringify(pill));

// --- Feedback ------------------------------------------------------------------------

await wide.getByRole("button", { name: "Залишити відгук" }).click();
const feedback = wide.getByRole("dialog", { name: "Відгук про вікі" });
await feedback.getByLabel("Що це?").selectOption("bug");
await feedback.getByLabel("Опис").fill("Smoke test feedback");
await feedback.getByRole("button", { name: "Надіслати" }).click();
// CI has no sheet configured: the form says so instead of pretending it worked.
await feedback.getByRole("alert").waitFor();
check("feedback without a sheet says it's not connected", (await feedback.getByRole("alert").innerText()).includes("не підключено"));
await wide.keyboard.press("Escape");
const badFeedback = await wide.evaluate(async () => (await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "hack", text: "" }) })).status);
check("feedback rejects unknown types", badFeedback === 400, String(badFeedback));
const anonFeedback = await fetch(`${APP}/api/feedback`, { method: "POST", body: "{}", redirect: "manual", headers: { "Content-Type": "application/json" } });
check("feedback needs a session", anonFeedback.status === 401 || (anonFeedback.status >= 300 && anonFeedback.status < 400), String(anonFeedback.status));

// --- Page cover ------------------------------------------------------------------------

const coverOf = (id) => JSON.parse(sql(`select coalesce(cover, 'null'::jsonb)::text from public.pages where id = '${id}'`));
await wide.goto(`${APP}/w/${alphaShort}/p/${extrasPage}`);
await wide.getByRole("button", { name: /Додати обкладинку/ }).click();
await wide.getByRole("tab", { name: "Колір" }).click();
await wide.getByRole("group", { name: "Кольори" }).getByRole("button").first().click();
check("colour cover saved", await until(() => coverOf(extrasPage)?.type === "color"), JSON.stringify(coverOf(extrasPage)));
await wide.locator('[data-testid="page-cover"]').hover();
await wide.getByRole("button", { name: "Змінити обкладинку" }).click();
await wide.getByRole("tab", { name: "Градієнт" }).click();
await wide.getByRole("radio", { name: "Радіальний" }).click();
await wide.getByRole("button", { name: /Точка кольору/ }).click();
await wide.getByRole("button", { name: "Застосувати" }).click();
const gradientSaved = await until(() => coverOf(extrasPage)?.type === "gradient");
const savedGradient = coverOf(extrasPage);
check("gradient cover saved (radial, 3 stops)", gradientSaved && savedGradient.kind === "radial" && savedGradient.stops.length === 3, JSON.stringify(savedGradient));
await colleague.goto(`${APP}/w/${alphaShort}/p/${extrasPage}`);
await colleague.waitForSelector('[data-testid="page-cover"]');
check("reader sees the cover but can't change it", (await colleague.getByRole("button", { name: "Змінити обкладинку" }).count()) === 0);
const { client: colleagueClient } = await sessionCookies("colleague@alpha.test");
const readerCover = await colleagueClient.rpc("set_page_cover", { target_page: extrasPage, new_cover: null });
check("reader's direct cover change refused", readerCover.data?.error === "forbidden", JSON.stringify(readerCover.data));

// --- Theme and language --------------------------------------------------------------

const prefsOf = (email) => sql(`select theme || ' ' || locale from public.profiles where email = '${email}'`);
await wide.getByRole("radio", { name: "Темна", exact: true }).click();
check("dark theme applied", (await wide.evaluate(() => document.documentElement.dataset.theme)) === "dark");
check("theme saved in the profile", await until(() => prefsOf("alice@alpha.test").startsWith("dark")), prefsOf("alice@alpha.test"));
await wide.reload();
check("theme kept after reload", (await wide.evaluate(() => document.documentElement.dataset.theme)) === "dark");
await Promise.all([wide.waitForEvent("load"), wide.getByRole("radio", { name: "EN" }).click()]);
await wide.waitForSelector("aside");
check("interface switches to English", (await wide.locator("aside").getByText("New page").count()) > 0 && (await wide.evaluate(() => document.documentElement.lang)) === "en");
check("language saved in the profile", prefsOf("alice@alpha.test") === "dark en", prefsOf("alice@alpha.test"));
// A new device (no cookies yet) gets the language and theme from the profile.
const { cookies: freshCookies } = await sessionCookies("alice@alpha.test");
const freshDevice = await newPage(freshCookies);
await freshDevice.goto(`${APP}/w/${alphaShort}`);
check("new device follows the profile", (await freshDevice.evaluate(() => `${document.documentElement.lang} ${document.documentElement.dataset.theme}`)) === "en dark");
await Promise.all([wide.waitForEvent("load"), wide.getByRole("radio", { name: "UA" }).click()]);
await wide.getByRole("radio", { name: "System", exact: true }).or(wide.getByRole("radio", { name: "Системна", exact: true })).first().click();
check("back to Ukrainian and system theme", await until(() => prefsOf("alice@alpha.test") === "system uk"), prefsOf("alice@alpha.test"));

await aliceClient.auth.signOut();
await browser.close();

for (const p of problems) check("no server errors or page crashes", false, p);
if (!problems.length) check("no server errors or page crashes", true);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`::error title=E2E smoke::${f.name} — ${f.detail}`);
console.log(`::notice title=E2E smoke::${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
