// Browser smoke test, part 4: the node space — mind maps made and edited from the
// keyboard and the toolbar, saved by themselves, access like pages.
// Usage: node scripts/e2e/nodes.mjs status.json http://localhost:3000

import { calendarChecks, feedChecks, gridChecks, outsideChecks, holidayChecks, linkChecks, repeatChecks, timeOffChecks } from "./calendar-checks.mjs";
import { appsChecks } from "./apps-checks.mjs";
import { APP, alice, aliceClient, alphaId, alphaShort, bob, check, colleague, colleagueClient, finish, newPage, readdirSync, sql, until } from "./common.mjs";

const mapData = (title) => JSON.parse(sql(`select coalesce((select data from public.service_objects where title = '${title}' and service = 'nodes'), 'null'::jsonb)::text`));
const texts = (title) => (mapData(title)?.nodes ?? []).map((node) => node.text);

// The start page shows the node space working, and opens it.
await alice.goto(`${APP}/w/${alphaShort}`);
await alice.locator('[data-service="nodes"]').waitFor({ timeout: 15000 });
check("the start page has the node space working and the chat coming", (await alice.locator('[data-service="nodes"]', { hasText: "Скоро" }).count()) === 0 && (await alice.locator('[data-service="chat"]', { hasText: "Скоро" }).count()) === 1);
await alice.locator("[data-service-switcher]").getByRole("link", { name: "Нодовий простір" }).click();
await alice.waitForURL(new RegExp(`/w/${alphaShort}/nodes$`), { timeout: 15000 });

// A new map: title, then branches from the keyboard.
await alice.getByRole("button", { name: "＋ Ментальна карта" }).click();
await alice.waitForURL(new RegExp(`/w/${alphaShort}/nodes/[0-9a-f-]{36}$`), { timeout: 15000 });
const mapUrl = alice.url();
await alice.getByLabel("Назва карти").fill("Launch map");
const canvas = alice.locator("[data-mind-map]");
await canvas.locator('[data-map-node="Центральна тема"]').waitFor({ timeout: 15000 });
await canvas.focus();
await alice.keyboard.press("F2");
await alice.keyboard.press("Control+A");
await alice.keyboard.type("Launch");
await alice.keyboard.press("Tab");
await alice.keyboard.type("Design");
await alice.keyboard.press("Enter");
await alice.keyboard.type("Marketing");
await alice.keyboard.press("Tab");
await alice.keyboard.type("Ads");
await alice.keyboard.press("Escape");
check("a map grows from the keyboard: Tab for a branch, Enter for the next one", await until(() => JSON.stringify(texts("Launch map")) === JSON.stringify(["Launch", "Design", "Marketing", "Ads"]), 15000), JSON.stringify(texts("Launch map")));
const tree = mapData("Launch map").nodes;
const byText = Object.fromEntries(tree.map((node) => [node.text, node]));
check("…as a tree", byText.Design.parent === byText.Launch.id && byText.Marketing.parent === byText.Launch.id && byText.Ads.parent === byText.Marketing.id);

// The toolbar (for phones): fold a branch, colour, delete.
await alice.getByRole("button", { name: /Показати всю карту/ }).click();
await alice.waitForTimeout(400);
await canvas.locator('[data-map-node="Marketing"]').click();
await alice.locator("[data-map-toolbar]").getByRole("button", { name: "Згорнути гілку (Пробіл)" }).click();
await canvas.locator('[data-map-node="Ads"]').waitFor({ state: "detached", timeout: 10000 });
check("a branch folds and shows how many it hides", (await canvas.getByRole("button", { name: "Розгорнути гілку (Пробіл)" }).innerText()) === "+1");
await alice.getByLabel("Колір").selectOption("green");
await canvas.locator('[data-map-node="Design"]').click();
await alice.locator("[data-map-toolbar]").getByRole("button", { name: "Видалити гілку (Delete)" }).click();
check("…colours and deletes, all saved", await until(() => {
  const nodes = mapData("Launch map")?.nodes ?? [];
  const marketing = nodes.find((node) => node.text === "Marketing");
  return !nodes.some((node) => node.text === "Design") && marketing?.collapsed === true && marketing?.color === "green";
}, 15000));
await alice.waitForTimeout(1500);
await alice.reload();
await alice.locator('[data-map-node="Marketing"]').waitFor({ timeout: 15000 });
check("after a reload the map is as left", (await alice.getByLabel("Назва карти").inputValue()) === "Launch map" && (await alice.locator('[data-map-node="Ads"]').count()) === 0);

// Access like pages: the colleague edits by default; made private, they see nothing.
const mapId = mapUrl.split("/nodes/")[1];
await colleague.goto(mapUrl);
await colleague.locator('[data-map-node="Launch"]').waitFor({ timeout: 15000 });
check("a colleague opens the map and can edit it", (await colleague.getByLabel("Назва карти").count()) === 1);
await alice.getByRole("button", { name: "⚙️ Доступ" }).click();
const dialog = alice.getByRole("dialog", { name: "Доступ до карти" });
await dialog.getByRole("combobox").first().selectOption("");
check("…the owner closes it to the workspace", await until(() => sql(`select coalesce(workspace_role, 'none') from public.service_objects where id = '${mapId}'`) === "none", 10000));
await colleague.goto(mapUrl);
check("…and the colleague no longer sees it, nor in the list", (await colleague.getByText("Карту не знайдено").count()) === 1);
await colleague.goto(`${APP}/w/${alphaShort}/nodes`);
check("…not even its name", (await colleague.getByText("Launch map").count()) === 0);
await dialog.getByRole("combobox").first().selectOption("viewer");
await until(() => sql(`select workspace_role from public.service_objects where id = '${mapId}'`) === "viewer", 10000);
await colleague.goto(mapUrl);
await colleague.locator('[data-map-node="Launch"]').waitFor({ timeout: 15000 });
check("as a viewer they see it without editing", (await colleague.getByText("У вас лише перегляд").count()) === 1 && (await colleague.getByRole("button", { name: "＋ Гілка" }).count()) === 0);
await alice.keyboard.press("Escape");

// The bin.
await alice.getByRole("button", { name: /У кошик/ }).click();
await alice.waitForURL(new RegExp(`/w/${alphaShort}/nodes$`), { timeout: 15000 });
check("a map goes to the bin", (await alice.locator('[data-node-map="Launch map"]').count()) === 0 && sql(`select deleted_at is not null from public.service_objects where id = '${mapId}'`) === "t");
await alice.goto(`${APP}/w/${alphaShort}/nodes?bin=1`);
await alice.locator('[data-node-map="Launch map"]').getByRole("button", { name: "Відновити" }).click();
check("…and comes back", await until(() => sql(`select deleted_at is null from public.service_objects where id = '${mapId}'`) === "t", 10000));

// Step Н2: branches from a pasted list, the map as a diagram, and diagrams of their own.
await alice.goto(mapUrl);
await alice.locator('[data-map-node="Launch"]').waitFor({ timeout: 15000 });
await alice.locator("[data-map-toolbar]").getByRole("button", { name: /Зі списку/ }).click();
await alice.getByRole("form", { name: "Гілки зі списку" }).getByRole("textbox").fill("- Budget\n  - Q1\n- Team");
await alice.getByRole("button", { name: "Додати гілки" }).click();
check("a pasted list becomes branches, indents as sub-branches", await until(() => {
  const nodes = mapData("Launch map")?.nodes ?? [];
  const budget = nodes.find((node) => node.text === "Budget");
  return Boolean(budget) && nodes.find((node) => node.text === "Q1")?.parent === budget.id && nodes.some((node) => node.text === "Team");
}, 15000), JSON.stringify(texts("Launch map")));
await alice.waitForTimeout(1500);
const mapNodes = mapData("Launch map").nodes.length;
await alice.locator("[data-map-toolbar]").getByRole("button", { name: /У схему/ }).click();
await alice.waitForURL((url) => url.pathname.includes("/nodes/") && !url.pathname.endsWith(mapId), { timeout: 15000 });
await alice.locator("[data-flow] .react-flow__node").first().waitFor({ timeout: 15000 });
const flowId = alice.url().split("/nodes/")[1];
const flowShape = JSON.parse(sql(`select data::text from public.service_objects where id = '${flowId}'`));
check("…and the map turns into a diagram with the same boxes and lines", sql(`select kind from public.service_objects where id = '${flowId}'`) === "flow" && flowShape.nodes.length === mapNodes && flowShape.edges.length === mapNodes - 1, `${flowShape.nodes.length}/${flowShape.edges.length} of ${mapNodes}`);

await alice.goto(`${APP}/w/${alphaShort}/nodes`);
await alice.getByRole("button", { name: "＋ Схема" }).click();
await alice.waitForURL(new RegExp(`/w/${alphaShort}/nodes/[0-9a-f-]{36}$`), { timeout: 15000 });
await alice.getByLabel("Назва карти").fill("Order flow");
await alice.locator("[data-flow]").getByRole("button", { name: /Нода/ }).click();
await alice.locator("[data-flow] .react-flow__node").first().waitFor({ timeout: 15000 });
await alice.locator("[data-flow]").getByLabel("Назва", { exact: true }).fill("Is it paid?");
await alice.locator("[data-flow]").getByLabel("Форма").selectOption("diamond");
const flowSaved = () => JSON.parse(sql(`select coalesce((select data from public.service_objects where title = 'Order flow'), 'null'::jsonb)::text`));
check("a new diagram gets a box in the shape chosen", await until(() => flowSaved()?.nodes?.[0]?.shape === "diamond" && flowSaved()?.nodes?.[0]?.title === "Is it paid?", 15000), JSON.stringify(flowSaved()));
check("…and its text is found by search", await until(() => sql("select search_text from public.service_objects where title = 'Order flow'").includes("Is it paid?"), 10000));

// Step Н3: maps on wiki pages — live, folding and renaming in place; search finds them.
const orderId = sql("select id from public.service_objects where title = 'Order flow'");
const notesPage = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Map notes" })).data.id;
const notesSaved = await aliceClient.rpc("save_page_content", {
  target_page: notesPage,
  new_content: [
    { id: "m1", type: "nodeMap", props: { objectId: mapId }, children: [] },
    { id: "m2", type: "nodeMap", props: { objectId: orderId }, children: [] },
  ],
  base_version: 1,
});
check("(setup) a page with a map and a diagram", notesSaved.data?.ok === true, JSON.stringify(notesSaved.data));
await alice.goto(`${APP}/w/${alphaShort}/p/${notesPage}`);
const embed = alice.locator('[data-node-embed="Launch map"]');
await embed.locator('[data-map-node="Launch"]').waitFor({ timeout: 20000 });
// Two embeds load on their own: wait for the diagram too before counting (docs/TROUBLESHOOTING.md).
const diagramShown = await alice.locator('[data-node-embed="Order flow"] .react-flow__node').first().waitFor({ timeout: 20000 }).then(() => true, () => false);
check("a map shows on the page, and a diagram too", diagramShown && (await alice.locator('[data-node-embed="Order flow"] .react-flow__node').count()) === 1);
await embed.getByRole("button", { name: /Показати всю карту/ }).click();
await alice.waitForTimeout(400);
await embed.locator('[data-map-node="Team"]').click();
await alice.keyboard.press("F2");
await alice.keyboard.press("Control+A");
await alice.keyboard.type("People");
await alice.keyboard.press("Enter");
check("…a node is renamed right on the page and the map saves it", await until(() => texts("Launch map").includes("People") && !texts("Launch map").includes("Team"), 15000), JSON.stringify(texts("Launch map")));
sql(`update public.service_objects set data = jsonb_set(data, '{nodes,0,text}', '"Launch 2"'), version = version + 1 where id = '${mapId}'`);
await alice.evaluate(() => window.dispatchEvent(new Event("focus")));
await embed.locator('[data-map-node="Launch 2"]').waitFor({ timeout: 20000 }).catch(() => {});
check("…a change made elsewhere shows up without editing the page", (await embed.locator('[data-map-node="Launch 2"]').count()) === 1);

await alice.getByRole("button", { name: /Пошук/ }).first().click();
await alice.getByRole("button", { name: "🧠 Карти" }).click();
await alice.getByLabel(/Шукати в назвах/).fill("Budget");
await alice.locator("[data-map-results]").getByText("Launch map").waitFor({ timeout: 15000 }).catch(() => {});
check("search “Maps” finds a map by the text of its nodes", (await alice.locator("[data-map-results]").getByText("Launch map").count()) === 1);
await alice.keyboard.press("Escape");

sql(`update public.service_objects set workspace_role = null where id = '${orderId}'`);
sql(`update public.pages set workspace_role = 'viewer' where id = '${notesPage}'`);
await colleague.goto(`${APP}/w/${alphaShort}/p/${notesPage}`);
const untilShown = async (locator, ms = 20000) => {
  for (let i = 0; i < ms / 250; i++) {
    if ((await locator.count()) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};
const hidden = await untilShown(colleague.getByText("Немає доступу до цієї карти."));
const shownMap = await untilShown(colleague.locator('[data-node-embed="Launch map"] [data-map-node]'));
const screen = (await colleague.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
check("someone without access to a map sees “no access” on the page, not its name", hidden && (await colleague.getByText("Order flow").count()) === 0, screen);
check("…while a map they may view shows as usual", shownMap, screen);

// --- Boards (step Д1): a canvas with sticky notes, saved and private --------------------------------
{
  await alice.goto(`${APP}/w/${alphaShort}`);
  check("the Boards tile is ready on the start page", (await alice.locator(`a[href="/w/${alphaShort}/boards"]`).count()) >= 1);
  await alice.goto(`${APP}/w/${alphaShort}/boards`);
  await alice.getByRole("button", { name: "＋ Нова дошка" }).click();
  await alice.waitForURL(/\/boards\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const boardId = alice.url().split("/").pop();
  await alice.locator("[data-board-canvas] canvas").first().waitFor({ timeout: 30000 });
  await alice.getByLabel("Назва дошки").fill("Retro");
  await alice.locator('[data-sticky-color="yellow"]').click();
  await alice.locator("[data-board-canvas] canvas").last().click({ position: { x: 60, y: 60 } });
  await alice.keyboard.press("Escape");
  await alice.keyboard.press("s");
  const stickies = () => sql(`select count(*) from public.service_objects o, jsonb_array_elements(o.data -> 'elements') e where o.id = '${boardId}' and e -> 'customData' ->> 'sticky' = 'true'`);
  check("a new board takes sticky notes (button and S) and saves them with its name", await until(() => stickies() === "2" && sql(`select title from public.service_objects where id = '${boardId}'`) === "Retro", 20000), stickies());
  await alice.reload();
  await alice.locator("[data-board-canvas] canvas").first().waitFor({ timeout: 30000 });
  await alice.waitForTimeout(1500);
  check("…after reloading everything is in place", stickies() === "2" && (await alice.getByLabel("Назва дошки").inputValue()) === "Retro");
  const font = await fetch(`${APP}/excalidraw-assets/fonts/Nunito/${readdirSync("public/excalidraw-assets/fonts/Nunito")[0]}`, { redirect: "manual" });
  check("the canvas's fonts are served by the site itself", font.status === 200, String(font.status));

  // Step Д3a: a template, voting, the shared timer and a task from a sticky note.
  await alice.getByRole("button", { name: "＋ Нова дошка" }).waitFor({ state: "detached" }).catch(() => {});
  await alice.goto(`${APP}/w/${alphaShort}/boards`);
  await alice.getByRole("button", { name: "＋ Нова дошка" }).click();
  await alice.waitForURL(/\/boards\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const retroId = alice.url().split("/").pop();
  await alice.locator("[data-template-chooser]").getByRole("button", { name: "Ретроспектива" }).click();
  const frames = () => sql(`select count(*) from public.service_objects o, jsonb_array_elements(o.data -> 'elements') e where o.id = '${retroId}' and e ->> 'type' = 'frame'`);
  check("a new board starts from a template (retro: three frames)", await until(() => frames() === "3", 20000), frames());
  await alice.getByRole("button", { name: "🗳️ Голосування" }).click();
  await alice.getByLabel("Голосів у кожного").selectOption("2");
  await alice.getByRole("button", { name: "Почати", exact: true }).click();
  await alice.locator("[data-voting-open]").waitFor({ timeout: 15000 });
  await alice.locator("[data-vote]").first().click();
  const votes = () => sql(`select count(*) from public.board_votes where object_id = '${retroId}'`);
  await alice.getByText("Ваші голоси: 1 з 2").waitFor({ timeout: 15000 }).catch(() => {});
  check("voting: a vote on a sticky note counts, with the votes left shown", await until(() => votes() === "1", 15000) && (await alice.getByText("Ваші голоси: 1 з 2").count()) === 1, votes());
  await alice.getByRole("button", { name: "Завершити" }).click();
  await alice.locator("[data-vote-results]").waitFor({ timeout: 15000 });
  check("…finished, the results list the sticky note", (await alice.locator("[data-vote-results] li").count()) === 1);
  await alice.getByRole("button", { name: "⏱️ Таймер" }).click();
  await alice.getByRole("button", { name: "3 хв" }).click();
  await alice.locator("[data-board-timer]").waitFor({ timeout: 15000 });
  check("the shared timer runs for everyone", sql(`select timer_seconds from public.board_sessions where object_id = '${retroId}'`) === "180");
  await colleague.goto(`${APP}/w/${alphaShort}/boards/${retroId}`);
  await colleague.locator("[data-board-timer]").waitFor({ timeout: 20000 }).catch(() => {});
  check("…a colleague sees the same countdown", (await colleague.locator("[data-board-timer]").count()) === 1);
  await alice.locator('[data-sticky-color="blue"]').click();
  await alice.keyboard.press("Enter");
  await alice.keyboard.type("Fix the login page");
  await alice.keyboard.press("Escape");
  await alice.waitForTimeout(800);
  await alice.getByRole("button", { name: "✅ Задача зі стікера" }).click();
  const taskDialog = alice.getByRole("dialog", { name: "Задача зі стікера" });
  await taskDialog.getByRole("button", { name: "Створити задачу" }).click();
  await alice.getByText(/Створено [A-Z0-9]+-\d+/).waitFor({ timeout: 20000 }).catch(() => {});
  const linked = () => sql(`select e -> 'customData' -> 'task' ->> 'key' from public.service_objects o, jsonb_array_elements(o.data -> 'elements') e where o.id = '${retroId}' and e -> 'customData' -> 'task' is not null`);
  check("a task is made from a sticky note and the note carries its chip", await until(() => /^[A-Z0-9]+-\d+$/.test(linked()), 20000) && sql(`select count(*) from public.tasks where title = 'Fix the login page'`) === "1", linked());
  await alice.locator("[data-sticky-task]").waitFor({ timeout: 15000 }).catch(() => {});
  check("…shown on the board", (await alice.locator("[data-sticky-task]").count()) === 1);


  // Step Д3b: a picture dropped on the board is kept in the workspace's one storage and comes back.
  await alice.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = "#fde047";
    ctx.fillRect(100, 75, 200, 150);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "drop.png", { type: "image/png" });
    const target = document.querySelector("[data-board-canvas] .excalidraw__canvas.interactive");
    const box = target.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, cancelable: true, dataTransfer: transfer };
    target.dispatchEvent(new DragEvent("dragover", at));
    target.dispatchEvent(new DragEvent("drop", at));
  });
  const pictures = () => sql(`select count(*) from public.object_files f where f.object_id = '${retroId}' and f.storage_backend <> 'pending'`);
  const pictureLinks = () => sql(`select count(*) from public.service_objects o, jsonb_object_keys(o.data -> 'files') k where o.id = '${retroId}'`);
  check("a picture dropped on a board is stored in the one storage and saved with the board", await until(() => pictures() === "1" && pictureLinks() === "1", 30000), `${pictures()} ${pictureLinks()}`);
  const pictureId = sql(`select id from public.object_files where object_id = '${retroId}'`);
  const served = await alice.evaluate(async (url) => { const r = await fetch(url); return `${r.status} ${r.headers.get("content-type")}`; }, `/api/boards/files/${pictureId}?ws=${alphaShort}`);
  check("…it opens for people who see the board", /^200 image\//.test(served), served);
  await bob.goto(`${APP}/`);
  const strangerPicture = await bob.evaluate(async (url) => (await fetch(url)).status, `${APP}/api/boards/files/${pictureId}?ws=${alphaShort}`).catch(() => 0);
  check("…and not for someone from another workspace", strangerPicture !== 200, String(strangerPicture));
  const fetchedAgain = alice.waitForResponse((r) => r.url().includes(`/api/boards/files/${pictureId}`), { timeout: 30000 }).then((r) => r.status()).catch(() => 0);
  await alice.reload();
  const reloadedPicture = await fetchedAgain;
  check("…after reloading the board fetches it again", reloadedPicture === 200, String(reloadedPicture));


  // Step Д4: the board on a wiki page — live, sticky notes added in place; search finds its notes.
  sql(`update public.service_objects set title = 'Retro board', version = version + 1 where id = '${retroId}'`);
  const boardPage = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Board notes" })).data.id;
  const boardPageSaved = await aliceClient.rpc("save_page_content", { target_page: boardPage, new_content: [{ id: "b1", type: "boardEmbed", props: { boardId: retroId }, children: [] }], base_version: 1 });
  check("(setup) a page with a board", boardPageSaved.data?.ok === true, JSON.stringify(boardPageSaved.data));
  await alice.goto(`${APP}/w/${alphaShort}/p/${boardPage}`);
  const boardEmbed = alice.locator('[data-board-embed="Retro board"]');
  await boardEmbed.locator("[data-board-embed-canvas] canvas").first().waitFor({ timeout: 30000 });
  const stickiesOnRetro = () => Number(sql(`select count(*) from public.service_objects o, jsonb_array_elements(o.data -> 'elements') e where o.id = '${retroId}' and e -> 'customData' ->> 'sticky' = 'true'`));
  const before = stickiesOnRetro();
  // A narrow board (on a page) shows only the current colour.
  await boardEmbed.locator("[data-sticky-color]").first().click();
  check("a board shows on a wiki page and takes a sticky note right there", await until(() => stickiesOnRetro() === before + 1, 20000), `${before} → ${stickiesOnRetro()}`);
  check("…with a link to the editor", (await boardEmbed.getByRole("link", { name: /Відкрити в редакторі/ }).count()) === 1);
  await alice.waitForTimeout(1500);
  sql(`update public.service_objects set title = 'Retro board 2', version = version + 1 where id = '${retroId}'`);
  await alice.evaluate(() => window.dispatchEvent(new Event("focus")));
  await alice.locator('[data-board-embed="Retro board 2"]').waitFor({ timeout: 20000 }).catch(() => {});
  check("…a change made elsewhere shows up without editing the page", (await alice.locator('[data-board-embed="Retro board 2"]').count()) === 1);

  await alice.getByRole("button", { name: /Пошук/ }).first().click();
  await alice.getByRole("button", { name: "🎨 Дошки" }).click();
  await alice.getByLabel(/Шукати в назвах/).fill("login page");
  await alice.locator("[data-board-results]").getByText("Retro board 2").waitFor({ timeout: 15000 }).catch(() => {});
  check("search “Boards” finds a board by the text of its sticky notes", (await alice.locator("[data-board-results]").getByText("Retro board 2").count()) === 1);
  await alice.keyboard.press("Escape");

  sql(`update public.service_objects set workspace_role = null where id = '${retroId}'`);
  sql(`update public.pages set workspace_role = 'viewer' where id = '${boardPage}'`);
  await colleague.goto(`${APP}/w/${alphaShort}/p/${boardPage}`);
  await colleague.getByText("Немає доступу до цієї дошки.").waitFor({ timeout: 20000 }).catch(() => {});
  check("someone without access to a board sees “no access” on the page, not its name", (await colleague.getByText("Немає доступу до цієї дошки.").count()) === 1 && (await colleague.getByText("Retro board 2").count()) === 0);
  sql(`update public.service_objects set workspace_role = 'editor' where id = '${retroId}'`);

  await bob.goto(`${APP}/w/${alphaShort}/boards/${boardId}`);
  check("someone from another workspace sees nothing of the board", (await bob.getByText("Retro").count()) === 0);
  await colleague.goto(`${APP}/w/${alphaShort}/boards`);
  check("a colleague sees the team's board in the list", (await colleague.locator('[data-board="Retro"]').count()) === 1);
}

// --- Presentations (step П-1): slides with text and shapes, saved, reordered ---------------------
{
  await alice.goto(`${APP}/w/${alphaShort}/slides`);
  await alice.getByRole("button", { name: "＋ Нова презентація" }).click();
  await alice.waitForURL(/\/slides\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const deckId = alice.url().split("/").pop();
  await alice.getByLabel("Назва презентації").fill("Pitch");
  const svg = alice.locator("[data-deck-canvas] svg");
  await svg.waitFor({ timeout: 30000 });
  // The canvas fits itself to the window just after it appears: measure once it has settled.
  let box = await svg.boundingBox();
  for (let i = 0; i < 20; i++) {
    await alice.waitForTimeout(250);
    const again = await svg.boundingBox();
    if (again && Math.abs(again.width - box.width) < 1 && Math.abs(again.y - box.y) < 1) break;
    box = again;
  }
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  await alice.locator('[data-tool="RECTANGLE"]').click();
  await alice.mouse.move(...at(0.1, 0.1));
  await alice.mouse.down();
  await alice.mouse.move(...at(0.4, 0.4), { steps: 5 });
  await alice.mouse.up();
  await alice.locator('[data-tool="TEXT"]').click();
  await alice.mouse.click(...at(0.1, 0.7));
  await alice.locator("[data-text-editor]").fill("Quarterly goals");
  await alice.mouse.click(...at(0.9, 0.9));
  // Step П-2: the rectangle gets a 135° brand gradient and a shadow; the dark theme for the deck.
  // Picked in the layers panel (independent of where the canvas sits on the page).
  await alice.locator('[data-side-tab="layers"]').click();
  await alice.locator('[data-layer="Прямокутник"] input').click();
  await alice.locator('[data-side-tab="design"]').click();
  await alice.locator('[data-fill-mode="linear"]').click();
  await alice.locator('[data-brand-gradient="slides"]').click();
  await alice.locator("[data-shadow]").check();
  await alice.locator("[data-theme-select]").selectOption("dark");
  await alice.locator("[data-slide-template]").selectOption("blank");
  await alice.locator("[data-add-slide]").click();
  await alice.locator('[data-save-status="saved"]').waitFor({ timeout: 15000 }).catch(() => {});
  await alice.waitForTimeout(1500);
  const saved = sql(`select title || ' ' || jsonb_array_length(data -> 'slides') || ' ' || jsonb_array_length(data #> '{slides,0,nodes}') || ' ' || search_text from public.service_objects where id = '${deckId}'`);
  check("a presentation keeps its slides, shapes and text (and the text is searchable)", saved === "Pitch 2 2 Quarterly goals", saved);
  const look = sql(`select (data ->> 'theme') || ' ' || (data #>> '{slides,0,nodes,0,gradient,angle}') || ' ' || ((data #> '{slides,0,nodes,0,shadow}') is not null) from public.service_objects where id = '${deckId}'`);
  check("…with a brand gradient, a shadow and the dark theme (step П-2)", look === "dark 135 true", look);
  await alice.reload();
  await alice.locator('[data-slide-thumb="1"] [data-node], [data-deck-canvas] [data-node]').first().waitFor({ timeout: 20000 }).catch(() => {});
  check("…and shows them again after a reload", (await alice.locator("[data-deck-canvas] [data-node]").count()) === 2);
  // Step П-3а: the slide size changes while editing (content fitted), and the deck is shown.
  await alice.locator("[data-size-button]").click();
  await alice.locator('[data-aspect="9:16"]').click();
  await alice.locator('[data-save-status="saved"]').waitFor({ timeout: 15000 }).catch(() => {});
  await alice.waitForTimeout(1500);
  const sized = sql(`select (data #>> '{size,w}') || 'x' || (data #>> '{size,h}') from public.service_objects where id = '${deckId}'`);
  check("…turns portrait (9:16) without a new file", sized === "1080x1920", sized);
  await alice.goto(`${APP}/w/${alphaShort}/slides/${deckId}/play`);
  await alice.locator("[data-player]").waitFor({ timeout: 20000 });
  const first = await alice.locator("[data-player-count]").innerText();
  // The player is on screen before its keys work (the page streams in, then wakes up):
  // press again until it answers. With two slides a second press changes nothing.
  for (let i = 0; i < 10 && (await alice.locator("[data-player-count]").innerText()).trim() !== "2 / 2"; i++) {
    await alice.keyboard.press("ArrowRight");
    await alice.waitForTimeout(500);
  }
  check("…and is shown in its own page, slide by slide", first.trim() === "1 / 2" && (await alice.locator("[data-player-count]").innerText()).trim() === "2 / 2", first);
  // Step П-3б: a wiki page embedded live on a slide, shown in the show.
  await alice.goto(`${APP}/w/${alphaShort}/slides/${deckId}`);
  await alice.locator("[data-embed-add]").click();
  await alice.locator('[data-embed-kind="page"]').click();
  await alice.locator('[data-embed-picker="page"] button').first().click();
  await alice.locator('[data-save-status="saved"]').waitFor({ timeout: 15000 }).catch(() => {});
  await alice.waitForTimeout(1500);
  const embedded = sql(`select count(*) from public.service_objects o, jsonb_array_elements(o.data -> 'slides') s, jsonb_array_elements(s -> 'nodes') n where o.id = '${deckId}' and n ->> 'type' = 'EMBED' and length(n #>> '{embed,id}') = 36`);
  check("…takes a live wiki page card (step П-3б)", embedded === "1", embedded);
  await alice.goto(`${APP}/w/${alphaShort}/slides/${deckId}/play`);
  await alice.locator("[data-player]").waitFor({ timeout: 20000 });
  await alice.locator("[data-embed-page]").first().waitFor({ timeout: 15000 }).catch(() => {});
  check("…and shows the card in the show", (await alice.locator("[data-embed-page]").count()) >= 1);
}

// --- Design (steps Д-1…Д-4): a frame with a shape inside, auto layout, the prototype player ------
{
  await alice.goto(`${APP}/w/${alphaShort}/boards`);
  await alice.locator("[data-new-design]").click();
  await alice.waitForURL(/\/boards\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const designId = alice.url().split("/").pop();
  await alice.getByLabel("Назва дизайну").fill("App screens");
  const canvas = alice.locator("[data-design-canvas]");
  await canvas.waitFor({ timeout: 30000 });
  const c = await canvas.boundingBox();
  const drawBox = async (tool, x1, y1, x2, y2) => {
    await alice.locator(`[data-tool="${tool}"]`).click();
    await alice.mouse.move(c.x + x1, c.y + y1);
    await alice.mouse.down();
    await alice.mouse.move(c.x + x2, c.y + y2, { steps: 6 });
    await alice.mouse.up();
  };
  await drawBox("FRAME", 60, 60, 300, 420);
  await drawBox("RECTANGLE", 90, 120, 200, 180);
  const depth = await alice.locator('[data-layer="Прямокутник"]').getAttribute("data-layer-depth").catch(() => null);
  check("a shape drawn on a frame goes inside it (step Д-1)", depth === "1", depth);
  await alice.locator('[data-layer^="Рамка"] [data-layer-pick]').click();
  await alice.locator("[data-auto-layout-add]").click();
  await alice.locator('[data-save-status="saved"]').waitFor({ timeout: 15000 }).catch(() => {});
  await alice.waitForTimeout(1500);
  const saved = sql(`select kind || ' ' || title || ' ' || jsonb_array_length(data #> '{pages,0,nodes}') || ' ' || (data #>> '{pages,0,nodes,0,autoLayout,dir}') from public.service_objects where id = '${designId}'`);
  check("…saved as a design file with auto layout on the frame (step Д-2)", saved === "design App screens 2 column", saved);
  await alice.goto(`${APP}/w/${alphaShort}/boards/${designId}/prototype`);
  await alice.locator("[data-design-player]").waitFor({ timeout: 20000 });
  check("…and plays as a prototype in its own page (step Д-3)", (await alice.locator('[data-player-screen^="Рамка"]').count()) === 1);
  await bob.goto(`${APP}/w/${alphaShort}/boards/${designId}/prototype`);
  check("someone from another workspace can't open the prototype", (await bob.locator("[data-design-player]").count()) === 0);
}

// --- Tables (step Т1): a workbook with Excel formulas, saved and private ----------------------------
{
  await alice.goto(`${APP}/w/${alphaShort}/sheets`);
  await alice.getByRole("button", { name: "＋ Нова таблиця" }).click();
  await alice.waitForURL(/\/sheets\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const sheetId = alice.url().split("/").pop();
  const overlay = alice.locator("[data-sheet] .fortune-sheet-overlay").first();
  await overlay.waitFor({ timeout: 30000 });
  await alice.getByLabel("Назва таблиці").fill("Budget");
  const box = await overlay.boundingBox();
  await alice.mouse.click(box.x + 46 + 40, box.y + 20 + 10);
  for (const value of ["10", "32", "=SUM(A1:A2)", "=XLOOKUP(32,A1:A2,A1:A2)", "=IF(TRUE,\"yes\",\"no\")", "=SUM({1,2,3})", "=ROW(A7)+LET(x,2,x*3)", "=SUM(FILTER(A1:A2,A1:A2>20))"]) {
    await alice.keyboard.type(value);
    await alice.keyboard.press("Enter");
  }
  const cell = (r, field) => sql(`select e -> 'v' ->> '${field}' from public.service_objects o, jsonb_array_elements(o.data -> 'sheets' -> 0 -> 'celldata') e where o.id = '${sheetId}' and (e ->> 'r')::int = ${r} and (e ->> 'c')::int = 0`);
  check("a table takes values and Excel formulas, and saves them with its name", await until(() => cell(2, "v") === "42" && cell(3, "v") === "32" && cell(4, "v") === "yes" && sql(`select title from public.service_objects where id = '${sheetId}'`) === "Budget", 20000), `${cell(2, "v")} ${cell(3, "v")} ${cell(4, "v")}`);
  check("…the formula itself is kept", cell(2, "f") === "=SUM(A1:A2)", cell(2, "f"));
  // Package 4: array literals, ROW of a reference, LET and FILTER inside a formula, as in Excel.
  check("…{1,2,3}, ROW(A7), LET and FILTER give Excel's results", await until(() => cell(5, "v") === "6" && cell(6, "v") === "13" && cell(7, "v") === "32", 15000), `${cell(5, "v")} ${cell(6, "v")} ${cell(7, "v")}`);
  await alice.reload();
  await alice.locator("[data-sheet] .fortune-sheet-overlay").first().waitFor({ timeout: 30000 });
  await alice.waitForTimeout(1000);
  check("…after reloading it is all there", cell(2, "v") === "42" && (await alice.getByLabel("Назва таблиці").inputValue()) === "Budget");
  check("the editor speaks Ukrainian", (await alice.locator("[data-sheet]").getByText("Аркуш1").count()) >= 1);
  check("search reads the table's cells", await until(() => sql(`select search_text from public.service_objects where id = '${sheetId}'`).includes("42"), 10000));
  // Step Т3: a chart from a range, saved with the table and drawn from its data.
  await alice.getByRole("button", { name: "📈 Нова діаграма" }).click();
  const chartForm = alice.locator("[data-chart-form]");
  await chartForm.getByLabel("Назва діаграми").fill("Totals");
  await chartForm.getByLabel(/Дані/).fill("A1:A3");
  await chartForm.getByRole("button", { name: "Зберегти" }).click();
  check("a chart is made from a range and saved with the table", await until(() => sql(`select data -> 'charts' -> 0 ->> 'range' || ' ' || (data -> 'charts' -> 0 ->> 'title') from public.service_objects where id = '${sheetId}'`) === "A1:A3 Totals", 15000) && (await alice.locator('[data-chart="Totals"] canvas').count()) === 1);
  await alice.reload();
  await alice.locator('[data-chart="Totals"] canvas').waitFor({ timeout: 30000 }).catch(() => {});
  check("…and is there after reloading", (await alice.locator('[data-chart="Totals"] canvas').count()) === 1);
  await colleague.goto(`${APP}/w/${alphaShort}/sheets`);
  check("a colleague sees the team's table in the list", (await colleague.locator('[data-sheet="Budget"]').count()) === 1);

  // Step Т2: saving as Excel and CSV, and a new table from an Excel file.
  const ExcelJS = (await import("exceljs")).default;
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(`${tmpdir()}/sheets-`);
  const [xlsxDownload] = await Promise.all([alice.waitForEvent("download", { timeout: 20000 }), alice.locator("[data-sheet-files]").getByRole("button", { name: "⬇️ Excel" }).click()]);
  await xlsxDownload.saveAs(`${dir}/budget.xlsx`);
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(readFileSync(`${dir}/budget.xlsx`));
  const total = saved.worksheets[0].getCell("A3").value;
  check("a table saves as an Excel file with its formulas and results", xlsxDownload.suggestedFilename() === "Budget.xlsx" && total?.formula === "SUM(A1:A2)" && Number(total?.result) === 42, JSON.stringify(total));
  const [csvDownload] = await Promise.all([alice.waitForEvent("download", { timeout: 20000 }), alice.locator("[data-sheet-files]").getByRole("button", { name: "⬇️ CSV" }).click()]);
  await csvDownload.saveAs(`${dir}/budget.csv`);
  const csv = readFileSync(`${dir}/budget.csv`, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  check("…and the current sheet as CSV", csv[0] === "10" && csv[2] === "42", JSON.stringify(csv.slice(0, 3)));

  const source = new ExcelJS.Workbook();
  const ws = source.addWorksheet("Витрати");
  ws.getCell("A1").value = "Стаття";
  ws.getCell("A1").font = { bold: true };
  ws.getCell("B1").value = 1200;
  ws.getCell("B2").value = 300;
  ws.getCell("B3").value = { formula: "SUM(B1:B2)", result: 1500 };
  ws.mergeCells("C1:D1");
  writeFileSync(`${dir}/costs.xlsx`, Buffer.from(await source.xlsx.writeBuffer()));
  await alice.goto(`${APP}/w/${alphaShort}/sheets`);
  await alice.locator("[data-open-sheet-file]").setInputFiles(`${dir}/costs.xlsx`);
  await alice.waitForURL(/\/sheets\/[0-9a-f-]{36}/, { timeout: 30000 });
  const openedId = alice.url().split("/").pop().split("?")[0];
  const openedCell = (r, c, field) => sql(`select e -> 'v' ->> '${field}' from public.service_objects o, jsonb_array_elements(o.data -> 'sheets' -> 0 -> 'celldata') e where o.id = '${openedId}' and (e ->> 'r')::int = ${r} and (e ->> 'c')::int = ${c}`);
  check("an Excel file opens as a new table: name, sheet, values, formula, bold, merged cells", sql(`select title || ' / ' || (data -> 'sheets' -> 0 ->> 'name') from public.service_objects where id = '${openedId}'`) === "costs / Витрати" && openedCell(0, 0, "m") === "Стаття" && openedCell(0, 0, "bl") === "1" && openedCell(2, 1, "f") === "=SUM(B1:B2)" && sql(`select data -> 'sheets' -> 0 -> 'config' -> 'merge' ? '0_2' from public.service_objects where id = '${openedId}'`) === "t", `${openedCell(0, 0, "m")} ${openedCell(2, 1, "f")}`);
  await alice.locator("[data-sheet] .fortune-sheet-overlay").first().waitFor({ timeout: 30000 });
  await alice.locator("[data-add-sheet-file]").setInputFiles(`${dir}/costs.xlsx`);
  check("…and sheets from a file are added to a table", await until(() => sql(`select jsonb_array_length(data -> 'sheets') || ' ' || (data -> 'sheets' -> 1 ->> 'name') from public.service_objects where id = '${openedId}'`) === "2 Витрати (2)", 20000), sql(`select jsonb_array_length(data -> 'sheets') from public.service_objects where id = '${openedId}'`));

  // Step Т4: a table and one of its charts on a wiki page; search finds tables by their cells.
  const chartId = sql(`select data -> 'charts' -> 0 ->> 'id' from public.service_objects where id = '${sheetId}'`);
  const tablePage = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Table notes" })).data.id;
  const tablePageSaved = await aliceClient.rpc("save_page_content", {
    target_page: tablePage,
    new_content: [
      { id: "s1", type: "sheetEmbed", props: { sheetId, chartId: "" }, children: [] },
      { id: "s2", type: "sheetEmbed", props: { sheetId, chartId }, children: [] },
    ],
    base_version: 1,
  });
  check("(setup) a page with a table and its chart", tablePageSaved.data?.ok === true, JSON.stringify(tablePageSaved.data));
  await alice.goto(`${APP}/w/${alphaShort}/p/${tablePage}`);
  const tableEmbed = alice.locator('[data-sheet-embed="Budget"]');
  await tableEmbed.first().locator("[data-sheet-embed-grid] .fortune-sheet-overlay").waitFor({ timeout: 30000 }).catch(() => {});
  check("a table shows on a wiki page, and a chart of it too", (await tableEmbed.first().locator("[data-sheet-embed-grid] .fortune-sheet-overlay").count()) === 1 && (await alice.locator("[data-sheet-embed-chart] canvas").count()) === 1);
  check("…with a link to the editor", (await tableEmbed.first().getByRole("link", { name: /Відкрити в редакторі/ }).count()) === 1);
  sql(`update public.service_objects set title = 'Budget 2', version = version + 1 where id = '${sheetId}'`);
  await alice.evaluate(() => window.dispatchEvent(new Event("focus")));
  // Two embeds (the table and its chart) read the change separately: wait for both, not the first.
  await alice.locator('[data-sheet-embed="Budget 2"]').nth(1).waitFor({ timeout: 20000 }).catch(() => {});
  check("…a change made elsewhere shows up without editing the page", (await alice.locator('[data-sheet-embed="Budget 2"]').count()) === 2);
  await alice.getByRole("button", { name: /Пошук/ }).first().click();
  await alice.getByRole("button", { name: "📊 Таблиці" }).click();
  await alice.getByLabel(/Шукати в назвах/).fill("42");
  await alice.locator("[data-sheet-results]").getByText("Budget 2").waitFor({ timeout: 15000 }).catch(() => {});
  check("search “Tables” finds a table by the text of its cells", (await alice.locator("[data-sheet-results]").getByText("Budget 2").count()) === 1);
  await alice.keyboard.press("Escape");
  sql(`update public.service_objects set workspace_role = null where id = '${sheetId}'`);
  sql(`update public.pages set workspace_role = 'viewer' where id = '${tablePage}'`);
  await colleague.goto(`${APP}/w/${alphaShort}/p/${tablePage}`);
  // Two embeds (table and chart): wait for the second one too, not just the first.
  await colleague.getByText("Немає доступу до цієї таблиці.").nth(1).waitFor({ timeout: 20000 }).catch(() => {});
  check("someone without access to a table sees “no access” on the page, not its name", (await colleague.getByText("Немає доступу до цієї таблиці.").count()) === 2 && (await colleague.getByText("Budget 2").count()) === 0);
  sql(`update public.service_objects set workspace_role = 'editor' where id = '${sheetId}'`);
}

// --- Surveys (steps О1, О2, О4): a form, answers into a connected table, results, on a page --------
{
  await alice.goto(`${APP}/w/${alphaShort}`);
  await alice.locator("[data-service-switcher]").getByRole("link", { name: "Опитування" }).click();
  await alice.waitForURL(new RegExp(`/w/${alphaShort}/surveys$`), { timeout: 15000 });
  await alice.getByRole("button", { name: "＋ Нове опитування" }).click();
  await alice.waitForURL(new RegExp(`/w/${alphaShort}/surveys/[0-9a-f-]{36}$`), { timeout: 15000 });
  const surveyId = alice.url().split("/").at(-1);
  check("a new survey is open to the workspace for answering only", sql(`select workspace_role from public.service_objects where id = '${surveyId}'`) === "viewer");
  await alice.getByLabel("Назва опитування").fill("Lunch poll");
  await alice.getByLabel("Текст питання").first().fill("Coming to lunch?");
  await alice.getByLabel("Варіант 1", { exact: true }).fill("Yes");
  await alice.getByLabel("Варіант 2", { exact: true }).fill("No");
  await alice.getByLabel("Обов'язкове").first().check();
  const surveyJson = () => sql(`select title || ' ' || (data -> 'sections' -> 0 -> 'questions' -> 0)::text from public.service_objects where id = '${surveyId}'`);
  check("the form is saved by itself", await until(() => /Lunch poll .*Coming to lunch\?.*"required": true.*/.test(surveyJson()) && surveyJson().includes('"label": "No"'), 15000), surveyJson());

  await alice.getByRole("tab", { name: /Налаштування/ }).click();
  await alice.getByRole("button", { name: "＋ Нова таблиця" }).click();
  await alice.locator("[data-survey-sheet-linked]").waitFor({ timeout: 15000 }).catch(() => {});
  const linkedSheet = sql(`select coalesce(sheet_id::text, '') from public.survey_settings where object_id = '${surveyId}'`);
  check("a new table is connected for the answers", linkedSheet.length === 36 && (await alice.locator("[data-survey-sheet-linked]").count()) === 1, linkedSheet);

  // A colleague answers (the required question first).
  await colleague.goto(`${APP}/w/${alphaShort}/surveys/${surveyId}`);
  await colleague.locator("[data-survey-form]").waitFor({ timeout: 15000 });
  await colleague.getByRole("button", { name: "Надіслати" }).click();
  check("a required question must be answered", (await colleague.getByText("Дайте відповідь на обов'язкові питання.").count()) === 1);
  await colleague.getByRole("radio", { name: "Yes" }).check();
  await colleague.getByRole("button", { name: "Надіслати" }).click();
  await colleague.locator("[data-survey-done]").waitFor({ timeout: 15000 }).catch(() => {});
  check("the colleague's answer is sent", (await colleague.getByText("Дякуємо! Відповідь записано.").count()) === 1);
  const stored = sql(`select count(*) || ' ' || bool_and(user_id is not null) || ' ' || max(answers::text) from public.survey_responses where object_id = '${surveyId}'`);
  check("…and kept with its name", /^1 true \{".+": "Yes"\}$/.test(stored), stored);
  const row = sql(`select string_agg(c -> 'v' ->> 'm', '|' order by (c ->> 'c')::integer) from public.service_objects o, jsonb_array_elements(o.data -> 'sheets') s, jsonb_array_elements(s -> 'celldata') c where o.id = '${linkedSheet}' and s ->> 'name' = 'Відповіді' and (c ->> 'r')::integer = 1`);
  check("…and written as a row of the connected table", row.endsWith("|Yes") && row.split("|").length === 3, row);
  await colleague.reload();
  await colleague.locator("[data-survey-answered]").waitFor({ timeout: 15000 }).catch(() => {});
  check("one answer per person", (await colleague.locator("[data-survey-answered]").count()) === 1);
  const peek = await colleagueClient.rpc("survey_answers", { target_object: surveyId });
  check("someone who only answers can't read the answers", peek.data?.error === "forbidden", JSON.stringify(peek.data ?? peek.error));

  await alice.reload();
  await alice.getByRole("tab", { name: /Відповіді/ }).click();
  await alice.locator('[data-survey-count="1"]').waitFor({ timeout: 15000 }).catch(() => {});
  check("the owner sees the answer, with a chart for the question", (await alice.locator('[data-survey-count="1"]').count()) === 1 && (await alice.locator("[data-survey-summary] canvas").count()) === 1 && (await alice.locator("[data-survey-response]").count()) === 1);

  // Step О4: the form and the summary on a wiki page; search finds the survey by its question.
  const surveyPage = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Survey notes" })).data.id;
  const surveyPageSaved = await aliceClient.rpc("save_page_content", {
    target_page: surveyPage,
    new_content: [
      { id: "v1", type: "surveyEmbed", props: { surveyId, view: "form" }, children: [] },
      { id: "v2", type: "surveyEmbed", props: { surveyId, view: "summary" }, children: [] },
    ],
    base_version: 1,
  });
  check("(setup) a page with a survey's form and summary", surveyPageSaved.data?.ok === true, JSON.stringify(surveyPageSaved.data));
  sql(`update public.pages set workspace_role = 'viewer' where id = '${surveyPage}'`);
  await alice.goto(`${APP}/w/${alphaShort}/p/${surveyPage}`);
  await alice.locator('[data-survey-embed="Lunch poll"] [data-survey-results]').waitFor({ timeout: 20000 }).catch(() => {});
  check("a survey's form and summary show on a wiki page", (await alice.locator('[data-survey-embed="Lunch poll"] [data-survey-form]').count()) === 1 && (await alice.locator('[data-survey-embed="Lunch poll"] [data-survey-results]').count()) === 1);
  await colleague.goto(`${APP}/w/${alphaShort}/p/${surveyPage}`);
  // Both embeds load their state after the frame shows: wait for what is checked, not the frame.
  await colleague.locator("[data-survey-answered]").waitFor({ timeout: 20000 }).catch(() => {});
  await colleague.getByText("Підсумки бачать лише ті, хто редагує опитування.").waitFor({ timeout: 20000 }).catch(() => {});
  check("…someone who only answers sees the form (answered) but not the summary",
    (await colleague.locator("[data-survey-answered]").count()) === 1 && (await colleague.getByText("Підсумки бачать лише ті, хто редагує опитування.").count()) === 1);
  await alice.getByRole("button", { name: /Пошук/ }).first().click();
  await alice.getByRole("button", { name: "📝 Опитування" }).click();
  await alice.getByLabel(/Шукати в назвах/).fill("lunch?");
  await alice.locator("[data-survey-hits]").getByText("Lunch poll").waitFor({ timeout: 15000 }).catch(() => {});
  check("search “Surveys” finds a survey by its question", (await alice.locator("[data-survey-hits]").getByText("Lunch poll").count()) === 1);
  await alice.keyboard.press("Escape");
}

// --- Surveys, step О3: the link for anyone; files only for someone signed in ------------------------
{
  const made = await aliceClient.rpc("create_service_object", {
    ws: alphaId,
    target_service: "surveys",
    new_kind: "survey",
    new_title: "Open form",
    new_data: { sections: [{ id: "s", questions: [{ id: "q", type: "single", title: "Pick one", required: true, options: [{ label: "Red" }, { label: "Blue" }] }, { id: "f", type: "file", title: "Your file" }] }] },
  });
  const openId = made.data?.id;
  const link = await aliceClient.rpc("set_survey_public", { target_object: openId, enabled: true, renew: false });
  const token = link.data?.token;
  check("(setup) a survey with its link for anyone", Boolean(openId && /^[0-9a-f]{32}$/.test(token ?? "")), JSON.stringify(link.data ?? link.error));
  const url = `${APP}/f/${alphaShort}/${token}`;

  const visitor = await newPage();
  await visitor.goto(url);
  await visitor.locator("[data-public-survey] [data-survey-form]").waitFor({ timeout: 20000 }).catch(() => {});
  check("someone without an account opens the form through the link", (await visitor.locator('[data-question="Pick one"]').count()) === 1 && !visitor.url().includes("/login"));
  check("…sees the file question with “sign in to add a file”", (await visitor.locator("[data-survey-file-signin]").count()) === 1 && (await visitor.locator('input[type="file"]').count()) === 0);
  check("…and nothing else of the workspace", (await visitor.locator("aside").count()) === 0 && (await visitor.getByText("Alpha secret").count()) === 0);
  await visitor.getByRole("radio", { name: "Blue" }).check();
  await visitor.getByRole("button", { name: "Надіслати" }).click();
  await visitor.locator("[data-survey-done]").waitFor({ timeout: 15000 }).catch(() => {});
  check("…and sends an answer", (await visitor.getByText("Дякуємо! Відповідь записано.").count()) === 1);
  const kept = sql(`select count(*) || ' ' || bool_and(public) || ' ' || bool_and(user_id is null and respondent_email is null) from public.survey_responses where object_id = '${openId}'`);
  check("…kept as an answer through the link, with no account or name", kept === "1 true true", kept);
  const direct = await fetch(`${APP}/api/f/files?ws=${alphaShort}&token=${token}&name=x.png`, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Uint8Array([137, 80, 78, 71]) });
  check("a file can't be added through the link without signing in", direct.status === 401, String(direct.status));

  // A colleague signed in adds a file to the answer.
  await colleague.goto(url);
  await colleague.locator("[data-survey-file-input]").waitFor({ timeout: 20000 }).catch(() => {});
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await colleague.locator('[data-survey-file-input] input[type="file"]').setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });
  await colleague.getByText("pixel.png").waitFor({ timeout: 20000 }).catch(() => {});
  check("someone signed in adds a file", (await colleague.getByText("pixel.png").count()) === 1);
  await colleague.getByRole("radio", { name: "Red" }).check();
  await colleague.getByRole("button", { name: "Надіслати" }).click();
  await colleague.locator("[data-survey-done]").waitFor({ timeout: 15000 }).catch(() => {});
  const withFile = sql(`select count(*) from public.survey_responses r join public.object_files f on r.answers -> 'f' ? f.id::text where r.object_id = '${openId}' and f.name = 'pixel.png' and r.respondent_email = 'colleague@alpha.test'`);
  check("…and the answer keeps the file and who sent it", withFile === "1", withFile);
  await alice.goto(`${APP}/w/${alphaShort}/surveys/${openId}`);
  await alice.getByRole("tab", { name: /Відповіді/ }).click();
  await alice.locator("[data-survey-file]").first().waitFor({ timeout: 15000 }).catch(() => {});
  const fileHref = await alice.locator("[data-survey-file]").first().getAttribute("href").catch(() => null);
  const download = fileHref ? await alice.request.get(`${APP}${fileHref}`) : null;
  check("the owner sees the answers through the link and downloads the file", (await alice.locator("[data-survey-response]").count()) === 2 && download?.status() === 200 && (download?.headers()["content-disposition"] ?? "").startsWith("attachment"), String(download?.status()));
  const peek = await visitor.request.get(`${APP}${fileHref}`);
  check("…someone without an account can't", !(peek.headers()["content-type"] ?? "").startsWith("image/png"), `${peek.status()} ${peek.headers()["content-type"]}`);

  await aliceClient.rpc("set_survey_public", { target_object: openId, enabled: false, renew: false });
  await visitor.goto(url);
  check("with the link turned off the form is gone", (await visitor.locator("[data-public-survey-missing]").count()) === 1);
  await visitor.goto(`${APP}/`);
  check("someone not signed in who opens the site sees the presentation page", visitor.url().endsWith("/about"), visitor.url());
}

await calendarChecks();
await timeOffChecks();
await repeatChecks();
await linkChecks();
await holidayChecks();
await gridChecks();
await feedChecks();
await outsideChecks();
await appsChecks();

await finish("nodes");
