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

await aliceClient.auth.signOut();
await browser.close();

for (const p of problems) check("no server errors or page crashes", false, p);
if (!problems.length) check("no server errors or page crashes", true);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`::error title=E2E smoke::${f.name} — ${f.detail}`);
console.log(`::notice title=E2E smoke::${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
