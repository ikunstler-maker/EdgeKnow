// Browser smoke test, part 4: the node space — mind maps made and edited from the
// keyboard and the toolbar, saved by themselves, access like pages.
// Usage: node scripts/e2e/nodes.mjs status.json http://localhost:3000

import { APP, alice, alphaShort, check, colleague, finish, sql, until } from "./common.mjs";

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

await finish("nodes");
