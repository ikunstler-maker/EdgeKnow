// Shared setup of the browser smoke test: the Supabase stack from status.json,
// helpers, and the people every part uses. Each part (wiki, tasks, team) runs
// on its own machine against its own fresh stack, after scripts/api-isolation.mjs
// (which leaves alice owning "Alpha", bob owning "Beta", the colleague in Alpha).


import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";

export const status = JSON.parse(readFileSync(process.argv[2] ?? "status.json", "utf8"));
export const APP = process.argv[3] ?? "http://localhost:3000";
export const API = status.API_URL;
export const ANON = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
export const sql = (query) => execFileSync("psql", [status.DB_URL, "-Atc", query], { encoding: "utf8" }).trim();

// Cut by characters, never inside an emoji (half of one breaks GitHub's log).
export const clip = (text, length) => Array.from(String(text ?? "")).slice(0, length).join("").replace(/[\uD800-\uDFFF]/g, "");
export const results = [];
// A crash (timeout, missing element) is reported as an annotation with the last passed step.
export const consoleErrors = [];
let lastPage = null;
const crash = async (error) => {
  const message = clip(String(error?.message ?? error).split("\n").slice(0, 3).join(" "), 600);
  console.log(`::error title=E2E crashed::${message} — after: ${results.at(-1)?.name ?? "start"}`);
  const alerts = await lastPage?.locator("[role=alert]").allInnerTexts().catch(() => []);
  if (alerts?.length) console.log(`::error title=On-screen alerts::${clip(alerts.join(" | "), 600)}`);
  if (consoleErrors.length) console.log(`::error title=Browser console::${clip(consoleErrors.slice(-4).join(" | "), 900)}`);
  const screen = await lastPage?.evaluate(() => `${location.pathname} — ${document.body.innerText.replace(/\s+/g, " ").slice(0, 500).replace(/[\uD800-\uDFFF]$/, "")}`).catch(() => "");
  if (screen) console.log(`::error title=On screen::${screen}`);
  process.exit(1);
};
process.on("unhandledRejection", crash);
process.on("uncaughtException", crash);
export const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// Signs in with a password and returns the auth cookies exactly as @supabase/ssr writes them.
export async function sessionCookies(email) {
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

export const browser = await chromium.launch();
export const problems = [];

export async function newPage(cookies = []) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  if (cookies.length) await context.addCookies(cookies);
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(clip(m.text(), 300));
  });
  lastPage = page;
  page.on("dialog", (d) => d.accept().catch(() => {}));
  page.on("response", (r) => {
    // 503 from the feedback route is expected in CI: no Google Sheet is connected there.
    if (r.status() >= 500 && !(r.status() === 503 && r.url().endsWith("/api/feedback"))) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return page;
}

// The page whose on-screen alerts a crash reports.
export const setLastPage = (page) => (lastPage = page);

export const until = async (condition, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
};
export const pageContent = (id) => JSON.parse(sql(`select coalesce(content, 'null'::jsonb)::text from public.pages where id = '${id}'`));
export const pageVersion = (id) => Number(sql(`select version from public.pages where id = '${id}'`));
export const fakeDir = process.env.DRIVE_FAKE_DIR;
export { readdirSync };

export const alphaShort = sql("select short_id from public.workspaces where name = 'Alpha'");
export const alphaPage = sql("select id from public.pages where title = 'Alpha secret'");
export const alphaId = sql("select id from public.workspaces where name = 'Alpha'");
export const betaId = sql("select id from public.workspaces where name = 'Beta'");
export const colleagueId = sql("select id from auth.users where email = 'colleague@alpha.test'");

export const { cookies: aliceCookies, client: aliceClient } = await sessionCookies("alice@alpha.test");
export const alice = await newPage(aliceCookies);
export const { cookies: bobCookies } = await sessionCookies("bob@beta.test");
export const bob = await newPage(bobCookies);
export const { cookies: colleagueCookies, client: colleagueClient } = await sessionCookies("colleague@alpha.test");
export const colleague = await newPage(colleagueCookies);
setLastPage(alice);

// A 4K PNG over 10 MB, drawn in the browser (gradient + noise, like a photo).
export async function makeTestPng(page) {
  const png = await page.evaluate(async () => {
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
  return Buffer.from(png, "base64");
}

// Closes the browser and reports: every check, and any server error or page crash on the way.
export async function finish(part) {
  await aliceClient.auth.signOut();
  await browser.close();

  for (const p of problems) check("no server errors or page crashes", false, p);
  if (!problems.length) check("no server errors or page crashes", true);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const f of failed) console.log(`::error title=E2E ${part}::${clip(`${f.name} — ${f.detail}`, 800)}`);
  console.log(`::notice title=E2E ${part}::${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);

}
