// Browser smoke test, part 4: the node space — mind maps made and edited from the
// keyboard and the toolbar, saved by themselves, access like pages.
// Usage: node scripts/e2e/nodes.mjs status.json http://localhost:3000

import { APP, alice, aliceClient, alphaId, alphaShort, bob, check, colleague, finish, readdirSync, sql, until } from "./common.mjs";

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
check("a map shows on the page, and a diagram too", (await alice.locator('[data-node-embed="Order flow"] .react-flow__node').count()) === 1);
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
  const strangerPicture = await bob.evaluate(async (url) => (await fetch(url)).status, `${APP}/api/boards/files/${pictureId}?ws=${alphaShort}`).catch(() => 0);
  check("…and not for someone from another workspace", strangerPicture !== 200, String(strangerPicture));
  const fetchedAgain = alice.waitForResponse((r) => r.url().includes(`/api/boards/files/${pictureId}`), { timeout: 30000 }).then((r) => r.status()).catch(() => 0);
  await alice.reload();
  const reloadedPicture = await fetchedAgain;
  check("…after reloading the board fetches it again", reloadedPicture === 200, String(reloadedPicture));

  await bob.goto(`${APP}/w/${alphaShort}/boards/${boardId}`);
  check("someone from another workspace sees nothing of the board", (await bob.getByText("Retro").count()) === 0);
  await colleague.goto(`${APP}/w/${alphaShort}/boards`);
  check("a colleague sees the team's board in the list", (await colleague.locator('[data-board="Retro"]').count()) === 1);
}

await finish("nodes");
