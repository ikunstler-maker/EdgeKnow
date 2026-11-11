// Browser smoke test, part 1: the wiki (pages, editor, images, access, comments,
// diagrams, search, cover, theme, Google Drive, help, statistics, team sign-in).
// Usage: node scripts/e2e/wiki.mjs status.json http://localhost:3000

import { readFileSync, writeFileSync } from "node:fs";
import {
  ANON, API, APP, alice, aliceClient, aliceCookies, alphaId, alphaPage, alphaShort, betaId, bob, bobCookies, browser, check, colleague,
  colleagueClient, colleagueCookies, colleagueId, fakeDir, finish, makeTestPng, newPage, pageContent, pageVersion, problems, readdirSync,
  results, sessionCookies, setLastPage, sql, status, until,
} from "./common.mjs";


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
const clickedAt = Date.now();
await alice.getByRole("button", { name: "Нова сторінка" }).first().click();
// The row is added and the address changes in the same moment, before the server answers.
await alice.waitForURL(new RegExp(`/w/${alphaShort}/p/[0-9a-f-]{36}(\\?new=1)?$`));
const rowAfter = Date.now() - clickedAt;
// Wait for the new, empty page to be on screen before typing (as a person would).
await alice.waitForFunction(() => document.querySelector("textarea")?.value === "");
const openAfter = Date.now() - clickedAt;
check("a new page shows in the tree at once and opens soon after", rowAfter < 1000 && openAfter < 5000, `address ${rowAfter} ms, page ${openAfter} ms`);
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
  ["people", "Запросити"],
  ["security", "alpha.test"],
  ["data", "Резервні копії"],
  ["log", "Журнал змін"],
  // Addresses from before the five tabs still open the right place.
  ["members", "Запросити"],
  ["domains", "alpha.test"],
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
const betaShortId = sql(`select short_id from public.workspaces where id = '${betaId}'`);
check("admin page lists all workspaces", (await alice.getByRole("cell", { name: /Alpha/ }).count()) > 0 && (await alice.getByRole("cell", { name: betaShortId }).count()) > 0);
check("…a workspace she isn't in shows only its ID: no name, no owner's email", (await alice.getByRole("link", { name: "Beta", exact: true }).count()) === 0 && (await alice.getByText("bob@beta.test").count()) === 0);
check("admin page shows no page titles", (await alice.getByText("Alpha secret").count()) === 0);

// --- Domains proven through DNS ---------------------------------------------------------------
// The server reads DNS from DNS_FAKE_FILE in CI; writing it is "adding the record".
const fakeDns = process.env.DNS_FAKE_FILE;
const publishDns = (records) => writeFileSync(fakeDns, JSON.stringify(records));
publishDns({});
await alice.goto(`${APP}/w/${alphaShort}/settings?tab=domains`);
await alice.getByLabel("Новий домен").fill("alpha-corp.test");
await alice.getByRole("button", { name: "Підтвердити через DNS" }).click();
const request = alice.locator('[data-domain-request="alpha-corp.test"]');
await request.waitFor({ timeout: 15000 });
const txtValue = await request.locator("input[readonly]").nth(1).inputValue();
check("asking for another domain shows the TXT record to add", (await request.locator("input[readonly]").first().inputValue()) === "_edgeknow.alpha-corp.test" && /^edgeknow-verify=[0-9a-f]{32}$/.test(txtValue), txtValue);
await request.getByRole("button", { name: "Перевірити" }).click();
await alice.getByText("Запису в DNS ще не видно").first().waitFor({ timeout: 15000 }).catch(() => {});
check("…without the record it isn't confirmed", (await alice.getByText("Запису в DNS ще не видно").count()) > 0 && sql("select count(*) from public.workspace_domains where domain = 'alpha-corp.test'") === "0");
publishDns({ "_edgeknow.alpha-corp.test": ["v=something-else", txtValue] });
await request.getByRole("button", { name: "Перевірити" }).click();
await alice.locator('[data-domain="alpha-corp.test"]').waitFor({ timeout: 15000 }).catch(() => {});
check("…with the record it is confirmed", sql("select method from public.workspace_domains where domain = 'alpha-corp.test'") === "dns" && (await alice.locator('[data-domain="alpha-corp.test"]').getByText("Підтверджено через DNS").count()) === 1);
// The platform admin confirms a request by hand.
await alice.getByLabel("Новий домен").fill("alpha-manual.test");
await alice.getByRole("button", { name: "Підтвердити через DNS" }).click();
await alice.locator('[data-domain-request="alpha-manual.test"]').waitFor({ timeout: 15000 });
await alice.goto(`${APP}/admin`);
check("the platform panel lists the request", (await alice.getByText("alpha-manual.test").count()) === 1);
await alice.getByRole("button", { name: "Підтвердити вручну" }).click();
await alice.waitForTimeout(1500);
check("…and confirms it by hand", sql("select method from public.workspace_domains where domain = 'alpha-manual.test'") === "admin");
// The switch for the instant email way.
await alice.locator("section", { has: alice.getByRole("heading", { name: "Домени команд" }) }).getByRole("button", { name: "Вимкнути" }).click();
await alice.waitForTimeout(1500);
check("the platform admin turns the email way off", sql("select email_domain_proof from public.platform_settings") === "f");
await alice.goto(`${APP}/w/${alphaShort}/settings?tab=domains`);
await alice.getByLabel("Новий домен").fill("alpha.test");
check("…then even one's own domain needs DNS", (await alice.getByRole("button", { name: "Підтвердити через DNS" }).count()) === 1);
sql("update public.platform_settings set email_domain_proof = true");
sql("delete from public.workspace_domains where domain in ('alpha-corp.test', 'alpha-manual.test')");

// New workspace from the switcher.
await alice.goto(`${APP}/new`);
await alice.getByLabel("Назва").fill("Gamma");
await alice.getByRole("button", { name: "Створити" }).click();
await alice.waitForURL(/\/w\/[a-z0-9]{8}$/);
check("new workspace opens", (await alice.getByRole("button", { name: "Перемкнути workspace" }).innerText()).includes("Gamma"));
check("new workspace has an empty tree", (await alice.locator("aside").getByText("Alpha secret").count()) === 0);

// First steps on a new workspace, and the example pages to start from.
const onboarding = alice.locator("[data-onboarding]");
check("a new workspace shows its owner the first steps", (await onboarding.getByText("Перші кроки").count()) === 1 && (await onboarding.getByRole("link", { name: "Запросити колег" }).count()) === 1);
await onboarding.getByRole("button", { name: "Додати приклади сторінок" }).click();
await alice.locator("aside").getByText("Ласкаво просимо").waitFor({ timeout: 20000 }).catch(() => {});
const gammaId = sql("select id from public.workspaces where name = 'Gamma'");
check(
  "…the example pages are added, with their text",
  sql(`select string_agg(title, ',' order by title) from public.pages where workspace_id = '${gammaId}'`) === "Ласкаво просимо,Наша команда,Як писати сторінки" &&
    sql(`select count(*) from public.pages where workspace_id = '${gammaId}' and content::text like '%Для чого ця вікі%'`) === "1",
  sql(`select string_agg(title, ',') from public.pages where workspace_id = '${gammaId}'`),
);
check("…and the first-page step is ticked", (await onboarding.getByText("Створити першу сторінку").evaluate((el) => getComputedStyle(el).textDecorationLine).catch(() => "")) === "line-through");
await onboarding.getByRole("button", { name: "Сховати" }).click();
await alice.reload();
// The card may show for a moment until the page has read this browser's choice.
await alice.locator("[data-onboarding]").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
check("…hidden, they stay hidden", (await alice.locator("[data-onboarding]").count()) === 0);
sql(`delete from public.pages where workspace_id = '${gammaId}'`);

// Bob can't open Alpha in the browser either.
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

// «What's new» is open to everyone: a timeline with filters kept in the address.
await anon.goto(`${APP}/changelog?type=fixed`);
await anon.locator("[data-release]").first().waitFor({ timeout: 20000 });
check("the changelog opens signed out, filtered by the address", anon.url().includes("/changelog") && (await anon.locator('[data-update]:not([data-update="fixed"])').count()) === 0 && (await anon.locator('[data-update="fixed"]').count()) >= 1);
await anon.locator("[data-changelog-type]").selectOption("all");
await anon.locator('[data-changelog-scope="sheets"]').click();
check("…its service filter narrows the releases", (await anon.locator("[data-release]").count()) >= 1 && anon.url().includes("scope=sheets"), anon.url());

// --- Stage 3: the editor ------------------------------------------------------

const fixture = JSON.parse(readFileSync(new URL("../fixtures/all-blocks.json", import.meta.url), "utf8"));

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

// --- Galleries: images, YouTube and audio; four layouts; only safe sources ------------------
const galleryPage = (await aliceClient.rpc("create_page", { ws: sql("select id from public.workspaces where name = 'Alpha'"), parent: null, new_title: "Gallery" })).data.id;
await aliceClient.rpc("save_page_content", {
  target_page: galleryPage,
  base_version: 1,
  new_content: [
    {
      type: "gallery",
      props: {
        layout: "featured",
        items: JSON.stringify([
          { id: "v", kind: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", caption: "Clip" },
          { id: "x", kind: "image", url: "javascript:alert(1)", caption: "Bad" },
          { id: "y", kind: "audio", url: "http://evil.example/a.mp3", caption: "Bad audio" },
        ]),
      },
    },
  ],
});
await alice.goto(`${APP}/w/${alphaShort}/p/${galleryPage}`);
await alice.locator('[data-gallery="featured"]').waitFor({ timeout: 20000 });
check("a gallery shows its items, never unsafe sources", (await alice.locator('[data-gallery] [data-gallery-strip] button').count()) === 3 && (await alice.locator('[data-gallery] [src^="javascript"], [data-gallery] [src^="http://"]').count()) === 0);
await alice.locator('[data-gallery-layout="grid"]').click();
const galleryLayout = () => sql(`select b -> 'props' ->> 'layout' from public.pages p, jsonb_array_elements(p.content) b where p.id = '${galleryPage}' and b ->> 'type' = 'gallery'`);
check("…its layout changes and is saved", await until(() => galleryLayout() === "grid", 15000), galleryLayout());
// A small MP3 (an ID3 header) uploads as the page's own audio file.
await alice.locator('[data-gallery-file="audio"]').setInputFiles({ name: "chime.mp3", mimeType: "audio/mpeg", buffer: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(997)]) });
check("…audio uploads into the page's files", await until(() => sql(`select count(*) from public.attachments where page_id = '${galleryPage}' and mime_type = 'audio/mpeg'`) === "1", 20000));
const galleryItems = () => sql(`select b -> 'props' ->> 'items' from public.pages p, jsonb_array_elements(p.content) b where p.id = '${galleryPage}' and b ->> 'type' = 'gallery'`);
const audioSaved = await until(() => /"kind":"audio","url":"ek-attachment:[^"]+\.mp3"/.test(galleryItems()), 20000);
await alice.reload();
await alice.locator("[data-gallery-grid] audio").first().waitFor({ timeout: 20000 }).catch(() => {});
const galleryShown = `${await alice.locator("[data-gallery-grid] > figure").count()} items, ${await alice.locator("[data-gallery-grid] audio").count()} players`;
check("…and is saved in the gallery with a player (only for our own file)", audioSaved && galleryShown === "4 items, 1 players", `${galleryShown} | ${galleryItems().slice(0, 200)}`);

// --- Stage 4: images ------------------------------------------------------------

const pngBuffer = await makeTestPng(alice);
check("test image is a 4K PNG over 10 MB", pngBuffer.length > 10 * 1024 * 1024, `${(pngBuffer.length / 1048576).toFixed(1)} MB`);

setLastPage(alice);
const imagePage = (await aliceClient.rpc("create_page", { ws: sql("select id from public.workspaces where name = 'Alpha'"), parent: null, new_title: "Images" })).data.id;
await alice.goto(`${APP}/w/${alphaShort}/p/${imagePage}`);
await alice.waitForSelector(".bn-editor");
await alice.locator(".bn-editor").click();
await alice.keyboard.type("/зображення");
await alice.getByRole("option", { name: /Зображення/ }).first().waitFor();
await alice.keyboard.press("Enter");
await alice.locator(".bn-panel input[type=file]").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: pngBuffer });
await alice.locator(".bn-editor img.bn-visual-media[src^='/api/files/']").first().waitFor({ timeout: 60000 });
await alice.waitForFunction(() => document.body.innerText.includes("Збережено"), null, { timeout: 15000 });
await alice.waitForTimeout(1500);
const stored = sql(`select mime_type || '|' || bytes || '|' || width || 'x' || height || '|' || storage_path from public.attachments where page_id = '${imagePage}'`).split("|");
check("stored as WebP", stored[0] === "image/webp", stored[0]);
check("stored under 1 MB", Number(stored[1]) <= 1024 * 1024, `${(Number(stored[1]) / 1024).toFixed(0)} KB`);
check("resized to Full HD", stored[2] === "1920x1080", stored[2]);
check("file sits in the workspace folder", stored[3]?.startsWith(sql("select id from public.workspaces where name = 'Alpha'") + "/"), stored[3]);
check("document keeps the storage path, not a URL", JSON.stringify(pageContent(imagePage)).includes(`ek-attachment:${stored[3]}`));
const shownSrc = await alice.locator(".bn-editor img.bn-visual-media").first().getAttribute("src");
check("image shown through our access-checked file route", (shownSrc ?? "").startsWith("/api/files/") && (await alice.locator(".bn-editor img.bn-visual-media").first().evaluate((img) => img.naturalWidth)) > 0, shownSrc?.slice(0, 80));
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

// Image by link: a Google Drive "Share" link is turned into a direct image link.
const linkPage = (await aliceClient.rpc("create_page", { ws: sql("select id from public.workspaces where name = 'Alpha'"), parent: null, new_title: "Image links" })).data.id;
await alice.goto(`${APP}/w/${alphaShort}/p/${linkPage}`);
await alice.waitForSelector(".bn-editor");
await alice.locator(".bn-editor").click();
await alice.keyboard.type("/зображення");
await alice.getByRole("option", { name: /Зображення/ }).first().waitFor();
await alice.keyboard.press("Enter");
await alice.getByRole("tab", { name: "За посиланням" }).click();
check("the link tab says Google Drive links work", (await alice.getByText("Можна й з Google Drive").count()) === 1);
const linkField = alice.getByLabel("Посилання на зображення");
await linkField.fill("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp");
await alice.getByRole("button", { name: "Вставити" }).click();
check("a Drive folder link is explained", (await alice.getByText("Це посилання на папку Google Drive").count()) === 1);
const driveRequests = [];
alice.on("request", (request) => request.url().startsWith("https://drive.google.com/thumbnail?id=") && driveRequests.push(request.url()));
await linkField.fill("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/view?usp=sharing");
await alice.getByRole("button", { name: "Вставити" }).click();
// The made-up file doesn't exist, so Drive refuses it and the hint about sharing shows.
await alice.getByText("Google Drive не показує цей файл").waitFor({ timeout: 20000 }).catch(() => {});
check("a Drive file link asks Drive for the image itself", driveRequests.some((u) => u.includes("id=1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789")), driveRequests.join(" "));
check("…and explains sharing when Drive won't show it", (await alice.getByText("Google Drive не показує цей файл").count()) === 1);
await alice.keyboard.press("Escape");

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
// By what is on a page: "заголовки" lists every heading; words after it narrow it down.
const blockResults = wide.locator("[data-block-results]");
await searchBox.fill("заголовки");
await blockResults.waitFor({ timeout: 10000 });
check("“заголовки” lists the headings themselves", (await blockResults.getByText("Heading one").count()) === 1 && (await blockResults.getByText("Heading two").count()) === 1);
await searchBox.fill("заголовок two");
await wide.waitForTimeout(1000);
check("…“заголовок two” only the matching one", (await blockResults.getByText("Heading two").count()) === 1 && (await blockResults.getByText("Heading one").count()) === 0);
await searchBox.fill("");
await wide.getByRole("button", { name: "🖼️ Зображення" }).click();
await wide.waitForTimeout(1200);
check("the Images button lists pages with images", (await blockResults.getByText("Images").count()) > 0);
await wide.getByRole("button", { name: "⌨️ Код" }).click();
await wide.waitForTimeout(1200);
check("…and Code the code blocks", (await blockResults.getByText("const answer = 42;").count()) === 1);
await wide.getByRole("button", { name: "Текст", exact: true }).click();
await searchBox.fill("Imag");
await wide.waitForTimeout(800);
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

// Feedback lives in Apus's menu (Apus moves, so the click does not wait for it to stand still).
await wide.locator("[data-apus-button]").click({ force: true });
await wide.locator('[data-apus-item="feedback"]').click();
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

// --- Mentions with a person chip in the text --------------------------------------------

await colleague.goto(`${APP}/w/${alphaShort}`);
check("person chip in a page's text shows under 'Вас згадали'", (await colleague.getByText("згадав(-ла) вас у тексті сторінки").count()) > 0);

// --- Google Drive storage (a local stand-in for Drive in CI) ---------------------------

const { readFileSync: readFake } = await import("node:fs");
const fakeFiles = () => {
  try {
    return readdirSync(fakeDir).filter((f) => !f.endsWith(".type"));
  } catch {
    return [];
  }
};
const driveRows = () => sql(`select count(*) from public.drive_connections where workspace_id = '${alphaId}'`);
const settingsUrl = `${APP}/w/${alphaShort}/settings?tab=storage`;
await wide.goto(settingsUrl);
check("storage tab shows Supabase usage", (await wide.getByText(/Зараз файли зберігаються в Supabase/).count()) > 0);

// Only the owner may connect, and only through a state the server signed.
const memberConnect = await colleague.evaluate(async (ws) => (await fetch(`/api/drive/connect?ws=${ws}`, { redirect: "manual" })).status, alphaId);
check("a member can't start connecting Drive", memberConnect === 403, String(memberConnect));
await wide.goto(`${APP}/api/drive/callback?code=fake-code&state=forged.state`);
check("a forged callback connects nothing", driveRows() === "0", driveRows());

await wide.goto(settingsUrl);
await wide.getByRole("link", { name: "Підключити Google Drive" }).click();
await wide.waitForURL(/tab=data&drive=connected/);
check("owner connects Google Drive", (await wide.getByText("Google Drive підключено.").count()) > 0 && driveRows() === "1");
const storedToken = sql(`select token_encrypted from public.drive_connections where workspace_id = '${alphaId}' and active`);
check("Drive access stored encrypted", storedToken.startsWith("v1.") && !storedToken.includes("fake-refresh-token"));
const tokenLeak = await colleagueClient.from("drive_connections").select("token_encrypted");
check("Drive access not readable through the API", Boolean(tokenLeak.error) || (tokenLeak.data ?? []).length === 0, JSON.stringify(tokenLeak.data ?? tokenLeak.error).slice(0, 120));

// Existing files move to Drive and free their Supabase space.
const supabaseFiles = () => sql(`select count(*) from public.attachments where workspace_id = '${alphaId}' and storage_backend = 'supabase'`);
const before = Number(supabaseFiles());
check("there are files to move", before > 0, String(before));
await wide.getByRole("button", { name: "Перенести всі файли сюди" }).click();
await wide.getByText(/Готово: перенесено/).waitFor({ timeout: 60000 });
check("all files moved to Drive", supabaseFiles() === "0", supabaseFiles());
check("moved files are on the Drive", fakeFiles().length >= before, String(fakeFiles().length));
const leftInStorage = sql(`select count(*) from storage.objects where bucket_id = 'attachments' and name like '${alphaId}/%'`);
check("Supabase copies removed after the move", leftInStorage === "0", leftInStorage);

// Shown from Drive, only to people who can open the page.
await alice.goto(`${APP}/w/${alphaShort}/p/${imagePage}`);
await alice.waitForSelector(".bn-editor img.bn-visual-media");
await alice.waitForFunction(() => document.querySelector(".bn-editor img.bn-visual-media")?.naturalWidth > 0, null, { timeout: 15000 });
check("image now served from Drive", true);
const drivePath = sql(`select storage_path from public.attachments where page_id = '${imagePage}' limit 1`);
// Straight from the server (no browser cache), with alice's session cookies.
const cookieHeader = aliceCookies.map((c) => `${c.name}=${c.value}`).join("; ");
const direct = await fetch(`${APP}/api/files/${drivePath}`, { headers: { cookie: cookieHeader }, cache: "no-store" });
const ownStatus = `${direct.status} ${direct.headers.get("content-type")} ${direct.headers.get("x-content-type-options")}`;
check("Drive file served as an image only", direct.status === 200 && direct.headers.get("content-type") === "image/webp" && /nosniff/.test(direct.headers.get("x-content-type-options") ?? ""), `${ownStatus} | ${[...direct.headers.keys()].join(",")}`);
const strangerFile = await colleague.evaluate(async (p) => (await fetch(`/api/files/${p}`)).status, drivePath);
check("someone without access to the page gets no file", strangerFile === 404, String(strangerFile));
const bobFile = await bob.evaluate(async (p) => (await fetch(`/api/files/${p}`)).status, drivePath);
check("another workspace gets no file", bobFile === 404 || bobFile === 307 || bobFile === 302, String(bobFile));

// New uploads go straight to Drive; the bytes must match what was registered.
const webp = Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=", "base64");
const reg = (await aliceClient.rpc("register_attachment", { target_page: imagePage, file_type: "image/webp", file_bytes: webp.length, file_width: 1, file_height: 1 })).data;
check("new uploads are registered for Drive", reg?.backend === "drive", JSON.stringify(reg));
const upload = (bytes) => wide.evaluate(async ([p, b]) => (await fetch(`/api/files/upload?path=${encodeURIComponent(p)}`, { method: "POST", body: new Uint8Array(b) })).status, [reg.path, [...bytes]]);
const fakePng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(webp.length - 4)]);
check("upload with the wrong kind of file refused", (await upload(fakePng)) === 400);
check("upload of the registered image accepted", (await upload(webp)) === 200);
check("new file stored on Drive", sql(`select storage_backend from public.attachments where storage_path = '${reg.path}'`) === "drive");
const colleagueUpload = await colleague.evaluate(async (p) => (await fetch(`/api/files/upload?path=${encodeURIComponent(p)}`, { method: "POST", body: new Uint8Array([1, 2, 3]) })).status, reg.path);
check("someone else can't upload into a registered path", colleagueUpload === 403, String(colleagueUpload));

// Page backups.
await wide.goto(settingsUrl);
await wide.getByRole("button", { name: "Зробити копію зараз" }).click();
await wide.getByText(/Скопійовано/).waitFor({ timeout: 60000 });
const backups = sql(`select count(*) from public.page_backups b join public.pages p on p.id = b.page_id where p.workspace_id = '${alphaId}'`);
check("pages backed up to Drive", Number(backups) > 0, backups);
const backupJson = fakeFiles().map((f) => readFake(`${fakeDir}/${f}`, "utf8")).find((text) => text.includes('"title": "Alpha secret"'));
check("backup holds the exact page content", Boolean(backupJson));
const snapshot = fakeFiles().map((f) => readFake(`${fakeDir}/${f}`, "utf8")).find((text) => text.includes("edgeknow-workspace-snapshot/1"));
check("workspace data snapshot saved to Drive", Boolean(snapshot) && snapshot.includes('"page_access"') && snapshot.includes('"comments"'));
check("snapshot holds no secrets", Boolean(snapshot) && !snapshot.includes("token_encrypted") && !snapshot.includes("fake-refresh-token") && !snapshot.includes("token_hash"));
const cronNoKey = await fetch(`${APP}/api/cron/backup-pages`);
check("backup job needs its secret", cronNoKey.status === 401, String(cronNoKey.status));
const cronRun = await fetch(`${APP}/api/cron/backup-pages`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
check("daily backup job runs", cronRun.status === 200, String(cronRun.status));

// Connecting another Drive: the old one stays until its files are moved.
await wide.getByRole("link", { name: "Підключити інший Google Drive" }).click();
await wide.waitForURL(/drive=connected/);
const conns = sql(`select count(*) filter (where active) || '/' || count(*) from public.drive_connections where workspace_id = '${alphaId}'`);
check("new Drive active, old one kept", conns === "1/2", conns);
await wide.getByRole("button", { name: "Перенести всі файли сюди" }).click();
await wide.getByText(/Готово: перенесено/).waitFor({ timeout: 60000 });
const onOld = sql(`select count(*) from public.attachments a join public.drive_connections c on c.id = a.drive_connection_id where a.workspace_id = '${alphaId}' and not c.active`);
check("files moved to the new Drive", onOld === "0", onOld);

// --- Help page --------------------------------------------------------------------------

const anonHelp = await fetch(`${APP}/help`);
check("help is open without signing in", anonHelp.status === 200 && (await anonHelp.text()).includes("Довідка"), String(anonHelp.status));
await alice.goto(`${APP}/w/${alphaShort}`);
await alice.locator("aside").getByRole("link", { name: /Довідка/ }).click();
await alice.waitForURL(/\/help$/);
check("help linked from the sidebar, with every section", (await alice.locator("main section").count()) >= 14);

// --- Sidebar: one row of icons at the bottom, width set by dragging -----------------------
{
  await alice.goto(`${APP}/w/${alphaShort}`);
  const bottom = alice.locator("aside [data-sidebar-bottom] > div").first();
  const icons = await bottom.locator("a, button").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  check("the bottom links are one row of icons", icons.length >= 5 && new Set(icons).size === 1, JSON.stringify(icons));
  const aside = alice.locator("aside[data-sidebar-width]");
  const handle = alice.locator("[data-sidebar-resize]");
  const before = (await aside.boundingBox()).width;
  const grip = await handle.boundingBox();
  await alice.mouse.move(grip.x + grip.width / 2, grip.y + 200);
  await alice.mouse.down();
  await alice.mouse.move(grip.x + 120, grip.y + 200, { steps: 6 });
  await alice.mouse.up();
  const after = (await aside.boundingBox()).width;
  await alice.reload();
  const kept = (await alice.locator("aside[data-sidebar-width]").boundingBox()).width;
  check("the sidebar gets wider by dragging its edge and stays so", after > before + 100 && Math.abs(kept - after) < 2, `${before} → ${after} → ${kept}`);
  await alice.locator("[data-sidebar-resize]").dblclick();
  check("a double click brings the usual width back", Math.abs((await alice.locator("aside[data-sidebar-width]").boundingBox()).width - 256) < 2);
}

// --- Page counter and profile statistics -------------------------------------------------

await alice.goto(`${APP}/w/${alphaShort}/p/${alphaPage}`);
await alice.waitForSelector(".bn-editor");
const counter = alice.getByRole("button", { name: /📊/ });
await counter.waitFor();
// "📊 1 234 слова · 6 хв" → 1234 (thousands are separated by a space).
const parseWords = (text) => Number((text.match(/📊\s*([\d\s\u00a0\u202f]*\d)/)?.[1] ?? "0").replace(/\D/g, ""));
const wordsOf = async () => parseWords(await counter.innerText());
const wordsBefore = await wordsOf();
check("page counter shows words", /📊\s*[\d\s\u00a0\u202f]+ сл(ово|ова|ів)/.test(await counter.innerText()), await counter.innerText());
await counter.click();
check("counter details list characters and paragraphs", (await alice.getByText("Символів без пробілів").count()) === 1 && (await alice.getByText("Абзаців").count()) === 1);
await alice.keyboard.press("Escape");
const lastBlock = alice.locator(".bn-editor .bn-block-content").last();
const box = await lastBlock.boundingBox();
await alice.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
await alice.keyboard.press("Enter");
await alice.keyboard.type("лічильник рахує нові слова");
await alice.waitForFunction(
  (before) => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("📊"));
    const words = Number((button?.textContent.match(/📊\s*([\d\s\u00a0\u202f]*\d)/)?.[1] ?? "0").replace(/\D/g, ""));
    return words >= before + 4;
  },
  wordsBefore,
  { timeout: 10000 },
);
check("counter follows typing", (await wordsOf()) >= wordsBefore + 4, `${wordsBefore} → ${await wordsOf()}`);
await alice.getByText("Збережено").first().waitFor({ timeout: 15000 }).catch(() => {});

await alice.locator("aside").getByRole("link", { name: /Мій профіль/ }).click();
await alice.waitForURL(new RegExp(`/w/${alphaShort}/profile$`));
const aliceId = sql("select id from public.profiles where email = 'alice@alpha.test'");
const written = sql(`select coalesce(sum(chars_added), 0) from public.page_contributions where user_id = '${aliceId}'`);
check("characters written are counted", Number(written) > 0, written);
check("own profile shows statistics, private by default",
  (await alice.getByText("Символів написано").count()) === 1 && (await alice.getByRole("radio", { name: /Тільки я/ }).isChecked()));

const { cookies: peerCookies } = await sessionCookies("colleague@alpha.test");
const peer = await newPage(peerCookies);
await peer.goto(`${APP}/w/${alphaShort}/profile/${aliceId}`);
check("a private profile is hidden from colleagues", (await peer.getByText("Профіль недоступний").count()) === 1);
await alice.getByRole("radio", { name: /Усі учасники workspace/ }).check();
await alice.getByText("Посилання на профіль:").waitFor();
await alice.waitForFunction(() => !document.querySelector("input[name=profile-visibility]:disabled"));
const shown = sql(`select profile_visibility from public.workspace_members m join public.workspaces w on w.id = m.workspace_id where w.name = 'Alpha' and m.user_id = '${aliceId}'`);
check("profile shown to the workspace", shown === "workspace", shown);
await peer.goto(`${APP}/w/${alphaShort}/profile/${aliceId}`);
check("colleague sees a shown profile", (await peer.getByText("Символів написано").count()) === 1);
await bob.goto(`${APP}/w/${alphaShort}/profile/${aliceId}`).catch(() => {});
check("outsider never sees the profile", (await bob.getByText("Символів написано").count()) === 0);
await alice.getByRole("radio", { name: /Тільки я/ }).check();
await alice.waitForFunction(() => !document.querySelector("input[name=profile-visibility]:disabled"));

// --- Sign-in for team databases (path C) --------------------------------------------------

const discovery = await fetch(`${APP}/oidc/.well-known/openid-configuration`);
const discoveryJson = await discovery.json().catch(() => ({}));
check("OIDC discovery is public", discovery.status === 200 && discoveryJson.issuer === `${APP}/oidc` && discoveryJson.jwks_uri === `${APP}/oidc/jwks`, `${discovery.status} ${JSON.stringify(discoveryJson).slice(0, 160)}`);
const jwksText = await (await fetch(`${APP}/oidc/jwks`)).text();
check("JWKS publishes only public keys", jwksText.includes('"kty":"EC"') && !jwksText.includes('"d"'), jwksText.slice(0, 160));
const anonToken = await fetch(`${APP}/api/oidc/token`, { method: "POST", body: "{}", redirect: "manual" });
check("no token without signing in", anonToken.status >= 300 && anonToken.status !== 200, String(anonToken.status));
const tokenFor = (workspace) =>
  fetch(`${APP}/api/oidc/token`, { method: "POST", headers: { cookie: cookieHeader, "content-type": "application/json" }, body: JSON.stringify(workspace ? { workspace } : {}) });
const minted = await tokenFor(alphaId);
const { token: teamToken } = await minted.json().catch(() => ({}));
const { createRemoteJWKSet, jwtVerify } = await import("jose");
const verified = teamToken
  ? await jwtVerify(teamToken, createRemoteJWKSet(new URL(`${APP}/oidc/jwks`)), { issuer: `${APP}/oidc`, audience: "authenticated" }).catch((e) => ({ error: e.message }))
  : { error: "no token" };
const aliceUserId = sql("select id from public.profiles where email = 'alice@alpha.test'");
check(
  "a member gets a short-lived token for their team database",
  minted.status === 200 && verified.payload?.sub === aliceUserId && verified.payload?.role === "authenticated" && verified.payload?.ek_workspace === alphaId && verified.payload.exp - verified.payload.iat <= 600,
  `${minted.status} ${verified.error ?? JSON.stringify(verified.payload ?? {}).slice(0, 200)}`,
);
const unbound = await tokenFor(null);
check("no token without a workspace (a token works only in its workspace's database)", unbound.status === 400, String(unbound.status));
const foreign = await tokenFor(betaId);
check("no token for someone else's workspace", foreign.status === 403, String(foreign.status));


// --- Confirmations of reading: a frozen page people sign; the owner sees who did ------------
{
  const policy = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Safety policy" })).data.id;
  await aliceClient.rpc("save_page_content", { target_page: policy, new_content: [{ type: "paragraph", content: "Wear a helmet." }], base_version: 1 });
  await aliceClient.rpc("set_page_workspace_role", { target_page: policy, new_role: "viewer" });
  await alice.goto(`${APP}/w/${alphaShort}/p/${policy}`);
  await alice.locator("[data-ack-manage]").click();
  await alice.locator('[data-ack-label="accept"]').check();
  await alice.locator("[data-ack-turn-on]").click();
  await alice.locator("[data-ack-badge]").waitFor({ timeout: 20000 }).catch(() => {});
  const state = sql(`select ack_label || ' ' || ack_revision || ' ' || ack_editing from public.pages where id = '${policy}'`);
  check("an owner asks readers to confirm a page, and it is frozen", state === "accept 1 false" && (await alice.locator("[data-ack-frozen]").count()) === 1, state);
  check("…marked in the page tree", (await alice.locator("[data-tree-ack]").count()) >= 1);
  const frozenSave = await aliceClient.rpc("save_page_content", { target_page: policy, new_content: [], base_version: 2, force: true });
  check("…and the database refuses edits", Boolean(frozenSave.error) && pageContent(policy)?.[0]?.content === "Wear a helmet.", JSON.stringify(frozenSave.error ?? frozenSave.data));
  await colleague.goto(`${APP}/w/${alphaShort}/p/${policy}`);
  await colleague.locator("[data-ack-sign]").click();
  await colleague.locator("[data-ack-signed]").waitFor({ timeout: 15000 }).catch(() => {});
  const signed = sql(`select count(*) || ' ' || min(label) from public.page_acks where page_id = '${policy}' and user_id = '${colleagueId}'`);
  check("a reader confirms it with one button", signed === "1 accept" && (await colleague.locator("[data-ack-signed]").count()) === 1, signed);
  const colleagueEmail = sql(`select email from public.profiles where id = '${colleagueId}'`);
  await alice.reload();
  await alice.locator("[data-ack-manage]").click();
  await alice.locator("[data-ack-signed-list]").waitFor({ timeout: 15000 }).catch(() => {});
  check("…and the owner sees who confirmed and when", (await alice.locator(`[data-ack-person="${colleagueEmail}"]`).count()) === 1);
  await alice.keyboard.press("Escape");
}

// --- Drafts: a new page is seen only by its people until it is published ----------------
{
  sql("alter table public.pages alter column published_at drop default");
  const draft = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Draft roadmap" })).data.id;
  await aliceClient.rpc("set_page_workspace_role", { target_page: draft, new_role: "editor" });
  const host = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Draft host" })).data.id;
  await aliceClient.rpc("publish_page", { target_page: host, with_children: false });
  await aliceClient.rpc("set_page_workspace_role", { target_page: host, new_role: "viewer" });
  await aliceClient.rpc("save_page_content", { target_page: host, new_content: [{ type: "paragraph", content: [{ type: "pageChip", props: { pageId: draft } }] }], base_version: 1 });
  check("a new page is a draft", sql(`select published_at is null from public.pages where id = '${draft}'`) === "t");
  const seen = await colleagueClient.from("pages").select("id, title").eq("id", draft);
  check("…a colleague with whole-workspace access can't read it", (seen.data ?? []).length === 0, JSON.stringify(seen.data));
  const found = await colleagueClient.rpc("search_pages", { ws: alphaId, query: "roadmap" });
  check("…nor find it", (found.data ?? []).length === 0, JSON.stringify(found.data));
  const publishByReader = await colleagueClient.rpc("publish_page", { target_page: draft, with_children: true });
  check("…nor publish it", publishByReader.data?.error === "forbidden", JSON.stringify(publishByReader.data));
  await colleague.goto(`${APP}/w/${alphaShort}/p/${host}`);
  await colleague.locator(".bn-editor").waitFor({ timeout: 20000 }).catch(() => {});
  const hostHtml = await colleague.content();
  check("…a chip to it on a published page says only “no access”, never its name", !hostHtml.includes("Draft roadmap") && (await colleague.getByText("Немає доступу").count()) >= 1);
  check("…and it is not in the colleague's page tree", (await colleague.locator("aside").getByText("Draft roadmap").count()) === 0);
  await colleague.goto(`${APP}/w/${alphaShort}/p/${draft}`);
  check("…its link opens nothing", !(await colleague.content()).includes("Draft roadmap"));
  await alice.goto(`${APP}/w/${alphaShort}/p/${draft}`);
  await alice.locator('[data-draft-bar="own"]').waitFor({ timeout: 20000 }).catch(() => {});
  check("the author sees “Draft” on the page and in the tree", (await alice.locator('[data-draft-bar="own"]').count()) === 1 && (await alice.locator("[data-tree-draft]").count()) >= 1);
  await alice.locator("[data-publish-page]").click();
  const published = await until(() => sql(`select published_at is not null from public.pages where id = '${draft}'`) === "t", 15000);
  check("…publishes it with one button", published);
  const seenAfter = await colleagueClient.from("pages").select("id, title").eq("id", draft);
  check("…and then the colleague sees it", (seenAfter.data ?? []).length === 1, JSON.stringify(seenAfter.data));
  sql("alter table public.pages alter column published_at set default now()");
}

// --- Page history: versions by session, restore puts an older text back ---------------------
{
  const notes = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "History notes" })).data.id;
  const para = (text) => [{ id: "h1", type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] }];
  await aliceClient.rpc("save_page_content", { target_page: notes, new_content: para("Version one"), base_version: 1 });
  sql(`update public.page_versions set last_at = last_at - interval '11 minutes', created_at = created_at - interval '11 minutes' where page_id = '${notes}'`);
  await aliceClient.rpc("save_page_content", { target_page: notes, new_content: para("Version two"), base_version: 2 });
  check("a pause between saves makes a new version", Number(sql(`select count(*) from public.page_versions where page_id = '${notes}'`)) >= 2);
  const readerVersions = await colleagueClient.from("page_versions").select("id").eq("page_id", notes);
  check("…readers of the page don't see its versions", (readerVersions.data ?? []).length === 0, JSON.stringify(readerVersions.data));
  await alice.goto(`${APP}/w/${alphaShort}/p/${notes}`);
  await alice.locator("[data-page-history]").click();
  await alice.locator("[data-version-item]").first().waitFor({ timeout: 15000 }).catch(() => {});
  check("the author opens the history", (await alice.locator("[data-version-item]").count()) >= 2);
  const older = alice.locator("[data-version-item]").filter({ hasText: /./ }).nth(1);
  await older.click();
  await alice.locator('[data-version-mark="changed"]').waitFor({ timeout: 15000 }).catch(() => {});
  check("…sees an older version with what differs marked", (await alice.locator('[data-version-mark="changed"]').count()) >= 1);
  await alice.locator("[data-restore-version]").click();
  const restored = await until(() => sql(`select content #>> '{0,content,0,text}' from public.pages where id = '${notes}'`) === "Version one", 15000);
  check("…and restores it", restored && sql(`select reason from public.page_versions where page_id = '${notes}' order by created_at desc limit 1`) === "restore");
}

await finish("wiki");
