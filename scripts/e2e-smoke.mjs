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
  page.on("dialog", (d) => d.accept().catch(() => {}));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
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

await aliceClient.auth.signOut();
await browser.close();

for (const p of problems) check("no server errors or page crashes", false, p);
if (!problems.length) check("no server errors or page crashes", true);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`::error title=E2E smoke::${f.name} — ${f.detail}`);
console.log(`::notice title=E2E smoke::${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
