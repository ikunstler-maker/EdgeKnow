// Browser smoke test, part 3: team-owned databases (path C) — Team Delta in its
// own stack, "my data", health, moving Team Echo in and back — and rate limits.
// Usage: node scripts/e2e/team.mjs status.json http://localhost:3000

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  ANON, API, APP, alice, aliceClient, aliceCookies, alphaId, alphaPage, alphaShort, betaId, bob, bobCookies, browser, check, colleague,
  colleagueClient, colleagueCookies, colleagueId, fakeDir, finish, makeTestPng, newPage, pageContent, pageVersion, problems, readdirSync,
  results, sessionCookies, setLastPage, sql, status, until,
  newTask,
} from "./common.mjs";

sql("update public.profiles set is_platform_admin = true where email = 'alice@alpha.test'");
const pngBuffer = await makeTestPng(alice);

// --- A workspace whose data lives in the team's own database (path C) ------------------------

const gammaShort = sql("select short_id from public.workspaces where name = 'Team Delta'");
const teamStatus = JSON.parse(readFileSync(".team-stacks/team-b/status.json", "utf8"));
const teamSql = (query) => execFileSync("psql", [teamStatus.DB_URL, "-Atc", query], { encoding: "utf8" }).trim();
// As in common.mjs: pages made here are published at once (drafts are checked in wiki.mjs and team9k_page_drafts).
teamSql("alter table public.pages alter column published_at set default now()");
const gammaTab = await newPage(aliceCookies);
await gammaTab.goto(`${APP}/w/${gammaShort}`);
await gammaTab.getByRole("button", { name: "Нова сторінка" }).first().click();
await gammaTab.waitForURL(new RegExp(`/w/${gammaShort}/p/[0-9a-f-]{36}(\\?new=1)?$`));
const gammaPage = gammaTab.url().split("/p/")[1].split("?")[0];
await gammaTab.waitForFunction(() => document.querySelector("textarea")?.value === "");
await gammaTab.locator("textarea").fill("Team-owned page");
await gammaTab.locator("textarea").blur();
await gammaTab.waitForTimeout(1500);
await gammaTab.locator(".bn-editor").click();
await gammaTab.keyboard.type("Stored in the team database");
await gammaTab.waitForFunction(() => document.body.innerText.includes("Збережено"), null, { timeout: 15000 });
await gammaTab.reload();
await gammaTab.waitForSelector(".bn-editor");
check(
  "a team workspace's page survives a reload",
  (await gammaTab.locator("textarea").inputValue()) === "Team-owned page" && (await gammaTab.getByText("Stored in the team database").count()) > 0,
);
const inTeam = teamSql(`select title || ' | ' || search_text from public.pages where id = '${gammaPage}'`);
check("the page is stored in the team database", inTeam.startsWith("Team-owned page |") && inTeam.includes("Stored in the team database"), inTeam);
const inCentral = sql(`select count(*) from public.pages where id = '${gammaPage}'`);
check("…and not in the central one", inCentral === "0", inCentral);
const teamMembers = teamSql("select string_agg(p.email || ' ' || m.role, ', ') from public.workspace_members m join public.profiles p on p.id = m.user_id where m.status = 'active'");
check("the team database got the members from the central service", teamMembers === "alice@alpha.test owner", teamMembers);
await gammaTab.keyboard.press("Control+k");
await gammaTab.getByLabel("Шукати в назвах і тексті сторінок…").fill("team database");
const gammaResults = gammaTab.getByRole("list", { name: "Результати пошуку" });
await gammaResults.waitFor({ timeout: 10000 });
check("search finds it in the team database", (await gammaResults.getByText("Team-owned page").count()) > 0);
await gammaTab.keyboard.press("Escape");
// Images of a team workspace go to the team's own storage and are read from there.
await gammaTab.goto(`${APP}/w/${gammaShort}/p/${gammaPage}`);
await gammaTab.waitForSelector(".bn-editor");
await gammaTab.locator(".bn-editor").click();
await gammaTab.keyboard.press("Control+End");
await gammaTab.keyboard.press("Enter");
await gammaTab.keyboard.type("/зображення");
await gammaTab.getByRole("option", { name: /Зображення/ }).first().waitFor();
await gammaTab.keyboard.press("Enter");
await gammaTab.locator(".bn-panel input[type=file]").setInputFiles({ name: "team.png", mimeType: "image/png", buffer: pngBuffer });
const teamImage = gammaTab.locator(".bn-editor img.bn-visual-media[src^='/api/files/']").first();
await teamImage.waitFor({ timeout: 60000 });
await gammaTab.waitForFunction(() => document.body.innerText.includes("Збережено"), null, { timeout: 15000 });
const teamFile = teamSql(`select a.storage_path || '|' || (select count(*) from storage.objects o where o.bucket_id = 'attachments' and o.name = a.storage_path) from public.attachments a where a.page_id = '${gammaPage}'`).split("|");
check("an image of a team workspace lands in the team's own storage", teamFile[1] === "1", teamFile.join(" "));
check("…and not in the central database or storage", sql(`select count(*) from public.attachments where page_id = '${gammaPage}'`) === "0" && sql(`select count(*) from storage.objects where name like '${sql("select id from public.workspaces where name = 'Team Delta'")}/%'`) === "0");
check("the team image is shown", (await teamImage.evaluate((img) => img.naturalWidth)) > 0);
const teamSchema = sql("select coalesce(schema_version, '-') from public.team_databases t join public.workspaces w on w.id = t.workspace_id where w.name = 'Team Delta'");
const latestTeamSchema = readdirSync("supabase/team/migrations").filter((f) => f.endsWith(".sql")).sort().at(-1).replace(/\.sql$/, "");
check("the team database was brought to the current schema", teamSchema === latestTeamSchema, `${teamSchema} vs ${latestTeamSchema}`);

// Google Drive for a team workspace: files and daily copies go there, records stay in the team database.
await gammaTab.goto(`${APP}/w/${gammaShort}/settings?tab=storage`);
check("the storage tab explains where a team workspace keeps its files", (await gammaTab.getByText(/сховищі вашого власного Supabase/).count()) === 1);
await gammaTab.getByRole("link", { name: "Підключити Google Drive" }).click();
await gammaTab.waitForURL(/tab=data&drive=connected/);
await gammaTab.goto(`${APP}/w/${gammaShort}/p/${gammaPage}`);
await gammaTab.waitForSelector(".bn-editor");
await gammaTab.locator(".bn-editor").click();
await gammaTab.keyboard.press("Control+End");
await gammaTab.keyboard.press("Enter");
await gammaTab.keyboard.type("/зображення");
await gammaTab.getByRole("option", { name: /Зображення/ }).first().waitFor();
await gammaTab.keyboard.press("Enter");
await gammaTab.locator(".bn-panel input[type=file]").setInputFiles({ name: "drive.png", mimeType: "image/png", buffer: pngBuffer });
await gammaTab.waitForFunction(() => document.querySelectorAll(".bn-editor img.bn-visual-media[src^='/api/files/']").length >= 2, null, { timeout: 60000 });
await gammaTab.waitForFunction(() => document.body.innerText.includes("Збережено"), null, { timeout: 15000 });
const onDrive = teamSql(`select count(*) from public.attachments where page_id = '${gammaPage}' and storage_backend = 'drive' and drive_file_id is not null`);
check("with a Drive, a team workspace's new image goes to the Drive", onDrive === "1", onDrive);
const driveImage = gammaTab.locator(".bn-editor img.bn-visual-media[src^='/api/files/']").nth(1);
await gammaTab.waitForFunction((el) => el.complete && el.naturalWidth > 0, await driveImage.elementHandle(), { timeout: 15000 }).catch(() => {});
check("…and is shown from the Drive", (await driveImage.evaluate((img) => img.naturalWidth)) > 0);
await gammaTab.goto(`${APP}/w/${gammaShort}/settings?tab=storage`);
await gammaTab.getByRole("button", { name: "Зробити копію зараз" }).click();
await gammaTab.getByText(/Скопійовано/).waitFor({ timeout: 60000 });
const teamBackups = teamSql(`select count(*) from public.page_backups where page_id = '${gammaPage}'`);
check("a team workspace's pages are backed up to its Drive", teamBackups === "1", teamBackups);
check("…recorded in the team database, not centrally", sql(`select count(*) from public.page_backups where page_id = '${gammaPage}'`) === "0");
const cleanupRun = await fetch(`${APP}/api/cron/cleanup-files`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
check("the cleanup job also visits team databases", cleanupRun.status === 200, String(cleanupRun.status));
const teamFileForBob = await fetch(`${APP}/api/files/${teamFile[0]}`, { headers: { cookie: bobCookies.map((c) => `${c.name}=${c.value}`).join("; ") }, redirect: "manual" });
check("a non-member gets no team file", teamFileForBob.status === 404 || teamFileForBob.status === 307, String(teamFileForBob.status));

// Settings → Database: the connected project, and the wizard where nothing is connected.
await gammaTab.goto(`${APP}/w/${gammaShort}/settings?tab=team`);
check("the database tab shows the team's project", (await gammaTab.getByText("Дані зберігаються у вашому Supabase").count()) === 1 && (await gammaTab.getByText(teamStatus.API_URL).count()) === 1);
await gammaTab.goto(`${APP}/w/${alphaShort}/settings?tab=team`);
check("without the Supabase app the wizard explains it isn't available", (await gammaTab.getByText("Підключення поки недоступне").count()) > 0);
const setupAsGuest = await fetch(`${APP}/api/supabase/setup`, {
  method: "POST",
  headers: { cookie: bobCookies.map((c) => `${c.name}=${c.value}`).join("; "), "content-type": "application/json" },
  body: JSON.stringify({ ws: sql("select id from public.workspaces where name = 'Team Delta'"), action: "advance" }),
});
check("only the owner may drive the setup", setupAsGuest.status === 403, String(setupAsGuest.status));

// Tasks of a team workspace live in its own database.
await gammaTab.goto(`${APP}/w/${gammaShort}/tasks`);
await gammaTab.getByRole("form", { name: "Новий проєкт" }).getByLabel("Назва проєкту").fill("Delta tasks");
await gammaTab.getByRole("form", { name: "Новий проєкт" }).getByRole("button", { name: "Створити" }).click();
await gammaTab.waitForURL(/\/tasks\/DT$/, { timeout: 15000 });
await gammaTab.goto(`${APP}/w/${gammaShort}/tasks/DT?view=list`);
await newTask(gammaTab, "Team-owned task");
await gammaTab.locator('[data-task="DT-1"]').waitFor({ timeout: 15000 });
check("a team workspace's tasks are in its own database, not centrally", teamSql("select count(*) from public.tasks where title = 'Team-owned task'") === "1" && sql("select count(*) from public.tasks where title = 'Team-owned task'") === "0");

// --- Step 1.8: after all of the above, the central database holds nothing of Team Delta's content ---
{
  const ws = sql("select id from public.workspaces where name = 'Team Delta'");
  const tables = ["pages", "page_access", "comment_threads", "comments", "attachments", "page_mentions", "page_contributions", "task_projects", "tasks", "task_links", "task_page_links", "task_files", "task_comments", "task_events"];
  const teamPages = teamSql(`select coalesce(string_agg(quote_literal(id::text), ','), 'null') from public.pages where workspace_id = '${ws}'`);
  const central = [
    ...tables.map((table) => `${table}=${sql(`select count(*) from public.${table} where workspace_id = '${ws}'`)}`),
    `page_backups=${sql(`select count(*) from public.page_backups where page_id::text in (${teamPages})`)}`,
  ];
  check("the central database has no pages, comments, access or files of a team workspace", central.every((c) => c.endsWith("=0")), central.join(" "));
  check("…and no file of it in the central storage", sql(`select count(*) from storage.objects where name like '${ws}/%'`) === "0");
  const words = ["Team-owned page", "Stored in the team database"];
  const leaked = words.filter((w) => sql(`select count(*) from public.pages where title ilike '%${w}%' or content::text ilike '%${w}%'`) !== "0" || sql(`select count(*) from public.audit_log where details::text ilike '%${w}%'`) !== "0");
  check("…and its page text appears nowhere in the central pages or log", !leaked.length, leaked.join(", "));
  check("…while the team database has them", teamSql(`select count(*) from public.pages where workspace_id = '${ws}'`) !== "0");
}

// --- My data: download it, and delete the account ---------------------------------------------
{
  const signup = await fetch(`${API}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: "leaver@alpha.test", password: "Test-password-1!" }),
  });
  const { cookies: leaverCookies, client: leaverClient } = await sessionCookies("leaver@alpha.test");
  await leaverClient.rpc("join_workspaces");
  const leaverId = sql("select id from public.profiles where email = 'leaver@alpha.test'");
  const deltaWs = sql("select id from public.workspaces where name = 'Team Delta'");
  sql(`insert into public.workspace_members (workspace_id, user_id, role, joined_via) values ('${deltaWs}', '${leaverId}', 'member', 'invite')`);
  const leaverPage = (await leaverClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Leaver notes" })).data.id;
  await leaverClient.rpc("create_comment_thread", { target_page: leaverPage, quoted: "x", body: "Leaver was here", mention_ids: [] });
  const leaver = await newPage(leaverCookies);
  await leaver.goto(`${APP}/w/${gammaShort}`);
  await leaver.getByRole("button", { name: "Нова сторінка" }).first().click();
  await leaver.waitForURL(new RegExp(`/w/${gammaShort}/p/[0-9a-f-]{36}(\\?new=1)?$`));
  const leaverTeamPage = leaver.url().split("/p/")[1].split("?")[0];
  // The page opens while the database makes it: wait for it to be on screen.
  await leaver.waitForSelector("textarea");
  check("(setup) someone with pages centrally and in a team database", signup.ok && Boolean(leaverPage) && teamSql(`select owner_id from public.pages where id = '${leaverTeamPage}'`) === leaverId, `${signup.status}`);
  const cookie = leaverCookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const exported = await fetch(`${APP}/api/me/export`, { headers: { cookie } });
  const file = await exported.json().catch(() => ({}));
  const titles = (file.workspaces ?? []).flatMap((w) => w.pages.map((p) => p.title));
  check("“download my data” gives a file with their pages and comments, from both databases", exported.ok && file.profile?.email === "leaver@alpha.test" && titles.includes("Leaver notes") && titles.includes("") && file.workspaces.some((w) => w.comments.some((c) => c.body === "Leaver was here")), JSON.stringify(titles));
  const wrong = await fetch(`${APP}/api/me/delete`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ confirm: "someone@else.test" }) });
  check("deleting needs one's own email typed", wrong.status === 400 && sql(`select count(*) from public.profiles where id = '${leaverId}'`) === "1");
  await leaver.goto(`${APP}/w/${alphaShort}/profile`);
  await leaver.getByRole("button", { name: "Видалити мій акаунт…" }).click();
  await leaver.getByLabel(/Щоб підтвердити, введіть свою пошту/).fill("leaver@alpha.test");
  await leaver.getByRole("button", { name: "Видалити назавжди" }).click();
  await leaver.waitForURL(/\/login/, { timeout: 20000 }).catch(() => {});
  check("the account is deleted", sql(`select count(*) from auth.users where id = '${leaverId}'`) === "0" && sql(`select count(*) from public.profiles where id = '${leaverId}'`) === "0");
  check("…its pages stay with the team, owned by the workspace owner", sql(`select p.email from public.pages g join public.profiles p on p.id = g.owner_id where g.id = '${leaverPage}'`) === "alice@alpha.test" && teamSql(`select owner_id from public.pages where id = '${leaverTeamPage}'`) === sql("select id from public.profiles where email = 'alice@alpha.test'"));
  check("…its comments stay without a name", sql("select coalesce(author_id::text, 'none') from public.comments where body = 'Leaver was here'") === "none");
  check("…and the team database forgot the person", teamSql(`select count(*) from public.profiles where id = '${leaverId}'`) === "0");
  const owner = await fetch(`${APP}/api/me/delete`, { method: "POST", headers: { cookie: aliceCookies.map((c) => `${c.name}=${c.value}`).join("; "), "content-type": "application/json" }, body: JSON.stringify({ confirm: "alice@alpha.test" }) }).then((r) => r.json());
  check("an owner of workspaces is asked to hand them over first", owner.error === "owns_workspaces" && owner.workspaces.includes("Alpha"), JSON.stringify(owner));
}

// Groups of a team workspace are copied into its database with the members.
await gammaTab.goto(`${APP}/w/${gammaShort}/settings?tab=groups`);
await gammaTab.getByLabel("Назва нової групи").fill("Delta group");
await gammaTab.getByRole("button", { name: "Створити групу" }).click();
await gammaTab.locator('[data-group="Delta group"]').waitFor({ timeout: 15000 });
check("a team workspace's group reaches its own database", teamSql("select count(*) from public.workspace_groups where name = 'Delta group'") === "1");

// --- How the team database is doing (step 1.5b) ------------------------------------------------
const deltaId = sql("select id from public.workspaces where name = 'Team Delta'");
const deltaCookie = aliceCookies.map((c) => `${c.name}=${c.value}`).join("; ");
const checkDelta = () =>
  fetch(`${APP}/api/supabase/setup`, { method: "POST", headers: { cookie: deltaCookie, "content-type": "application/json" }, body: JSON.stringify({ ws: deltaId, action: "health" }) }).then((r) => r.json());
const healthy = await checkDelta();
check("the health check finds the team database well and measures it", healthy.health === "ok" && healthy.databaseBytes > 0, JSON.stringify(healthy));
await gammaTab.goto(`${APP}/w/${gammaShort}/settings?tab=team`);
check("…and the database tab shows it", (await gammaTab.getByText("✅ База працює.").count()) === 1 && (await gammaTab.getByText(/Зайнято: база — [0-9.]+ МБ з 500 МБ/).count()) === 1);
const realKey = sql(`select secret_key_encrypted from public.team_databases where workspace_id = '${deltaId}'`);
sql(`update public.team_databases set secret_key_encrypted = '${readFileSync(".team-stacks/team-b/bogus-key.txt", "utf8").trim()}' where workspace_id = '${deltaId}'`);
const revoked = await checkDelta();
check("a key the project no longer knows is reported", revoked.health === "revoked", JSON.stringify(revoked));
await gammaTab.goto(`${APP}/w/${gammaShort}`);
check("…to the team as a banner, with the way to the settings for the owner", (await gammaTab.getByText("EdgeKnow більше не має доступу до бази даних команди").count()) === 1 && (await gammaTab.getByRole("link", { name: "Відкрити «База даних»" }).count()) === 1);
sql(`update public.team_databases set secret_key_encrypted = '${realKey}' where workspace_id = '${deltaId}'`);
const realUrl = sql(`select project_url from public.team_databases where workspace_id = '${deltaId}'`);
sql(`update public.team_databases set project_url = 'http://127.0.0.1:9' where workspace_id = '${deltaId}'`);
await gammaTab.goto(`${APP}/w/${gammaShort}`);
check("a database that doesn't answer is shown as such", (await gammaTab.getByText("База даних команди зараз не відповідає").count()) === 1 && sql(`select health from public.team_databases where workspace_id = '${deltaId}'`) === "unreachable");
sql(`update public.team_databases set project_url = '${realUrl}' where workspace_id = '${deltaId}'`);
await gammaTab.goto(`${APP}/w/${gammaShort}/p/${gammaPage}`);
check("once it answers again the banner goes and the pages are back", (await gammaTab.getByText("База даних команди зараз не відповідає").count()) === 0 && (await gammaTab.getByText("Team-owned page").count()) > 0 && sql(`select health from public.team_databases where workspace_id = '${deltaId}'`) === "ok");
const healthAsGuest = await fetch(`${APP}/api/supabase/setup`, { method: "POST", headers: { cookie: bobCookies.map((c) => `${c.name}=${c.value}`).join("; "), "content-type": "application/json" }, body: JSON.stringify({ ws: deltaId, action: "health" }) });
check("only the owner may run the check", healthAsGuest.status === 403, String(healthAsGuest.status));

// --- Moving a workspace that has pages into its team's own database (step 1.7b) ---
// "Team Echo" fills up centrally first; register.sql then connects it to the
// third stack at the "sync" step, as if the wizard had got that far.
const echoId = sql("select id from public.workspaces where name = 'Team Echo'");
const echoShort = sql(`select short_id from public.workspaces where id = '${echoId}'`);
const moveStatus = JSON.parse(readFileSync(".team-stacks/team-c/status.json", "utf8"));
const moveSql = (query) => execFileSync("psql", [moveStatus.DB_URL, "-Atc", query], { encoding: "utf8" }).trim();
const echoHandbook = (await aliceClient.rpc("create_page", { ws: echoId, parent: null, new_title: "Echo handbook" })).data.id;
const echoChapter = (await aliceClient.rpc("create_page", { ws: echoId, parent: echoHandbook, new_title: "Echo chapter" })).data.id;
await aliceClient.rpc("set_page_member_role", { target_page: echoChapter, member: colleagueId, new_role: "editor" });
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const echoFile = (await aliceClient.rpc("register_attachment", { target_page: echoChapter, file_type: "image/png", file_bytes: tinyPng.length, file_width: 1, file_height: 1 })).data;
const echoUpload = await aliceClient.storage.from("attachments").upload(echoFile.path, new Blob([tinyPng], { type: "image/png" }));
await aliceClient.rpc("save_page_content", {
  target_page: echoChapter,
  base_version: 1,
  new_content: [
    { id: "e1", type: "paragraph", props: {}, content: [{ type: "text", text: "Moved with care ", styles: {} }, { type: "personChip", props: { userId: colleagueId, label: "Colleague" } }], children: [] },
    { id: "e2", type: "image", props: { url: `/api/files/${echoFile.path}`, name: "dot.png", previewWidth: 100 }, children: [] },
  ],
});
const echoThread = (await aliceClient.rpc("create_comment_thread", { target_page: echoChapter, quoted: "Moved", body: "Is everything here?", mention_ids: [] })).data;
await aliceClient.rpc("reply_to_thread", { target_thread: echoThread.id, body: "Yes", mention_ids: [] });
const echoCounts = (where = "workspace_id") => ["pages", "page_access", "comment_threads", "comments", "attachments", "page_mentions", "page_contributions"].map((table) => `${table}=${sql(`select count(*) from public.${table} where ${where} = '${echoId}'`)}`).join(" ");
const centralBefore = echoCounts();
check("Team Echo starts with pages, access, comments, a file and a mention", !echoUpload.error && /pages=2 page_access=[1-9].*comments=2 attachments=1 page_mentions=1/.test(centralBefore), `${centralBefore} ${echoUpload.error?.message ?? ""}`);

// A board with a picture, a voting session and a vote: they go along too.
const echoAlice = "(select id from public.profiles where email = 'alice@alpha.test')";
const echoBoard = sql(`insert into public.service_objects (workspace_id, service, kind, title, owner_id, created_by) values ('${echoId}', 'boards', 'board', 'Echo board', ${echoAlice}, ${echoAlice}) returning id`).split("\n")[0];
sql(`insert into public.object_files (workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by) values ('${echoId}', '${echoBoard}', 'dot.png', 'image/png', 1, '${echoId}/objects/${echoBoard}/pending', ${echoAlice})`);
sql(`insert into public.board_sessions (object_id, workspace_id, votes_per_person, voting_open) values ('${echoBoard}', '${echoId}', 3, true)`);
sql(`insert into public.board_votes (object_id, workspace_id, element_id, user_id) values ('${echoBoard}', '${echoId}', 'note-1', ${echoAlice})`);
execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", "-f", ".team-stacks/team-c/register.sql"]);
const echoTab = await newPage(aliceCookies);
await echoTab.goto(`${APP}/w/${echoShort}/p/${echoChapter}`);
await echoTab.getByText("Moved with care").first().waitFor({ timeout: 15000 }).catch(() => {});
check("while moving, the workspace says it is view-only", (await echoTab.getByText("Workspace переноситься у власну базу команди").count()) === 1);
check("…and still shows its pages from the central database", (await echoTab.getByText("Moved with care").count()) > 0);
const aliceCookieHeader = aliceCookies.map((c) => `${c.name}=${c.value}`).join("; ");
const refusedSave = await fetch(`${APP}/api/pages/${echoChapter}/content?w=${echoShort}`, {
  method: "POST",
  headers: { cookie: aliceCookieHeader, "content-type": "application/json" },
  body: JSON.stringify({ content: [], baseVersion: Number(sql(`select version from public.pages where id = '${echoChapter}'`)) }),
});
check("…and refuses changes", refusedSave.status >= 400 && sql(`select jsonb_array_length(content) from public.pages where id = '${echoChapter}'`) === "2", String(refusedSave.status));

const setupAs = (cookie, body) =>
  fetch(`${APP}/api/supabase/setup`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ ws: echoId, ...body }) }).then((r) => r.json());
const moveSteps = [];
for (let i = 0; i < 20; i++) {
  const result = await setupAs(aliceCookieHeader, { action: "advance" });
  moveSteps.push(`${result.step}${result.error ? `!${result.error}` : ""}`);
  if (result.step === "sign_in" || result.error) break;
}
// "sign_in" needs Supabase's Management API, which CI doesn't have; the stack already trusts our key.
check("the setup copies the data and checks it", moveSteps.at(-1) === "sign_in" && moveSteps.includes("verify"), moveSteps.join(" "));
const report = JSON.parse(sql(`select coalesce(move_report, '{}')::text from public.team_databases where workspace_id = '${echoId}'`));
check("…the check found every row and page", report.ok === true && !report.mismatchedPages?.length && !report.missingFiles?.length, JSON.stringify(report));
const boardCounts = ["object_files", "board_sessions", "board_votes"].map((table) => `${table}=${moveSql(`select count(*) from public.${table} where workspace_id = '${echoId}'`)}`).join(" ");
check("…board pictures, sessions and votes are in the team database", boardCounts === "object_files=1 board_sessions=1 board_votes=1", boardCounts);
const teamCounts = ["pages", "page_access", "comment_threads", "comments", "attachments", "page_mentions", "page_contributions"].map((table) => `${table}=${moveSql(`select count(*) from public.${table} where workspace_id = '${echoId}'`)}`).join(" ");
check("the team database has the same rows", teamCounts === centralBefore, `${teamCounts} vs ${centralBefore}`);
check("…the page tree, contents and comment author", moveSql(`select parent_id from public.pages where id = '${echoChapter}'`) === echoHandbook && moveSql(`select content::text from public.pages where id = '${echoChapter}'`) === sql(`select content::text from public.pages where id = '${echoChapter}'`) && moveSql(`select count(*) from public.comments c join public.profiles p on p.id = c.author_id where c.workspace_id = '${echoId}' and p.email = 'alice@alpha.test'`) === "2");
check("…and the file in its own storage", moveSql(`select count(*) from storage.objects where bucket_id = 'attachments' and name = '${echoFile.path}'`) === "1");
check("the central copy is left as it was", echoCounts() === centralBefore, echoCounts());
const cancelLater = await setupAs(bobCookies.map((c) => `${c.name}=${c.value}`).join("; "), { action: "cancel" });
check("only the owner can cancel a move", cancelLater.ok === false && sql(`select count(*) from public.team_databases where workspace_id = '${echoId}'`) === "1");

sql(`update public.team_databases set setup_step = 'done', status = 'ok' where workspace_id = '${echoId}'`);
await echoTab.goto(`${APP}/w/${echoShort}/p/${echoChapter}`);
await echoTab.getByText("Moved with care").first().waitFor({ timeout: 15000 }).catch(() => {});
check("after the move the page opens from the team database", (await echoTab.getByText("Moved with care").count()) > 0 && (await echoTab.getByText("Workspace переноситься у власну базу команди").count()) === 0);
const movedFile = await fetch(`${APP}/api/files/${echoFile.path}`, { headers: { cookie: aliceCookieHeader } });
const movedBytes = Buffer.from(await movedFile.arrayBuffer());
check("…with its image from the team's storage", movedFile.ok && movedBytes.equals(tinyPng) && movedFile.url.startsWith(moveStatus.API_URL), `${movedFile.status} ${movedFile.url} ${movedBytes.length}`);
await echoTab.goto(`${APP}/w/${echoShort}/settings?tab=team`);
check("the database tab shows the move", (await echoTab.getByText(/Перенесено .*сторінок — 2/).count()) === 1);
const cancelDone = await setupAs(aliceCookieHeader, { action: "cancel" });
check("a finished move can't be cancelled from the wizard", cancelDone.error === "not_cancellable", JSON.stringify(cancelDone));

// --- And back to the EdgeKnow server (step 1.7c) ------------------------------------------------
// Changes made in the team database since the move must come back; a page that
// only the old central copy still has must go; a file missing centrally is copied back.
const echoNewContent = [{ id: "e3", type: "paragraph", props: {}, content: [{ type: "text", text: "Edited in the team database", styles: {} }], children: [] }];
const teamSave = await fetch(`${APP}/api/pages/${echoChapter}/content?w=${echoShort}`, {
  method: "POST",
  headers: { cookie: aliceCookieHeader, "content-type": "application/json" },
  body: JSON.stringify({ content: echoNewContent, baseVersion: Number(moveSql(`select version from public.pages where id = '${echoChapter}'`)) }),
}).then((r) => r.json());
const aliceIdForEcho = sql("select id from public.profiles where email = 'alice@alpha.test'");
const echoAppendix = moveSql(`insert into public.pages (workspace_id, owner_id, created_by, title) values ('${echoId}', '${aliceIdForEcho}', '${aliceIdForEcho}', 'Echo appendix') returning id`).split("\n")[0];
const echoStale = sql(`insert into public.pages (workspace_id, owner_id, created_by, title) values ('${echoId}', '${aliceIdForEcho}', '${aliceIdForEcho}', 'Echo stale') returning id`).split("\n")[0];
const centralSecret = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
const removedCentrally = await fetch(`${API}/storage/v1/object/attachments`, {
  method: "DELETE",
  headers: { apikey: centralSecret, Authorization: `Bearer ${centralSecret}`, "content-type": "application/json" },
  body: JSON.stringify({ prefixes: [echoFile.path] }),
});
check("(test setup) the central copy of the file is removed", removedCentrally.ok && sql(`select count(*) from storage.objects where bucket_id = 'attachments' and name = '${echoFile.path}'`) === "0", String(removedCentrally.status));
check("a change saved in the team database", teamSave.ok === true && moveSql(`select content::text like '%Edited in the team database%' from public.pages where id = '${echoChapter}'`) === "t", JSON.stringify(teamSave));

const startReturn = await setupAs(aliceCookieHeader, { action: "return" });
check("the owner starts moving back", startReturn.ok === true && sql(`select return_step from public.team_databases where workspace_id = '${echoId}'`) === "copy", JSON.stringify(startReturn));
await echoTab.goto(`${APP}/w/${echoShort}/p/${echoChapter}`);
await echoTab.getByText("Edited in the team database").first().waitFor({ timeout: 15000 }).catch(() => {});
check("while moving back, the workspace is view-only and shows the team's data", (await echoTab.getByText("Workspace повертається на сервер EdgeKnow").count()) === 1 && (await echoTab.getByText("Edited in the team database").count()) > 0);
const refusedBack = await fetch(`${APP}/api/pages/${echoChapter}/content?w=${echoShort}`, {
  method: "POST",
  headers: { cookie: aliceCookieHeader, "content-type": "application/json" },
  body: JSON.stringify({ content: [], baseVersion: Number(moveSql(`select version from public.pages where id = '${echoChapter}'`)) }),
});
check("…and refuses changes", refusedBack.status === 409, String(refusedBack.status));
const backSteps = [];
for (let i = 0; i < 20; i++) {
  const result = await setupAs(aliceCookieHeader, { action: "advance" });
  backSteps.push(`${result.step}${result.error ? `!${result.error}` : ""}`);
  if (result.step === "done" || result.error) break;
}
check("moving back copies, checks and switches", backSteps.at(-1) === "done" && backSteps.includes("verify"), backSteps.join(" "));
check("…the registry entry is gone", sql(`select count(*) from public.team_databases where workspace_id = '${echoId}'`) === "0");
check("…the team's change is in the central database", sql(`select content::text like '%Edited in the team database%' from public.pages where id = '${echoChapter}'`) === "t");
check("…the page made in the team came back, the stale one went", sql(`select count(*) from public.pages where id = '${echoAppendix}'`) === "1" && sql(`select count(*) from public.pages where id = '${echoStale}'`) === "0");
check("…the tree, comments and the file too", sql(`select parent_id from public.pages where id = '${echoChapter}'`) === echoHandbook && sql(`select count(*) from public.comments where workspace_id = '${echoId}'`) === "2" && sql(`select count(*) from storage.objects where bucket_id = 'attachments' and name = '${echoFile.path}'`) === "1");
check("…and the team database was left as it was", moveSql(`select count(*) from public.pages where workspace_id = '${echoId}'`) === "3");
await echoTab.goto(`${APP}/w/${echoShort}/p/${echoChapter}`);
await echoTab.getByText("Edited in the team database").first().waitFor({ timeout: 15000 }).catch(() => {});
check("after moving back the page opens from the EdgeKnow server", (await echoTab.getByText("Edited in the team database").count()) > 0 && (await echoTab.getByText("Workspace повертається").count()) === 0);
const backFile = await fetch(`${APP}/api/files/${echoFile.path}`, { headers: { cookie: aliceCookieHeader } });
check("…with its image from the central storage", backFile.ok && Buffer.from(await backFile.arrayBuffer()).equals(tinyPng) && backFile.url.startsWith(API), `${backFile.status} ${backFile.url}`);
const savedCentrally = await fetch(`${APP}/api/pages/${echoChapter}/content?w=${echoShort}`, {
  method: "POST",
  headers: { cookie: aliceCookieHeader, "content-type": "application/json" },
  body: JSON.stringify({ content: echoNewContent, baseVersion: Number(sql(`select version from public.pages where id = '${echoChapter}'`)) }),
}).then((r) => r.json());
check("…and saves there again", savedCentrally.ok === true, JSON.stringify(savedCentrally));

// Bob isn't in Team Delta: the central check stops him before any team token exists.
await bob.goto(`${APP}/w/${gammaShort}/p/${gammaPage}`);
check("a non-member can't open the team workspace", (await bob.getByText("Team-owned page").count()) === 0 && (await bob.getByText("Немає доступу до workspace").count()) > 0);

// TEAM_DB_KEY: the team databases' secrets were written under the old key; the
// nightly job moves them onto the new one, and the team workspace keeps working.
{
  const keyed = () => sql("select count(*) filter (where secret_key_encrypted like 'v2.team.%') || '/' || count(*) from public.team_databases where secret_key_encrypted is not null");
  const before = keyed();
  const cron = await fetch(`${APP}/api/cron/cleanup-files`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  const after = keyed();
  const [moved, total] = after.split("/").map(Number);
  check("the nightly job moves team database secrets onto TEAM_DB_KEY", cron.ok && moved === total && total > 0, `${before} → ${after}`);
  check("…nothing is left on the old key", sql("select count(*) from public.team_databases where secret_key_encrypted like 'v1.%' or db_url_encrypted like 'v1.%' or management_token_encrypted like 'v1.%'") === "0");
  await gammaTab.goto(`${APP}/w/${gammaShort}/p/${gammaPage}`);
  await gammaTab.getByText("Stored in the team database").first().waitFor({ timeout: 20000 }).catch(() => {});
  check("…and the team workspace still opens from its own database", (await gammaTab.getByText("Stored in the team database").count()) > 0);
}

// Rate limits: past 30 link previews a minute the server stops doing the work.
{
  const cookie = aliceCookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const statuses = [];
  // Up to 70 calls: a minute boundary in the middle starts the count again.
  while (statuses.length < 70 && statuses.at(-1) !== 429) {
    statuses.push((await fetch(`${APP}/api/link-preview?url=not-a-link`, { headers: { cookie } })).status);
  }
  check("too many link previews in a minute are refused", statuses.at(-1) === 429 && statuses.length > 25 && statuses.slice(0, -1).every((s) => s === 400), statuses.join(","));
}


await finish("team");
