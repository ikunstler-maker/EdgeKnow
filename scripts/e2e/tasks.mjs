// Browser smoke test, part 2: freezing, the angler fish, groups and Tasks (board,
// fields, links, files, tasks in the wiki, the start page).
// Usage: node scripts/e2e/tasks.mjs status.json http://localhost:3000

import {
  ANON, API, APP, alice, aliceClient, aliceCookies, alphaId, alphaPage, alphaShort, betaId, bob, bobCookies, browser, check, colleague,
  colleagueClient, colleagueCookies, colleagueId, fakeDir, finish, makeTestPng, newPage, pageContent, pageVersion, problems, readdirSync,
  results, sessionCookies, setLastPage, sql, status, until,
  newTask,
} from "./common.mjs";

// What the wiki part leaves behind and this part needs: alice is platform admin,
// and Alpha has its (stand-in) Google Drive connected.
sql("update public.profiles set is_platform_admin = true where email = 'alice@alpha.test'");
if (sql(`select count(*) from public.drive_connections where workspace_id = '${alphaId}' and active`) === "0") {
  await alice.goto(`${APP}/w/${alphaShort}/settings?tab=storage`);
  await alice.getByRole("link", { name: "Підключити Google Drive" }).click();
  await alice.waitForURL(/tab=data&drive=connected/);
}

// --- Freezing a workspace, "own database first", the central database size -------------------------
{
  const betaShort = sql(`select short_id from public.workspaces where id = '${betaId}'`);
  const frozen = await aliceClient.rpc("platform_freeze_workspace", { ws: betaId, frozen: true, reason: "E2E freeze check" });
  await bob.goto(`${APP}/w/${betaShort}`);
  check("a frozen workspace tells its members why", frozen.data?.ok === true && (await bob.getByText("Workspace «Beta» заморожено").count()) === 1 && (await bob.getByText("E2E freeze check").count()) === 1);
  await alice.goto(`${APP}/admin`);
  // Alice is not in Beta: its row shows only the short ID, no name.
  const betaRow = alice.locator("tr", { has: alice.getByText(betaShort, { exact: true }) });
  check("…the platform panel shows it frozen", (await betaRow.getByText("E2E freeze check").count()) === 1);
  check("…and the size of the central database", (await alice.locator("[data-central-usage]").getByText(/Центральна база зараз: [0-9.]+ МБ з 500 МБ/).count()) === 1);
  await betaRow.getByRole("button", { name: "Розморозити" }).click();
  await alice.waitForTimeout(1500);
  await bob.goto(`${APP}/w/${betaShort}`);
  check("…and unfrozen it opens again", sql(`select frozen_at is null from public.workspaces where id = '${betaId}'`) === "t" && (await bob.getByText("заморожено").count()) === 0);

  await alice.locator('[data-section="own-database"]').getByRole("button", { name: "Увімкнути" }).click();
  await alice.waitForTimeout(1500);
  check("the platform admin turns on \"own database first\"", sql("select require_team_database from public.platform_settings") === "t");
  await bob.goto(`${APP}/new`);
  await bob.getByLabel("Назва").fill("Bob fresh");
  await bob.getByRole("button", { name: "Створити" }).click();
  await bob.waitForURL(/\/w\/[a-z0-9]{8}$/);
  check("a new workspace asks its owner to connect a database first", (await bob.getByText("Щоб створювати сторінки, підключіть власну безкоштовну базу Supabase").count()) === 1 && (await bob.getByRole("link", { name: "Підключити базу" }).count()) === 1);
  await bob.getByRole("button", { name: "Нова сторінка" }).first().click();
  await bob.getByText("Спершу підключіть власну базу даних").first().waitFor({ timeout: 10000 }).catch(() => {});
  check("…and makes no pages until then", sql("select count(*) from public.pages p join public.workspaces w on w.id = p.workspace_id where w.name = 'Bob fresh'") === "0" && (await bob.getByText("Спершу підключіть власну базу даних").count()) > 0);
  await alice.reload();
  await alice.locator('[data-section="own-database"]').getByRole("button", { name: "Вимкнути" }).click();
  await alice.waitForTimeout(1500);
  check("…and turns it off again", sql("select require_team_database from public.platform_settings") === "f");
}

// --- The angler fish, its lure and the "Depth" game ----------------------------------------------
{
  await alice.goto(`${APP}/w/${alphaShort}/p/${alphaPage}`);
  const fish = alice.locator("[data-angler]").first();
  await fish.waitFor({ timeout: 15000 });
  await alice.waitForTimeout(900);
  const beside = async () => {
    const [f, h] = await Promise.all([fish.boundingBox(), alice.locator("aside [data-angler-here]").first().boundingBox()]);
    return Boolean(f && h && Math.abs(f.y + f.height / 2 - (h.y + h.height / 2)) < 8 && f.x + f.width <= h.x + 30);
  };
  check("the angler fish sits to the left of the current page in the tree", await beside());
  await alice.goto(`${APP}/w/${alphaShort}/trash`);
  await alice.waitForTimeout(900);
  check("…and of the trash link when that is where you are", (await alice.locator("aside [data-angler-here]").first().getAttribute("aria-label")) === "Кошик" && (await beside()));
  // Apus replaces the old «!?» button: its menu leads to feedback; it can be dragged and minimized.
  check("Apus replaces the old feedback button", (await alice.locator('[data-lure="bright"] [data-apus-button]').count()) === 1);
  await alice.locator("[data-apus-button]").click();
  await alice.locator("[data-apus-menu]").waitFor({ timeout: 10000 }).catch(() => {});
  check("…a click opens its menu with a kiss, and feedback is in it", (await alice.locator('[data-apus-item="feedback"]').count()) === 1);
  await alice.locator('[data-apus-item="feedback"]').click();
  check("…which opens the feedback form", (await alice.getByRole("dialog", { name: /відгук/i }).count()) === 1);
  await alice.keyboard.press("Escape");
  await alice.locator("[data-apus-button]").click();
  await alice.locator("[data-apus-minimize]").click();
  check("…it minimizes into a badge", (await alice.locator("[data-apus-button].h-11").count()) === 1);
  await alice.locator("[data-apus-minimize]").click();
  await alice.locator("[data-apus-button]").click();
  const apusBox = await alice.locator("[data-apus-button]").boundingBox();
  await alice.mouse.move(apusBox.x + 10, apusBox.y + 10);
  await alice.mouse.down();
  await alice.mouse.move(apusBox.x - 200, apusBox.y - 150, { steps: 10 });
  await alice.mouse.up();
  await alice.reload();
  await alice.locator("[data-apus-button]").waitFor({ timeout: 15000 });
  const movedBox = await alice.locator("[data-apus-button]").boundingBox();
  check("…it can be dragged anywhere and stays there", movedBox && movedBox.x < apusBox.x - 150, JSON.stringify([apusBox, movedBox]));
  for (let i = 0; i < 3; i++) await fish.click();
  await alice.waitForTimeout(300);
  check("a few clicks on the fish don't open the game", (await alice.locator("[data-depth-game]").count()) === 0);
  await alice.waitForTimeout(2100);
  for (let i = 0; i < 5; i++) await fish.click({ delay: 20 });
  await alice.locator("[data-depth-game]").waitFor({ timeout: 10000 }).catch(() => {});
  check("five quick clicks on the fish open “Depth”", (await alice.locator("[data-depth-game]").getByText("Глибина: 0 м").count()) === 1);
  await alice.mouse.move(300, 300);
  await alice.keyboard.press("Escape");
  check("…and Esc leaves it", (await alice.locator("[data-depth-game]").count()) === 0);

  await alice.goto(`${APP}/w/${alphaShort}/profile`);
  const look = alice.locator("[data-appearance]");
  await look.getByLabel("Показувати маленького Апуса біля поточної сторінки").uncheck();
  await alice.waitForTimeout(300);
  check("hiding the fish takes it away at once", (await alice.locator("[data-angler]").count()) === 0);
  await look.getByLabel("Приглушений (напівпрозорий)").check();
  await alice.waitForTimeout(1500);
  check("…the subdued lure is translucent white", (await alice.locator('[data-lure="subtle"]').count()) === 1 && sql("select show_mascot || ' ' || lure from public.profiles where email = 'alice@alpha.test'") === "false subtle");
  await alice.reload();
  check("…and both are remembered", (await alice.locator("[data-angler]").count()) === 0 && (await alice.locator('[data-lure="subtle"]').count()) === 1);
  await look.getByLabel("Сховати").check();
  await alice.waitForTimeout(300);
  check("a hidden lure leaves no button, but the help page still takes feedback", (await alice.locator("[data-lure]").count()) === 0);
  await alice.goto(`${APP}/help`);
  check("…“Leave feedback” on the help page", (await alice.getByRole("button", { name: "Залишити відгук" }).count()) === 1);
  await alice.goto(`${APP}/w/${alphaShort}/profile`);
  await look.getByLabel("Показувати маленького Апуса біля поточної сторінки").check();
  await look.getByLabel("Звичайний").check();
  await alice.waitForTimeout(1500);
  check("…turned back on", sql("select show_mascot || ' ' || lure from public.profiles where email = 'alice@alpha.test'") === "true bright");
}

// --- Tasks (stage 2a, step Z1) -------------------------------------------------------------------
{
  const { cookies: colleagueTaskCookies, client: colleagueTasks } = await sessionCookies("colleague@alpha.test");
  // The start page: a tile per service; those still being built say "Soon".
  await alice.goto(`${APP}/w/${alphaShort}`);
  await alice.locator('[data-service="tasks"]').waitFor({ timeout: 15000 });
  check("the start page shows every service, the unbuilt ones as “Soon”", (await alice.locator("[data-service]").count()) === 15 && (await alice.locator("[data-service]", { hasText: "Скоро" }).count()) === 6);
  check("…as a launcher: no page buttons at the top", (await alice.locator("main").getByRole("button", { name: /Нова сторінка/ }).count()) === 0);
  await alice.locator('[data-service="tasks"]').getByRole("link", { name: "Rukh" }).click();
  await alice.waitForURL(new RegExp(`/w/${alphaShort}/tasks$`), { timeout: 15000 });
  check("…and a whole tile opens its service", true);
  await alice.goto(`${APP}/w/${alphaShort}`);
  await alice.locator("[data-service-switcher]").getByRole("link", { name: "Задачі" }).click();
  await alice.waitForURL(new RegExp(`/w/${alphaShort}/tasks$`), { timeout: 15000 });
  check("…and the switcher in the sidebar opens Tasks", true);
  await alice.goto(`${APP}/w/${alphaShort}/tasks`);
  // The form opens in a dialog from the page's one primary button.
  await alice.locator("[data-new-project]").click();
  const form = alice.getByRole("form", { name: "Новий проєкт" });
  await form.getByLabel("Назва проєкту").fill("Маркетинг");
  check("the project key is suggested from its name", (await form.getByLabel(/Ключ/).inputValue()) === "MAR");
  await form.getByRole("button", { name: "Створити" }).click();
  await alice.waitForURL(new RegExp(`/w/${alphaShort}/tasks/MAR$`), { timeout: 15000 });
  check("an admin makes a project and lands on it", (await alice.getByRole("heading", { name: /Маркетинг/ }).count()) === 1);
  check("…it is in the sidebar, with the fish beside it", (await alice.locator("aside [data-angler-here]").first().innerText()).includes("Маркетинг"));
  check("…and in tasks the sidebar shows only tasks (no wiki tree, no “New page”)", (await alice.locator('aside [data-sidebar-section="tasks"]').count()) === 1 && (await alice.locator("aside").getByRole("button", { name: "Нова сторінка" }).count()) === 0 && (await alice.locator("aside").getByRole("tree").count()) === 0);
  check("…and opens on the board", (await alice.locator("[data-task-board]").count()) === 1 && (await alice.locator('[data-column="Зробити"]').count()) === 1);
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR?view=list`);
  await newTask(alice, "Draw the logo");
  await alice.locator('[data-task="MAR-1"]').waitFor({ timeout: 15000 });
  await newTask(alice, "Write the brief");
  await alice.locator('[data-task="MAR-2"]').waitFor({ timeout: 15000 });
  check("tasks are made from one line and get MAR-1, MAR-2", (await alice.locator("[data-task]").count()) === 2);
  await alice.getByLabel("Пошук за назвою чи ключем").fill("logo");
  check("the search filters the list", (await alice.locator("[data-task]").count()) === 1);
  await alice.getByLabel("Пошук за назвою чи ключем").fill("");

  // A task opens in a panel over the list; the address carries it (?task=1), so it can be shared.
  await alice.locator('[data-task="MAR-1"]').getByRole("link").click();
  await alice.waitForURL(/[?&]task=1$/);
  const openCard = alice.locator("[data-task-panel] [data-task-detail]");
  await openCard.waitFor({ timeout: 20000 });
  await alice.waitForFunction(() => document.title.startsWith("MAR-1"), null, { timeout: 10000 }).catch(() => {});
  check("a task opens over the list, with the list still there", (await alice.locator('[data-task="MAR-2"]').count()) === 1 && (await alice.title()).startsWith("MAR-1 · Rukh"), await alice.title());
  // The left panel is a tree: the project, its boards, the tasks on each with marks.
  const treeTask = alice.locator('[data-sidebar-project="MAR"] [data-sidebar-board="Основна дошка"] [data-sidebar-task="MAR-1"]');
  await treeTask.waitFor({ timeout: 15000 }).catch(() => {});
  check("the left panel lists the board's tasks with the column's colour and the priority", (await treeTask.locator("[data-status-dot]").count()) === 1 && (await treeTask.locator("[data-task-priority]").count()) === 1);
  await alice.locator("[data-task-panel-close]").click();
  await alice.locator("[data-task-panel]").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await alice.waitForURL((url) => !url.searchParams.has("task"), { timeout: 15000 }).catch(() => {});
  check("…and closes back to the list", (await alice.locator("[data-task-panel]").count()) === 0 && !/task=/.test(alice.url()), alice.url());
  await alice.locator('[data-task="MAR-1"]').getByRole("link").click();
  await openCard.waitFor({ timeout: 20000 });
  const colleagueId2 = sql("select id from public.profiles where email = 'colleague@alpha.test'");
  // On a desktop the status is a row of buttons, one per column of the board.
  await openCard.locator('[data-status-button="В роботі"]').click();
  await alice.waitForTimeout(800);
  // People are picked from a list with search, not a system list.
  await openCard.locator('[data-people="assignee"]').click();
  await alice.locator(`[data-person-option="${colleagueId2}"]`).click();
  await alice.waitForTimeout(800);
  // The priority is a list with each priority's own mark.
  await openCard.locator("[data-task-priority-field]").click();
  await alice.locator('[data-task-priority-option="high"]').click();
  await alice.waitForTimeout(800);
  const taskRow = () => sql("select s.category || ' ' || coalesce(t.assignee_id::text, '-') || ' ' || t.priority from public.tasks t join public.task_statuses s on s.id = t.status_id join public.task_projects p on p.id = t.project_id where p.key = 'MAR' and t.number = 1");
  check("the task's fields change in place", taskRow() === `doing ${colleagueId2} high`, taskRow());
  await alice.locator("[data-task-description] .bn-editor").click();
  await alice.keyboard.type("Logo in three colours");
  await alice.getByText("Збережено").last().waitFor({ timeout: 15000 }).catch(() => {});
  await alice.waitForTimeout(2500);
  check("…the description saves by itself", sql("select description::text like '%Logo in three colours%' from public.tasks t join public.task_projects p on p.id = t.project_id where p.key = 'MAR' and t.number = 1") === "t");
  await alice.getByLabel("Напишіть коментар…").fill("Please use the new palette");
  await alice.getByRole("button", { name: "Надіслати" }).click();
  await alice.locator("[data-task-comment]").first().waitFor({ timeout: 15000 });
  await alice.reload();
  // The address with ?task=1 opens the same panel again (a shared link works).
  await alice.locator("[data-task-panel] [data-task-comment]").first().waitFor({ timeout: 20000 }).catch(() => {});
  check("…comments show, and the history tells who changed what", (await alice.getByText("Please use the new palette").count()) === 1 && (await alice.getByText(/змінив\(-ла\) статус/).count()) === 1 && (await alice.getByText(/змінив\(-ла\) виконавця/).count()) === 1);

  // Everyone in the workspace edits by default; the project can make them viewers.
  const made = await colleagueTasks.rpc("create_task", { target_project: sql("select id from public.task_projects where key = 'MAR'"), fields: { title: "From a colleague" } });
  check("a member makes tasks in the project", made.data?.key === "MAR-3", JSON.stringify(made.data));
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR?view=list`);
  await alice.getByRole("button", { name: "Доступ і налаштування" }).click();
  const dialog = alice.getByRole("dialog", { name: /Доступ до проєкту/ });
  await dialog.getByRole("combobox").first().selectOption("viewer");
  await alice.waitForTimeout(1500);
  const colleagueTab = await newPage(colleagueTaskCookies);
  await colleagueTab.goto(`${APP}/w/${alphaShort}/tasks/MAR?view=list`);
  check("…until the project lets the workspace only view", (await colleagueTab.getByText("У цьому проєкті у вас лише перегляд.").count()) === 1 && (await colleagueTab.locator("[data-new-task-open]").count()) === 0);
  const refused = await colleagueTasks.rpc("create_task", { target_project: sql("select id from public.task_projects where key = 'MAR'"), fields: { title: "Not now" } });
  check("…and the database refuses their new tasks", refused.data?.error === "forbidden", JSON.stringify(refused.data));
  await colleagueTab.close();
  await colleagueTasks.auth.signOut({ scope: "local" });

  // The project's own fields: a dropdown with its items and a toggle, then values on a task.
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  await alice.getByRole("link", { name: "Поля задач" }).click();
  await alice.waitForURL(/\/tasks\/MAR\/fields$/);
  await alice.getByRole("button", { name: "Додати поле" }).click();
  const fieldForm = alice.getByRole("form", { name: "Додати поле" });
  await fieldForm.getByLabel("Назва поля").fill("Формат");
  await fieldForm.getByLabel("Формат", { exact: true }).selectOption("select");
  await fieldForm.getByLabel("Пункт 1").fill("Відео");
  await fieldForm.getByRole("button", { name: "Додати пункт" }).click();
  await fieldForm.getByLabel("Пункт 2").fill("Статика");
  await fieldForm.getByRole("button", { name: "Зберегти" }).click();
  await alice.locator('[data-custom-field="Формат"]').waitFor({ timeout: 15000 });
  await alice.getByRole("button", { name: "Додати поле" }).click();
  await alice.getByRole("form", { name: "Додати поле" }).getByLabel("Назва поля").fill("Погоджено");
  await alice.getByRole("form", { name: "Додати поле" }).getByLabel("Формат", { exact: true }).selectOption("toggle");
  await alice.getByRole("form", { name: "Додати поле" }).getByRole("button", { name: "Зберегти" }).click();
  await alice.locator('[data-custom-field="Погоджено"]').waitFor({ timeout: 15000 });
  check("the project owner defines own fields, with list items", sql("select string_agg(f.name || ':' || f.kind || ':' || jsonb_array_length(f.options), ',' order by f.position) from public.task_fields f join public.task_projects p on p.id = f.project_id where p.key = 'MAR'") === "Формат:select:2,Погоджено:toggle:0");
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/1`);
  await alice.locator('[data-field="Формат"] select').selectOption({ label: "Відео" });
  await alice.waitForTimeout(1000);
  await alice.getByRole("switch", { name: "Погоджено" }).click();
  await alice.waitForTimeout(1500);
  const values = sql("select (select string_agg(f.name || '=' || coalesce(f.options -> 0 ->> 'label', '') || (t.custom -> f.id::text)::text, ',' order by f.position) from public.task_fields f where f.project_id = t.project_id and t.custom ? f.id::text) from public.tasks t join public.task_projects p on p.id = t.project_id where p.key = 'MAR' and t.number = 1");
  check("…and a task gets values in them", /^Формат=Відео".+",Погоджено=true$/.test(values), values);
  // The project's owner puts the card's fields in order by dragging (the order is the project's).
  const fieldOrder = () => sql("select string_agg(f.name, ',' order by f.position) from public.task_fields f join public.task_projects p on p.id = f.project_id where p.key = 'MAR'");
  const dragField = async (name, onto) => {
    const from = await alice.locator(`[data-key-field="${name}"] [data-key-field-handle]`).boundingBox();
    const to = await alice.locator(`[data-key-field="${onto}"]`).boundingBox();
    if (!from || !to) return;
    await alice.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await alice.mouse.down();
    await alice.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 3 });
    await alice.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await alice.mouse.up();
  };
  await dragField("Погоджено", "Формат");
  check("the project's owner reorders the card's fields by dragging", await until(() => fieldOrder() === "Погоджено,Формат", 15000), fieldOrder());
  await alice.waitForTimeout(800);
  await dragField("Формат", "Погоджено");
  check("…and back", await until(() => fieldOrder() === "Формат,Погоджено", 15000), fieldOrder());
  // An admin adds a field right in the task, without the fields page.
  await alice.locator("[data-quick-add-field]").click();
  await alice.getByRole("form", { name: "Додати поле" }).getByLabel("Назва").fill("Inline");
  await alice.getByRole("form", { name: "Додати поле" }).getByRole("button", { name: "Зберегти" }).click();
  await alice.locator('[data-field="Inline"]').waitFor({ timeout: 15000 }).catch(() => {});
  check("…and adds a field right in a task", (await alice.locator('[data-field="Inline"]').count()) === 1);
  // …and removes it there too (the project's owner; the field goes from every task).
  await alice.locator('[data-key-field="Inline"] [data-key-field-remove]').click();
  check("…and removes a field right in a task", await until(() => sql("select count(*) from public.task_fields where name = 'Inline'") === "0", 15000) && (await alice.locator('[data-key-field="Inline"]').waitFor({ state: "detached", timeout: 15000 }).then(() => true).catch(() => false)));
  sql("delete from public.task_fields where name = 'Inline'");
  // More kinds of fields: a list of countries with tick boxes and an own value, a duration, a field's width, a copy.
  const quickField = async (name, kind) => {
    await alice.locator("[data-quick-add-field]").click();
    const form = alice.getByRole("form", { name: "Додати поле" });
    await form.getByLabel("Назва").fill(name);
    await form.getByLabel("Формат", { exact: true }).selectOption(kind);
    await form.getByRole("button", { name: "Зберегти" }).click();
    await alice.locator(`[data-field="${name}"]`).waitFor({ timeout: 15000 }).catch(() => {});
  };
  const customOf = (name) => sql(`select (t.custom -> f.id::text)::text from public.tasks t join public.task_projects p on p.id = t.project_id join public.task_fields f on f.project_id = p.id and f.name = '${name}' where p.key = 'MAR' and t.number = 1`);
  await quickField("Гео", "geo");
  await alice.locator('button[data-multi="Гео"]').click();
  await alice.locator('[data-multi-option="UA"]').check();
  await alice.locator('[data-multi-option="PL"]').check();
  await alice.locator("[data-multi-other]").fill("Марс");
  await alice.locator("[data-multi-other-add]").click();
  check("a list of countries takes several codes and an own value", await until(() => customOf("Гео") === '["UA", "PL", "other:Марс"]', 15000), customOf("Гео"));
  await alice.keyboard.press("Escape");
  check("…and shows the chosen ones as chips with the full name in a hint", (await alice.locator('[data-multi="Гео"] [data-multi-chosen] span[title="Україна"]').count()) === 1);
  await quickField("Хронометраж", "duration");
  await alice.locator('[data-duration="Хронометраж"] [data-duration-part="h"]').fill("1");
  await alice.locator('[data-duration="Хронометраж"] [data-duration-part="m"]').fill("30");
  await alice.locator("[data-task-detail] h1, [data-task-detail] textarea").first().click();
  check("a duration is kept in seconds", await until(() => customOf("Хронометраж") === "5400", 15000), customOf("Хронометраж"));
  await alice.locator('[data-key-field="Гео"]').hover();
  await alice.locator('[data-key-field="Гео"] [data-key-field-copy]').click();
  check("a field is copied right in a task", await until(() => sql("select kind from public.task_fields where name = 'Гео (копія)'") === "geo", 15000));
  await alice.locator('[data-key-field="Гео"]').hover();
  await alice.locator('[data-key-field="Гео"] [data-key-field-edit]').click();
  await alice.locator('[data-edit-field="Гео"] [data-field-width]').selectOption("half");
  await alice.locator('[data-edit-field="Гео"]').getByRole("button", { name: "Зберегти" }).click();
  check("…and edited there: half the width", await until(() => sql("select width from public.task_fields where name = 'Гео'") === "half", 15000));
  // …and drawn so: the field takes half of the fields' block, not all of it.
  const drawnShare = async () => {
    const field = await alice.locator('[data-key-field="Гео"]').boundingBox().catch(() => null);
    const block = await alice.locator("[data-task-key-fields]").boundingBox();
    return field && block ? field.width / block.width : 1;
  };
  for (let i = 0; i < 50 && (await drawnShare()) >= 0.6; i++) await alice.waitForTimeout(300);
  check("…and drawn half as wide", (await drawnShare()) < 0.6, String(await drawnShare()));
  sql("delete from public.task_fields where name in ('Гео', 'Гео (копія)', 'Хронометраж')");
  sql("update public.tasks t set custom = coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(t.custom) e where exists (select 1 from public.task_fields f where f.id::text = e.key)), '{}'::jsonb) where t.custom <> '{}'::jsonb");

  // The board: quick add in a column, drag a card to another, a column limit, what the card shows.
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  // A column folds to a narrow strip (its cards are not drawn) and the choice is remembered.
  await alice.locator("[data-task-board] [data-fold-column]").first().waitFor({ timeout: 20000 });
  await alice.locator("[data-task-board] [data-fold-column]").first().click();
  await alice.reload();
  await alice.locator("[data-column-folded]").first().waitFor({ timeout: 20000 }).catch(() => {});
  check("a board column folds, and stays folded after a reload", (await alice.locator("[data-column-folded]").count()) === 1);
  await alice.locator("[data-column-folded] button").first().click();
  await alice.locator("[data-task-board]").waitFor();
  await newTask(alice, "Board task", "Зробити");
  const card = alice.locator('[data-card="MAR-4"]');
  await card.waitFor({ timeout: 15000 });
  check("a task is added right in a column", (await alice.locator('[data-column="Зробити"] [data-card="MAR-4"]').count()) === 1);
  const from = await card.boundingBox();
  const to = await alice.locator('[data-column="Готово"]').boundingBox();
  await alice.mouse.move(from.x + 20, from.y + 10);
  await alice.mouse.down();
  await alice.mouse.move(from.x + 40, from.y + 20, { steps: 5 });
  await alice.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 15 });
  await alice.mouse.up();
  await alice.locator('[data-column="Готово"] [data-card="MAR-4"]').waitFor({ timeout: 10000 }).catch(() => {});
  await alice.waitForTimeout(1500);
  const moved = () => sql("select s.name from public.tasks t join public.task_statuses s on s.id = t.status_id join public.task_projects p on p.id = t.project_id where p.key = 'MAR' and t.number = 4");
  check("…dragged to “Готово” it is done, there and in the database", (await alice.locator('[data-column="Готово"] [data-card="MAR-4"]').count()) === 1 && moved() === "Готово", moved());
  // Time in columns, from the task history: the first column counts, the last one is off by default.
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/4`);
  await alice.locator("[data-column-time]").waitFor({ timeout: 15000 }).catch(() => {});
  check("the task shows time in the column it left, not in the last one", (await alice.locator('[data-column-time-item="Зробити"]').count()) === 1 && (await alice.locator('[data-column-time-item="Готово"]').count()) === 0);
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  await alice.locator("[data-task-board]").waitFor({ timeout: 15000 });
  await alice.getByRole("button", { name: "Колонка «В роботі»" }).click();
  const columnForm = alice.getByRole("form", { name: "Колонка «В роботі»" });
  await columnForm.getByLabel("Ліміт задач у колонці").fill("1");
  await columnForm.getByRole("button", { name: "Зберегти" }).click();
  await alice.locator('[data-column="В роботі"] [data-wip]', { hasText: "1/1" }).waitFor({ timeout: 15000 }).catch(() => {});
  check("a column limit shows as count/limit", (await alice.locator('[data-column="В роботі"] [data-wip]').innerText()) === "1/1");
  await alice.getByRole("button", { name: "Що показувати на картці" }).click();
  const cardDialog = alice.getByRole("dialog", { name: "Що показувати на картці" });
  await cardDialog.getByLabel("Автор").check();
  await cardDialog.getByLabel("Формат", { exact: true }).check();
  await cardDialog.getByRole("button", { name: "Зберегти" }).click();
  await alice.locator('[data-card="MAR-1"] [data-card-field="Формат"]').waitFor({ timeout: 15000 }).catch(() => {});
  check("the card shows the chosen fields, own ones too", (await alice.locator('[data-card="MAR-1"] [data-card-field="Формат"]').getByText("Відео").count()) === 1);
  await cardDialog.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await alice.getByRole("button", { name: "Що показувати на картці" }).click();
  await cardDialog.getByLabel("Початок").check();
  await cardDialog.getByRole("button", { name: "Зберегти" }).click();
  await cardDialog.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  check("…a chosen field with nothing in it takes no room on the card", (await alice.locator('[data-card="MAR-1"] [data-card-field="Початок"]').count()) === 0 && (await alice.locator('[data-card="MAR-1"] [data-card-field="Формат"]').count()) === 1);
  const marOnePriority = () => sql("select priority from public.tasks t join public.task_projects p on p.id = t.project_id where p.key = 'MAR' and t.number = 1");
  const priorityBefore = marOnePriority();
  // The priority mark on the card opens a small list.
  const pickPriority = async (value) => {
    await alice.locator('[data-card="MAR-1"] [data-card-priority]').click();
    await alice.locator(`[data-card-menu="priority"] [data-priority-option="${value}"]`).click();
  };
  await pickPriority("highest");
  check("the priority changes right on the card", await until(() => marOnePriority() === "highest", 15000), marOnePriority());
  await pickPriority(priorityBefore);
  await until(() => marOnePriority() === priorityBefore, 15000);

  // Notification rules (the project owner) and the bell.
  await alice.locator("[data-open-rules]").click();
  await alice.locator("[data-rule-event]").selectOption("comment");
  await alice.locator('[data-rule-role="reporter"]').check();
  await alice.locator("[data-rule-add]").click();
  await alice.locator("[data-task-rule]").first().waitFor({ timeout: 10000 }).catch(() => {});
  const savedRule = sql("select event || ' ' || array_to_string(notify_roles, ',') from public.task_rules");
  check("the project owner adds a notification rule", savedRule === "comment reporter", savedRule);
  await alice.keyboard.press("Escape");

  // A column's own button (short name and colour) and its own notifications.
  await alice.locator('[data-column="В роботі"]').getByRole("button", { name: "Колонка «В роботі»", exact: true }).click();
  await alice.locator("[data-column-short-name]").fill("Роблю");
  await alice.locator('[data-column-color="#22c55e"]').click();
  await alice.locator("[data-column-save]").click();
  const buttonOf = () => sql("select coalesce(short_name, '') || ' ' || coalesce(color, '') from public.task_statuses where name = 'В роботі' and project_id = (select id from public.task_projects where key = 'MAR')");
  check("the project owner gives a column a short name and a colour", await until(() => buttonOf() === "Роблю #22c55e", 15000), buttonOf());
  await alice.reload();
  await alice.locator("[data-task-board]").waitFor({ timeout: 20000 });
  await alice.locator('[data-column="В роботі"]').getByRole("button", { name: "Колонка «В роботі»", exact: true }).click();
  await alice.locator("[data-column-rules]").click();
  const columnEvents = await alice.locator("[data-rule-event] option").evaluateAll((els) => els.map((el) => el.value).join(","));
  check("the column's menu opens its own notifications: came, left, changed there", columnEvents === "enter_status,leave_status,change_in_status", columnEvents);
  await alice.locator("[data-rule-event]").selectOption("leave_status");
  await alice.locator('[data-rule-role="reporter"]').check();
  await alice.locator("[data-rule-add]").click();
  const leaveRule = () => sql("select count(*) from public.task_rules r join public.task_statuses s on s.id = r.status_id where r.event = 'leave_status' and s.name = 'В роботі'");
  check("…and a rule made there is about that column", await until(() => leaveRule() === "1", 15000), leaveRule());
  sql("delete from public.task_rules where event = 'leave_status'");
  await alice.keyboard.press("Escape");
  await alice.locator('[data-card="MAR-1"]').getByRole("link").first().click();
  await alice.locator("[data-task-panel] [data-status-buttons], [data-status-buttons]").first().waitFor({ timeout: 20000 }).catch(() => {});
  const shortShown = await alice.locator('[data-status-button="В роботі"]').first().innerText().catch(() => "");
  check("the task's status button shows the column's short name", shortShown.trim() === "Роблю", shortShown);
  await alice.locator("[data-task-panel-close]").click().catch(() => {});
  await alice.waitForURL((url) => !url.searchParams.has("task"), { timeout: 15000 }).catch(() => {});

  // Analytics: the owner sees the team and every person (only counts).
  await alice.goto(`${APP}/w/${alphaShort}/analytics?days=30`);
  await alice.locator("[data-analytics-team]").waitFor({ timeout: 15000 }).catch(() => {});
  check("the owner sees the team's analytics and everyone's numbers", (await alice.locator("[data-analytics-team]").count()) === 1 && (await alice.locator("[data-analytics-person]").count()) >= 2);
  // Templates: «Save as template» from a task; the project's default fills in a new task.
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/1`);
  await alice.locator("[data-save-template]").click();
  await alice.locator("[data-template-name]").fill("Відео");
  await alice.getByLabel("Початок назви задачі (необов’язково)").fill("Відео: ");
  await alice.locator('[data-template-scope="project"]').check();
  await alice.getByLabel("Підставляти в нові задачі автоматично").check();
  await alice.locator("[data-template-save]").click();
  check("a task is saved as the project's default template", await until(() => sql("select name || ' ' || is_default || ' ' || (owner_id is null) from public.task_templates") === "Відео true true", 15000), sql("select count(*) from public.task_templates"));
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR?view=list`);
  await alice.locator("[data-template-picker]", { hasText: "Відео" }).waitFor({ timeout: 15000 }).catch(() => {});
  await newTask(alice, "Ролик");
  const fromTemplate = () => sql("select t.priority = (select priority from public.tasks x join public.task_projects q on q.id = x.project_id where q.key = 'MAR' and x.number = 1) from public.tasks t where t.title = 'Відео: Ролик'");
  check("…and a new task starts from it", await until(() => fromTemplate() === "t", 15000), fromTemplate());
  await alice.locator("[data-template-picker]").click();
  await alice.locator('[data-template-tab="mine"]').click();
  check("…personal templates are on their own tab", (await alice.locator('[data-template-option="Відео"]').count()) === 0);
  await alice.keyboard.press("Escape");
  // Clean up so the tasks below keep their numbers and plain titles.
  sql("delete from public.task_templates; delete from public.tasks where title = 'Відео: Ролик'; update public.task_projects set next_number = next_number - 1 where key = 'MAR'");

  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  await alice.locator("[data-task-board]").waitFor({ timeout: 15000 });

  // A team's own board: a tab of its own, with its own columns.
  await alice.locator("[data-board-add]").click();
  await alice.locator("[data-board-name]").fill("QA");
  await alice.locator("[data-board-save]").click();
  await alice.locator('[data-board-tab="QA"]').waitFor({ timeout: 15000 }).catch(() => {});
  await alice.locator('[data-board-tab="QA"]').click().catch(() => {});
  check("the owner adds a team board, which starts with no columns", sql("select name from public.task_boards") === "QA" && (await alice.locator("[data-column]").count()) === 0, sql("select count(*) from public.task_boards"));
  await alice.locator('[data-board-tab="Основна дошка"]').click();
  const marOneId = sql("select t.id from public.tasks t join public.task_projects p on p.id = t.project_id where p.key = 'MAR' and t.number = 1");
  const aliceUserId = sql("select id from public.profiles where email = 'alice@alpha.test'");
  // The colleague (signed out above, and only a viewer now) acts through the database for a moment.
  const asColleague = (call) =>
    sql(`begin; update public.task_projects set workspace_role = 'editor' where key = 'MAR'; set local role authenticated; set local request.jwt.claim.sub = '${colleagueId2}'; select ${call}; reset role; update public.task_projects set workspace_role = 'viewer' where key = 'MAR'; commit;`);
  asColleague(`public.add_task_comment('${marOneId}', 'Ping', array['${aliceUserId}']::uuid[])`);
  const pinged = { data: { ok: sql(`select count(*) from public.task_comments where task_id = '${marOneId}' and body = 'Ping'`) === "1" } };
  await alice.evaluate(() => window.dispatchEvent(new Event("focus")));
  await alice.locator("[data-notification-bell] [data-unread]").waitFor({ timeout: 15000 }).catch(() => {});
  check("…a colleague's mention lights the bell", pinged.data?.ok === true && (await alice.locator("[data-notification-bell] [data-unread]").count()) === 1, JSON.stringify(pinged.data));
  await alice.locator("[data-notification-bell]").click();
  await alice.locator('[data-notification="mention"]').first().waitFor({ timeout: 10000 }).catch(() => {});
  check("…and the list names the task", ((await alice.locator('[data-notification="mention"]').first().innerText().catch(() => "")) || "").includes("MAR-1"));
  await alice.keyboard.press("Escape");

  const boardWidth = await alice.locator("[data-project-main]").evaluate((el) => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
  check("the board uses the whole width next to the sidebar", boardWidth > 0.95, String(boardWidth));
  await alice.getByRole("button", { name: "Лише мої" }).click();
  check("“Only mine” filters the board", (await alice.locator("[data-card]").count()) === 0);
  await alice.getByRole("button", { name: "Скинути фільтри" }).click();
  check("…and clearing brings them back", (await alice.locator("[data-card]").count()) === 4);

  // Step Z3: subtasks with progress, links ("blocked by"), checklist → subtasks, bulk changes, epics.
  const marTask = (number) => `(select t.id from public.tasks t join public.task_projects p on p.id = t.project_id where p.key = 'MAR' and t.number = ${number})`;
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/2`);
  const subInput = alice.getByLabel("Нова підзадача — назва і Enter");
  await subInput.fill("Sub one");
  await subInput.press("Enter");
  await alice.locator('[data-subtask="MAR-5"]').waitFor({ timeout: 15000 });
  await subInput.fill("Sub two");
  await subInput.press("Enter");
  await alice.locator('[data-subtask="MAR-6"]').waitFor({ timeout: 15000 });
  check("subtasks are added under a task", sql(`select count(*) from public.tasks where parent_id = ${marTask(2)}`) === "2" && (await alice.locator("[data-progress]").innerText()) === "Готово 0 з 2");
  await alice.getByLabel("Позначити «Sub one» готовою").click();
  await alice.getByText("Готово 1 з 2").waitFor({ timeout: 15000 }).catch(() => {});
  check("…ticking one makes it done and moves the progress", (await alice.locator("[data-progress]").innerText()) === "Готово 1 з 2" && sql(`select s.category from public.tasks t join public.task_statuses s on s.id = t.status_id where t.id = ${marTask(5)}`) === "done");
  await alice.locator("[data-parent-picker]").click();
  await alice.locator("[data-parent-options]").waitFor({ timeout: 15000 });
  check("…a task can't move under its own subtask", (await alice.locator('[data-parent-option="MAR-5"]').count()) === 0 && (await alice.locator('[data-parent-option="MAR-3"]').count()) === 1);
  await alice.keyboard.press("Escape");
  const links = alice.locator("[data-links]");
  await links.getByLabel("Вид зв'язку").selectOption("blocked_by");
  // The other task is found while typing (by key or by words of its title) and picked from the offers.
  await links.getByLabel("Назва або ключ задачі (MKT-12)").fill("mar-1");
  await links.locator('[data-link-offer="MAR-1"]').click();
  await alice.locator('[data-link="MAR-1"]').waitFor({ timeout: 15000 });
  check("a link by key: MAR-2 is blocked by MAR-1", sql(`select kind from public.task_links where source_id = ${marTask(1)} and target_id = ${marTask(2)}`) === "blocks" && (await alice.locator("[data-blocked-notice]").count()) === 1);
  await links.getByLabel("Назва або ключ задачі (MKT-12)").fill("NOPE-1");
  await links.getByRole("button", { name: "Зв'язати" }).click();
  await alice.getByText("Задачу не знайдено або у вас немає до неї доступу.").last().waitFor({ timeout: 15000 }).catch(() => {});
  check("…a key no one can see is refused", sql(`select count(*) from public.task_links where target_id = ${marTask(2)} or source_id = ${marTask(2)}`) === "1");
  sql(`update public.tasks set description = '[{"id":"c1","type":"checkListItem","props":{"checked":false},"content":[{"type":"text","text":"Check fonts","styles":{}}],"children":[]},{"id":"c2","type":"checkListItem","props":{"checked":true},"content":[{"type":"text","text":"Done already","styles":{}}],"children":[]}]' where id = ${marTask(2)}`);
  await alice.reload();
  await alice.getByRole("button", { name: "Зробити підзадачі з чек-листа опису" }).click();
  await alice.getByText("Створено підзадач: 1").waitFor({ timeout: 15000 }).catch(() => {});
  check("the open checklist items become subtasks", sql(`select string_agg(title, ',' order by number) from public.tasks where parent_id = ${marTask(2)}`) === "Sub one,Sub two,Check fonts");
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  await alice.locator("[data-task-board]").waitFor();
  check("the board shows the blocked task and the subtask progress", (await alice.locator('[data-card="MAR-2"] [data-card-blocked]').count()) === 1 && (await alice.locator('[data-card="MAR-1"] [data-card-blocked]').count()) === 0);

  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR?view=list`);
  await alice.getByLabel("Вибрати MAR-5").check();
  await alice.getByLabel("Вибрати MAR-6").check();
  const bar = alice.locator("[data-bulk-bar]");
  check("selecting tasks opens the bulk bar", (await bar.getByText("Вибрано: 2").count()) === 1);
  await bar.getByLabel("Пріоритет…").selectOption("highest");
  await alice.getByText("Змінено задач: 2").waitFor({ timeout: 15000 }).catch(() => {});
  check("…one choice changes all of them", sql(`select string_agg(priority, ',') from public.tasks where id in (${marTask(5)}, ${marTask(6)})`) === "highest,highest");
  await bar.getByLabel("Додати мітку").fill("design");
  await bar.getByLabel("Додати мітку").press("Enter");
  check("…and adds a label to each", await until(() => sql(`select count(*) from public.tasks where id in (${marTask(5)}, ${marTask(6)}) and 'design' = any (labels)`) === "2", 15000));
  await bar.getByRole("button", { name: "Зняти вибір" }).click();
  await alice.getByLabel("Вибрати MAR-3").check();
  await alice.locator("[data-bulk-bar]").getByLabel("Тип…").selectOption("epic");
  await until(() => sql(`select type from public.tasks where id = ${marTask(3)}`) === "epic", 15000);
  await alice.locator("[data-bulk-bar]").getByLabel("Епік…").locator("option", { hasText: "MAR-3 From a colleague" }).waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
  await alice.locator("[data-bulk-bar]").getByRole("button", { name: "Зняти вибір" }).click();
  await alice.getByLabel("Вибрати MAR-1").check();
  await alice.locator("[data-bulk-bar]").getByLabel("Епік…").selectOption({ label: "MAR-3 From a colleague" });
  check("a task joins an epic", await until(() => sql(`select parent_id = ${marTask(3)} from public.tasks where id = ${marTask(1)}`) === "t", 15000));
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/3`);
  check("…and the epic lists its tasks with progress", (await alice.getByRole("region", { name: "Задачі епіку" }).locator('[data-subtask="MAR-1"]').count()) === 1 && (await alice.locator("[data-progress]").innerText()) === "Готово 0 з 1");
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/1`);
  check("…and the task shows its epic above the title", (await alice.locator("[data-parent-link]").innerText()).includes("MAR-3"));

  // Files in tasks go where the whole workspace keeps its files (step U1): here
  // the wiki's Google Drive. Nobody is asked to connect a Drive of their own.
  const marFile = () => sql(`select storage_backend || ':' || coalesce(drive_source, '-') from public.task_files where task_id = ${marTask(2)} and name = 'brief.pdf'`);
  const pdf = { name: "brief.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n") };
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/2`);
  await alice.locator("[data-task-files] input[type=file]").setInputFiles(pdf);
  await alice.locator('[data-task-file="brief.pdf"]').waitFor({ timeout: 15000 });
  // Time tracking: off until the project's owner turns it on; then a person logs time.
  check("a task shows no time until the project tracks it", (await alice.locator("[data-task-time]").count()) === 0);
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  await alice.getByRole("button", { name: "Доступ і налаштування" }).click();
  await alice.locator("[data-time-enable]").check();
  check("the project's owner turns time tracking on", await until(() => sql("select time_tracking || ' ' || time_visibility from public.task_projects where key = 'MAR'") === "true assignee", 15000));
  await alice.locator("[data-time-visibility]").selectOption("owners");
  await until(() => sql("select time_visibility from public.task_projects where key = 'MAR'") === "owners", 15000);
  await alice.keyboard.press("Escape");
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/2`);
  await alice.locator("[data-task-time-add]").click();
  await alice.locator("[data-task-time-amount]").fill("1 год 30 хв");
  await alice.locator("[data-task-time-save]").click();
  const logged = () => sql(`select coalesce(sum(minutes), 0) from public.task_time_entries where task_id = ${marTask(2)}`);
  await until(() => logged() === "90", 15000);
  // The card shows the new total once the page has the saved entry.
  const totalShown = await alice.locator("[data-task-time-total]", { hasText: "1 год 30 хв" }).waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check("a person writes down the time spent on a task", logged() === "90" && totalShown, `${logged()} / ${await alice.locator("[data-task-time-total]").innerText().catch(() => "")}`);
  // «Мої задачі»: the person's open tasks from every project.
  await alice.goto(`${APP}/w/${alphaShort}/tasks`);
  await alice.locator("[data-open-my-tasks]").click();
  await alice.waitForURL(/\/tasks\/mine$/);
  const mine = await alice.locator("[data-my-task]").count();
  const expectedMine = sql(`select count(*) from public.tasks t join public.task_statuses s on s.id = t.status_id join public.task_projects p on p.id = t.project_id where t.assignee_id = (select id from public.profiles where email = 'alice@alpha.test') and t.deleted_at is null and t.done_at is null and s.category <> 'done' and p.archived_at is null and not t.private`);
  check("“My tasks” lists the person's open tasks from every project", mine >= Number(expectedMine) && (mine > 0 || (await alice.locator("[data-my-tasks-none]").count()) === 1), `${mine} vs ${expectedMine}`);
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/2`);
  await alice.locator('[data-task-file="brief.pdf"]').waitFor({ timeout: 20000 }).catch(() => {});
  // Files show as tiles or as a list (kept in this browser); a link is kept next to them.
  await alice.locator('[data-task-file="brief.pdf"]').waitFor({ timeout: 20000 }).catch(() => {});
  const tiles = await alice.locator("[data-task-files-tiles]").count();
  await alice.locator('[data-task-files-view="list"]').click();
  check("a task's files show as tiles, or as a list", tiles === 1 && (await alice.locator('[data-task-files-list] [data-task-file="brief.pdf"]').count()) === 1);
  await alice.locator("[data-task-web-link-open]").click();
  await alice.locator("[data-task-web-link-url]").fill("https://example.com/spec");
  await alice.locator("[data-task-web-link-title]").fill("Spec elsewhere");
  await alice.locator("[data-task-web-link-save]").click();
  await alice.locator('[data-task-web-link="Spec elsewhere"]').waitFor({ timeout: 20000 }).catch(() => {});
  check("a link is kept with the task next to its files", sql("select title || ' ' || url from public.task_web_links") === "Spec elsewhere https://example.com/spec" && (await alice.locator('[data-task-web-link="Spec elsewhere"] a').getAttribute("href")) === "https://example.com/spec");
  const cardOrder = await alice.evaluate(() => {
    const top = (selector) => document.querySelector(selector)?.getBoundingClientRect().top ?? -1;
    return [top("[data-status-row]"), top("[data-task-detail] textarea"), top("[data-task-key-fields]"), top("[data-task-files]")];
  });
  check("the card reads: statuses, title, the project's own fields, description, files", cardOrder[0] >= 0 && cardOrder[0] < cardOrder[1] && (cardOrder[2] < 0 || cardOrder[1] < cardOrder[2]) && cardOrder[1] < cardOrder[3] && (await alice.locator("[data-task-status]").isVisible()) === false && (await alice.locator("[data-task-side-blocks] [data-mentioned-on]").count()) === 1, JSON.stringify(cardOrder));
  // The project's own permissions: the owner says who may do an action; the usual rule comes back with a reset.
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  await alice.getByRole("button", { name: "Доступ і налаштування" }).click();
  await alice.locator("[data-project-permissions] > summary").click();
  await alice.locator('[data-permission="transition"] [data-permission-role="editor"]').uncheck();
  await alice.locator('[data-permission="transition"] [data-permission-assignee]').check();
  const moveRule = () => sql("select array_to_string(p.roles, ',') || '|' || p.assignee || '|' || p.reporter from public.task_permissions p join public.task_projects t on t.id = p.project_id where t.key = 'MAR' and p.action = 'transition'");
  check("the project's owner lets only the assignee move tasks", await until(() => moveRule() === "|true|false", 15000), moveRule());
  check("…and still moves them herself (owners always may)", sql(`select public.task_action_allowed((select id from public.task_projects where key = 'MAR'), 'transition', null::public.tasks, (select id from public.profiles where email = 'alice@alpha.test'))`) === "t");
  // Comments, attachments and time have their own rows ("one's own" apart from "anyone's").
  const shownGroups = await alice.locator("[data-permission-group-of]").evaluateAll((els) => els.map((el) => el.getAttribute("data-permission-group-of")).join(","));
  await alice.locator('[data-permission="comment_add"] [data-permission-role="viewer"]').check();
  const commentRule = () => sql("select array_to_string(array(select unnest(p.roles) order by 1), ',') from public.task_permissions p join public.task_projects t on t.id = p.project_id where t.key = 'MAR' and p.action = 'comment_add'");
  check("the permissions cover tasks, comments, attachments and time; viewers are let to comment", shownGroups === "tasks,comments,files,time" && (await until(() => commentRule() === "commenter,editor,viewer", 15000)), `${shownGroups} / ${commentRule()}`);
  await alice.locator('[data-permission="comment_add"] [data-permission-reset]').click();
  await until(() => commentRule() === "", 15000);
  await alice.locator('[data-permission="transition"] [data-permission-reset]').click();
  check("…and the usual rule comes back", await until(() => sql("select count(*) from public.task_permissions p join public.task_projects t on t.id = p.project_id where t.key = 'MAR'") === "0", 15000));
  await alice.keyboard.press("Escape");
  // A task repeats: every N days, weeks, months or years; the daily job makes the copies.
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/2`);
  await alice.locator("[data-task-repeat-open]").click();
  await alice.locator("[data-task-repeat-every]").fill("3");
  await alice.locator("[data-task-repeat-unit]").selectOption("day");
  await alice.locator("[data-task-repeat-save]").click();
  const repeatRule = () => sql(`select every_n || ' ' || unit || ' ' || (next_on - current_date) from public.task_recurrences where task_id = ${marTask(2)}`);
  check("a task is set to repeat every three days", await until(() => repeatRule() === "3 day 1", 15000) && (await alice.locator("[data-task-repeat-summary]", { hasText: "кожні 3" }).waitFor({ timeout: 15000 }).then(() => true).catch(() => false)), repeatRule());
  sql(`update public.task_recurrences set next_on = current_date where task_id = ${marTask(2)}`);
  const tasksBeforeRepeat = Number(sql("select count(*) from public.tasks t join public.task_projects p on p.id = t.project_id where p.key = 'MAR'"));
  const repeatMade = sql("select public.run_task_recurrences() ->> 'made'");
  const repeatCopy = sql(`select t.title = (select title from public.tasks where id = ${marTask(2)}) and t.start_date = current_date from public.tasks t join public.task_projects p on p.id = t.project_id where p.key = 'MAR' order by t.number desc limit 1`);
  check("…and on its day a copy of the task appears", repeatMade === "1" && repeatCopy === "t" && Number(sql("select count(*) from public.tasks t join public.task_projects p on p.id = t.project_id where p.key = 'MAR'")) === tasksBeforeRepeat + 1, `${repeatMade} ${repeatCopy}`);
  await alice.reload();
  await alice.locator("[data-task-repeat-open]").click();
  await alice.locator("[data-task-repeat-stop]").click();
  check("…until the repeating is stopped (the copy stays)", await until(() => sql("select count(*) from public.task_recurrences") === "0", 15000));
  sql("delete from public.tasks where id = (select t.id from public.tasks t join public.task_projects p on p.id = t.project_id where p.key = 'MAR' order by t.number desc limit 1)");
  sql("update public.task_projects set next_number = next_number - 1 where key = 'MAR'");
  // Larger attachments: a workspace admin raises the project's limit; a file over 4 MB then
  // goes to the team's Drive in parts; set back, the usual limit holds again.
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  await alice.getByRole("button", { name: "Доступ і налаштування" }).click();
  await alice.locator("[data-file-limit]").fill("20");
  await alice.locator("[data-file-limits-save]").click();
  check("a workspace admin raises the project's attachment limit", await until(() => sql("select file_limit_mb || ' ' || zip_limit_mb from public.task_projects where key = 'MAR'") === "20 4", 15000));
  await alice.keyboard.press("Escape");
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/2`);
  const heavy = Buffer.alloc(9 * 1024 * 1024, 3);
  heavy.write("HEAVY-ATTACHMENT", 0);
  await alice.locator("[data-task-files] input[type=file]").setInputFiles({ name: "raw.footage", mimeType: "application/x-footage", buffer: heavy });
  const heavyRow = () => sql(`select storage_backend || ' ' || large || ' ' || bytes || ' ' || mime_type || ' ' || coalesce(drive_file_id, '-') from public.task_files where task_id = ${marTask(2)} and name = 'raw.footage'`);
  await until(() => heavyRow().startsWith("drive "), 60000);
  const heavyParts = heavyRow().split(" ");
  const { statSync: sizeOf } = await import("node:fs");
  const heavyOnDrive = heavyParts[4] && heavyParts[4] !== "-" ? sizeOf(`${process.env.DRIVE_FAKE_DIR}/${heavyParts[4]}`, { throwIfNoEntry: false })?.size : 0;
  check("a file over 4 MB is attached in parts and lands on the team's Drive whole", heavyParts[0] === "drive" && heavyParts[1] === "true" && heavyParts[2] === String(heavy.length) && heavyOnDrive === heavy.length && sql("select count(*) from public.task_uploads") === "0", `${heavyRow()} / ${heavyOnDrive}`);
  await alice.locator('[data-task-file="raw.footage"]').waitFor({ timeout: 20000 }).catch(() => {});
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  await alice.getByRole("button", { name: "Доступ і налаштування" }).click();
  await alice.locator("[data-file-limits-reset]").click();
  check("…and the limit is set back", await until(() => sql("select file_limit_mb from public.task_projects where key = 'MAR'") === "4", 15000));
  await alice.keyboard.press("Escape");
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/2`);
  await alice.locator('[data-task-file="brief.pdf"]').waitFor({ timeout: 20000 }).catch(() => {});
  check("a task file goes to the workspace's one storage (its Drive)", marFile() === "drive:wiki", marFile());
  check("…with no Drive of anyone's own", (await alice.getByRole("link", { name: /Підключити мій Google Диск/ }).count()) === 0);
  const fileId = sql(`select id from public.task_files where task_id = ${marTask(2)} and name = 'brief.pdf'`);
  const served = await alice.evaluate(async (url) => { const r = await fetch(url); return `${r.status} ${(await r.text()).slice(0, 5)}`; }, `/api/tasks/files/${fileId}?ws=${alphaShort}`);
  check("people who see the task open the file", served === "200 %PDF-", served);
  const stranger = await fetch(`${APP}/api/tasks/files/${fileId}?ws=${alphaShort}`, { redirect: "manual" });
  check("…someone signed out gets nothing", stranger.status !== 200, String(stranger.status));
  const disguised = await alice.evaluate(async ({ ws, task }) => (await fetch(`/api/tasks/files?ws=${ws}&task=${task}&name=x.png`, { method: "POST", headers: { "Content-Type": "image/png" }, body: "<html><script>alert(1)</script>" })).status, { ws: alphaShort, task: sql(`select ${marTask(2)}`) });
  check("a page disguised as a picture is refused", disguised === 400, String(disguised));
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  check("projects no longer choose their own storage", (await alice.getByRole("button", { name: "📎 Файли" }).count()) === 0);

  // An older file on someone's own Drive (from before U1) moves in from Settings → Storage.
  {
    const { writeFileSync } = await import("node:fs");
    const old = "%PDF-1.4 old personal file\n%%EOF\n";
    writeFileSync(`${fakeDir}/file-old1`, old);
    writeFileSync(`${fakeDir}/file-old1.type`, "application/pdf");
    const aliceId = sql("select id from public.profiles where email = 'alice@alpha.test'");
    const account = sql(`insert into public.drive_accounts (workspace_id, purpose, user_id, account_email, root_folder_id, files_folder_id, token_encrypted)
      select workspace_id, 'personal', '${aliceId}', 'alice@fake.test', 'folder-a', 'folder-a', token_encrypted from public.drive_connections
      where workspace_id = '${alphaId}' and active limit 1 returning id`).split("\n")[0];
    sql(`insert into public.task_files (workspace_id, task_id, name, mime_type, bytes, storage_path, storage_backend, drive_source, drive_account_id, drive_file_id, uploaded_by)
      values ('${alphaId}', ${marTask(2)}, 'old.pdf', 'application/pdf', ${old.length}, '${alphaId}/tasks/' || ${marTask(2)} || '/00000000-0000-4000-8000-00000000f0a1', 'drive', 'personal', '${account}', 'file-old1', '${aliceId}')`);
    await alice.goto(`${APP}/w/${alphaShort}/settings?tab=storage`);
    const here = alice.locator("[data-one-storage]");
    await here.locator("[data-not-here]:not([data-not-here='0'])").waitFor({ timeout: 15000 });
    check("Storage shows the file not yet here, with the space now and after", (await here.locator("[data-space-now]").count()) === 1 && (await here.locator("[data-space-after]").count()) === 1);
    await here.getByRole("button", { name: "Перенести всі файли сюди" }).click();
    await here.getByText(/Готово: перенесено/).waitFor({ timeout: 30000 });
    const moved = sql(`select storage_backend || ':' || drive_source || ':' || (drive_account_id = (select id from public.drive_connections where workspace_id = '${alphaId}' and active)) from public.task_files where name = 'old.pdf'`);
    check("…it moves into the workspace's Drive", moved === "drive:wiki:true", moved);
    check("…and the old personal Drive access is forgotten", sql(`select count(*) from public.drive_accounts where id = '${account}'`) === "0");
    const opened = await alice.evaluate(async (url) => (await (await fetch(url)).text()).slice(0, 8), `/api/tasks/files/${sql("select id from public.task_files where name = 'old.pdf'")}?ws=${alphaShort}`);
    check("…and still opens from the task", opened === "%PDF-1.4", opened);
  }
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/2`);
  await alice.getByRole("button", { name: "Прибрати файл «brief.pdf»" }).click();
  await alice.locator('[data-task-file="brief.pdf"]').waitFor({ state: "detached", timeout: 15000 });
  check("a removed file waits for the daily cleanup", sql(`select count(*) from public.attachment_tombstones where storage_path like '%/${fileId}'`) === "1");

  // A frozen task opens for the frozen board's people as a read-only snapshot page.
  sql("insert into public.task_statuses (project_id, workspace_id, name, category, position, freezes) select id, workspace_id, 'Handed over', 'doing', 99, true from public.task_projects where key = 'MAR'");
  asColleague(`public.create_task((select id from public.task_projects where key = 'MAR'), '{"title": "Freeze me"}')`);
  const frozenNumber = sql("select number from public.tasks where title = 'Freeze me'");
  sql("update public.tasks set status_id = (select id from public.task_statuses where name = 'Handed over') where title = 'Freeze me'");
  sql("update public.tasks set title = 'Changed after freezing' where title = 'Freeze me'");
  await colleague.goto(`${APP}/w/${alphaShort}/tasks/MAR/${frozenNumber}`);
  await colleague.locator("[data-snapshot-badge]").waitFor({ timeout: 15000 }).catch(() => {});
  check(
    "a frozen task opens as a read-only snapshot: as it was, nothing to change",
    (await colleague.locator("[data-task-snapshot]").getByText("Freeze me").count()) === 1 &&
      (await colleague.getByText("Changed after freezing").count()) === 0 &&
      (await colleague.locator("textarea, [data-save-template], [data-toggle-private]").count()) === 0,
  );
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/${frozenNumber}`);
  check("…while the project owner sees the live task", (await alice.locator("[data-task-snapshot]").count()) === 0 && (await alice.getByText("Changed after freezing").count()) >= 1);
  sql("update public.tasks set deleted_at = now() where title = 'Changed after freezing'");

  // A colleague's private task: the workspace owner sees only its key and people.
  asColleague(`public.create_task((select id from public.task_projects where key = 'MAR'), '{"title": "Colleague secret", "private": true}')`);
  const secret = { data: { ok: sql("select count(*) from public.tasks where title = 'Colleague secret' and private") === "1" } };
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  await alice.locator("[data-private-others]").waitFor({ timeout: 15000 }).catch(() => {});
  check("a private task stays hidden from the owner, who sees only its key", secret.data?.ok === true && (await alice.getByText("Colleague secret").count()) === 0 && (await alice.locator("[data-private-others]").count()) === 1, JSON.stringify(secret.data));
}

// Someone leaves: their task files on their own Drive are copied first — to the
// cloud or as an archive — with how much they weigh and how much space is left.
{
  await fetch(`${API}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: "mover@alpha.test", password: "Test-password-1!" }),
  });
  const { cookies: moverCookies, client: moverClient } = await sessionCookies("mover@alpha.test");
  await moverClient.rpc("join_workspaces");
  const moverId = sql("select id from public.profiles where email = 'mover@alpha.test'");
  const { writeFileSync } = await import("node:fs");
  const content = "%PDF-1.4 mover's file\n%%EOF\n";
  writeFileSync(`${fakeDir}/file-mover1`, content);
  writeFileSync(`${fakeDir}/file-mover1.type`, "application/pdf");
  const account = sql(`insert into public.drive_accounts (workspace_id, purpose, user_id, account_email, root_folder_id, files_folder_id, token_encrypted)
    select workspace_id, 'personal', '${moverId}', 'mover@fake.test', 'folder-m', 'folder-m', token_encrypted from public.drive_connections
    where workspace_id = '${alphaId}' and active limit 1 returning id`).split("\n")[0];
  const marTwo = sql("select t.id from public.tasks t join public.task_projects p on p.id = t.project_id where p.key = 'MAR' and t.number = 2");
  sql(`insert into public.task_files (workspace_id, task_id, name, mime_type, bytes, storage_path, storage_backend, drive_source, drive_account_id, drive_file_id, uploaded_by)
    values ('${alphaId}', '${marTwo}', 'mover.pdf', 'application/pdf', ${content.length}, '${alphaId}/tasks/${marTwo}/00000000-0000-4000-8000-00000000f001', 'drive', 'personal', '${account}', 'file-mover1', '${moverId}')`);
  const moverCookie = moverCookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const notAdmin = await fetch(`${APP}/api/members/files?ws=${alphaId}&user=${moverId}`, { headers: { cookie: moverCookie } });
  check("only the owner or an admin downloads someone's files", notAdmin.status === 403, String(notAdmin.status));
  const archive = await alice.evaluate(async (url) => {
    const r = await fetch(url);
    const text = new TextDecoder().decode(new Uint8Array(await r.arrayBuffer()));
    return `${r.status} ${text.slice(0, 2)} ${text.includes("MAR/MAR-2 mover.pdf")} ${text.includes("mover's file")}`;
  }, `/api/members/files?ws=${alphaId}&user=${moverId}`);
  check("…as a ZIP archive with a folder per project", archive === "200 PK true true", archive);

  await alice.goto(`${APP}/w/${alphaShort}/settings?tab=members`);
  await alice.locator('[data-member-row="mover@alpha.test"] button').click();
  await alice.locator('[data-member-drawer="mover@alpha.test"]').getByRole("button", { name: "Видалити", exact: true }).click();
  const removeDialog = alice.getByRole("dialog", { name: /mover@alpha\.test/ });
  await removeDialog.locator("[data-member-files-found]").waitFor({ timeout: 15000 });
  check("removing someone shows their files on their own Drive, with the space now and after", (await removeDialog.locator("[data-member-files-found]").innerText()).includes("1 файл") && (await removeDialog.locator("[data-member-space]").count()) >= 1);
  await removeDialog.getByLabel("У сховище EdgeKnow").check();
  await removeDialog.getByRole("button", { name: "Скопіювати й прибрати" }).click();
  await removeDialog.waitFor({ state: "detached", timeout: 30000 });
  const after = sql(`select (select count(*) from public.workspace_members where workspace_id = '${alphaId}' and user_id = '${moverId}' and status = 'active') || ' ' ||
    (select storage_backend from public.task_files where name = 'mover.pdf') || ' ' || (select active from public.drive_accounts where id = '${account}')`);
  check("…they are copied to EdgeKnow's storage, then the person is removed and their Drive takes no more files", after === "0 supabase false", after);
  const copied = await alice.evaluate(async (url) => (await (await fetch(url)).text()).slice(0, 8), `/api/tasks/files/${sql("select id from public.task_files where name = 'mover.pdf'")}?ws=${alphaShort}`);
  check("…and the file still opens from the task", copied === "%PDF-1.4", copied);
}

// Step Z4: tasks inside wiki pages — chips with a live status, a list or board on
// a page, new tasks from "@" and from selected text, "mentioned on pages".
{
  const untilAsync = async (condition, ms = 8000) => {
    for (let i = 0; i < ms / 250; i++) {
      if (await condition().catch(() => false)) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  };
  const marId = (n) => sql(`select t.id from public.tasks t join public.task_projects p on p.id = t.project_id where p.key = 'MAR' and t.number = ${n}`);
  const marProject = sql("select id from public.task_projects where key = 'MAR'");
  const category = (n) => sql(`select s.category from public.tasks t join public.task_statuses s on s.id = t.status_id where t.id = '${marId(n)}'`);
  const planPage = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Sprint notes" })).data.id;
  const planContent = [
    { id: "z1", type: "paragraph", props: {}, content: [{ type: "text", text: "Logo: ", styles: {} }, { type: "taskChip", props: { taskId: marId(1) } }], children: [] },
    { id: "z2", type: "tasks", props: { projectId: marProject, view: "list", mine: false }, children: [] },
    { id: "z3", type: "paragraph", props: {}, content: [], children: [] },
  ];
  const planSaved = await aliceClient.rpc("save_page_content", { target_page: planPage, new_content: planContent, base_version: 1 });
  check("(setup) a page with a task chip and a task list", planSaved.data?.ok === true, JSON.stringify(planSaved.data));
  await alice.goto(`${APP}/w/${alphaShort}/p/${planPage}`);
  await alice.waitForSelector('.bn-editor[contenteditable="true"]');
  const chip = alice.locator('[data-task-chip="MAR-1"]');
  await chip.waitFor({ timeout: 15000 });
  check("a task chip shows the task's key, title and status", (await chip.innerText()).includes("Draw the logo"));
  const doneStatus = sql(`select id from public.task_statuses where project_id = '${marProject}' and category = 'done' order by position limit 1`);
  sql(`update public.tasks set status_id = '${doneStatus}' where id = '${marId(1)}'`);
  await alice.evaluate(() => window.dispatchEvent(new Event("focus")));
  check("…a status changed elsewhere shows up without editing the page", await untilAsync(async () => (await chip.locator("[data-task-chip-status]").innerText()) === "Готово", 15000));
  await chip.getByRole("button").click();
  await alice.getByRole("menuitemradio", { name: "В роботі" }).click();
  check("…and the status changes right from the chip", await until(() => category(1) === "doing", 10000));
  check("the task knows it is mentioned on the page", sql(`select count(*) from public.task_page_links where page_id = '${planPage}' and task_id = '${marId(1)}'`) === "1");

  const embed = alice.locator("[data-tasks-embed]");
  await embed.locator('[data-embed-task="MAR-2"]').waitFor({ timeout: 15000 });
  check("a task list shows the project's tasks on the page", (await embed.locator("[data-embed-task]").count()) >= 3);
  await embed.getByLabel("Позначити «Write the brief» готовою").click();
  check("…a task is ticked done right there", await until(() => category(2) === "done", 10000));
  await embed.getByRole("button", { name: "Дошка" }).click();
  await embed.locator('[data-embed-column="Готово"] [data-embed-task="MAR-2"]').waitFor({ timeout: 15000 });
  check("…and it turns into a board (kept in the page)", await untilAsync(async () => JSON.stringify(pageContent(planPage)).includes('"view":"board"'), 10000));

  // The board above can push the last line below the fold: bring it into view before clicking by position.
  await alice.locator('[data-id="z3"] .bn-inline-content').first().scrollIntoViewIfNeeded();
  const lastLine = await alice.locator('[data-id="z3"] .bn-inline-content').first().boundingBox();
  await alice.mouse.click(lastLine.x + 5, lastLine.y + lastLine.height / 2);
  await alice.keyboard.type("@Brand new idea");
  await alice.locator(".bn-suggestion-menu-item", { hasText: "+ MAR: «Brand new idea»" }).click({ timeout: 15000 });
  check("“@” makes a new task from what was typed and puts its chip in", await until(() => sql("select count(*) from public.tasks where title = 'Brand new idea'") === "1", 10000) && sql("select description::text like '%pageChip%' from public.tasks where title = 'Brand new idea'") === "t");
  await alice.keyboard.press("Enter");
  await alice.keyboard.type("Fix the footer");
  await alice.keyboard.press("Shift+Home");
  await alice.getByRole("button", { name: "Створити задачу з виділеного" }).click();
  const fromSelection = alice.getByRole("dialog", { name: "Нова задача з виділеного тексту" });
  await fromSelection.getByRole("button", { name: "Створити" }).click();
  check("selected text becomes a task", await until(() => sql("select count(*) from public.tasks where title = 'Fix the footer'") === "1", 10000));
  check("…and its chip takes the text's place", await untilAsync(async () => (await alice.locator("[data-task-chip]").count()) >= 3, 10000));
  await alice.waitForTimeout(2500);
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR/1`);
  check("a task lists the pages that mention it", (await alice.locator("[data-mentioned-on]").getByText("Sprint notes").count()) === 1);
}

// --- Groups of people ---------------------------------------------------------------------------
{
  const { client: colleagueClient } = await sessionCookies("colleague@alpha.test");
  const groupPage = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "For reviewers" })).data.id;
  await alice.goto(`${APP}/w/${alphaShort}/settings?tab=groups`);
  await alice.getByLabel("Назва нової групи").fill("Reviewers");
  await alice.getByRole("button", { name: "Створити групу" }).click();
  const card = alice.locator('[data-group="Reviewers"]');
  await card.waitFor({ timeout: 15000 });
  await card.getByLabel("Додати людину в групу «Reviewers»").selectOption({ label: await card.locator("option", { hasText: "colleague@alpha.test" }).first().innerText() });
  await card.getByText("учасників: 1").waitFor({ timeout: 15000 }).catch(() => {});
  check("the admin makes a group and adds a colleague", sql(`select count(*) from public.workspace_group_members gm join public.workspace_groups g on g.id = gm.group_id where g.name = 'Reviewers' and g.workspace_id = '${alphaId}'`) === "1");
  // Company structure, stage 3: a person in a unit can be its lead.
  await card.locator("[data-group-lead-toggle]").first().click();
  await card.locator("[data-group-lead]").first().waitFor({ timeout: 15000 }).catch(() => {});
  check("…marks a colleague as the unit's lead", sql(`select count(*) from public.workspace_group_members gm join public.workspace_groups g on g.id = gm.group_id where g.name = 'Reviewers' and gm.is_lead`) === "1");
  sql(`update public.workspace_group_members set is_lead = false where group_id in (select id from public.workspace_groups where name = 'Reviewers')`);
  // Company structure: a unit inside another shows one level deeper.
  await alice.getByLabel("Назва нової групи").fill("Reviewers QA");
  await alice.getByLabel("Всередині").selectOption({ label: "Reviewers" });
  await alice.getByRole("button", { name: "Створити групу" }).click();
  await alice.locator('[data-group="Reviewers QA"][data-group-depth="1"]').waitFor({ timeout: 15000 }).catch(() => {});
  check("…and puts a unit inside another (company structure)", sql(`select p.name from public.workspace_groups g join public.workspace_groups p on p.id = g.parent_id where g.name = 'Reviewers QA'`) === "Reviewers" && (await alice.locator('[data-group="Reviewers QA"][data-group-depth="1"]').count()) === 1);
  sql(`delete from public.workspace_groups where name = 'Reviewers QA' and workspace_id = '${alphaId}'`);
  // Company structure, stage 2: the owner makes a role with its own name and rights.
  await alice.goto(`${APP}/w/${alphaShort}/settings?tab=roles`);
  await alice.locator("[data-role-add]").click();
  await alice.getByRole("form", { name: "Нова роль" }).getByLabel("Назва ролі").fill("Intern");
  await alice.getByRole("form", { name: "Нова роль" }).getByLabel("Створювати сторінки вікі").uncheck();
  await alice.getByRole("form", { name: "Нова роль" }).getByLabel("Рівень для відкритого всьому воркспейсу").selectOption("viewer");
  await alice.getByRole("form", { name: "Нова роль" }).getByRole("button", { name: "Зберегти" }).click();
  await alice.locator('[data-role="Intern"]').waitFor({ timeout: 15000 }).catch(() => {});
  check("the owner makes a role with own rights and a ceiling", sql(`select permissions ->> 'create_pages' || ' ' || content_level from public.workspace_roles where workspace_id = '${alphaId}' and name = 'Intern'`) === "false viewer");
  sql(`delete from public.workspace_roles where workspace_id = '${alphaId}' and name = 'Intern'`);
  check("…who can't see the page yet", (await colleagueClient.rpc("effective_role", { target_page: groupPage })).data === null);
  await alice.goto(`${APP}/w/${alphaShort}/p/${groupPage}`);
  await alice.getByRole("button", { name: "Поділитися" }).click();
  const dialog = alice.getByRole("dialog", { name: "Доступ до сторінки" });
  await dialog.getByLabel("Група", { exact: true }).waitFor({ timeout: 15000 });
  await dialog.getByLabel("Група", { exact: true }).selectOption({ label: "Reviewers · 1 особа" });
  await dialog.getByLabel("Роль групи").selectOption("commenter");
  await dialog.getByRole("button", { name: "Додати" }).nth(1).click();
  await dialog.locator("span", { hasText: "Reviewers · 1 особа" }).first().waitFor({ timeout: 15000 }).catch(() => {});
  check("the page owner gives the group a role in the share dialog", (await dialog.locator("span", { hasText: "Reviewers · 1 особа" }).count()) >= 1);
  check("…and the colleague in the group gets it", (await colleagueClient.rpc("effective_role", { target_page: groupPage })).data === "commenter");
  await alice.keyboard.press("Escape");
  await alice.goto(`${APP}/w/${alphaShort}/settings?tab=groups`);
  await alice.locator('[data-group="Reviewers"]').getByRole("button", { name: /з групи «Reviewers»/ }).click();
  await alice.locator('[data-group="Reviewers"]').getByText("учасників: 0").waitFor({ timeout: 15000 }).catch(() => {});
  check("out of the group, the access is gone", (await colleagueClient.rpc("effective_role", { target_page: groupPage })).data === null);
  await colleagueClient.auth.signOut({ scope: "local" });
}

// --- Guests (step Г): invited until a date, see only what is shared with them ---------------------
{
  await alice.goto(`${APP}/w/${alphaShort}/settings?tab=members`);
  await alice.getByLabel("Пошта").fill("gwen@client.test");
  await alice.locator("form").getByLabel("Роль").selectOption("guest");
  const day = new Date(Date.now() + 7 * 86400000).toLocaleDateString("sv");
  await alice.locator("[data-guest-until]").fill(day);
  await alice.getByRole("button", { name: "Запросити", exact: true }).click();
  await alice.getByText(/Запрошення для gwen@client\.test створено/).waitFor({ timeout: 15000 });
  check("the owner invites a guest until a date", sql("select role || ' ' || (access_until is not null) from public.invitations where email = 'gwen@client.test' and revoked_at is null") === "guest true");

  await fetch(`${API}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: "gwen@client.test", password: "Test-password-1!" }),
  });
  const { cookies: gwenCookies, client: gwenClient } = await sessionCookies("gwen@client.test");
  await gwenClient.rpc("join_workspaces");
  const gwenId = sql("select id from public.profiles where email = 'gwen@client.test'");
  check("…someone from outside joins as a guest", sql(`select role from public.workspace_members where workspace_id = '${alphaId}' and user_id = '${gwenId}'`) === "guest");

  const forClient = (await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "For the client" })).data.id;
  await aliceClient.rpc("set_page_workspace_role", { target_page: forClient, new_role: "viewer" });
  await aliceClient.rpc("set_page_member_role", { target_page: forClient, member: gwenId, new_role: "editor" });
  const seen = ((await gwenClient.from("pages").select("title")).data ?? []).map((p) => p.title);
  check("the guest sees only the page shared with her", seen.length === 1 && seen[0] === "For the client", JSON.stringify(seen));
  const people = ((await gwenClient.from("workspace_members").select("user_id").eq("workspace_id", alphaId)).data ?? []).map((m) => m.user_id);
  check("…and not the whole member list", !people.includes(colleagueId) && people.includes(gwenId), JSON.stringify(people.length));

  const gwen = await newPage(gwenCookies);
  await gwen.goto(`${APP}/w/${alphaShort}`);
  await gwen.locator("[data-workspace-menu-button]").first().waitFor({ timeout: 15000 });
  check("a guest's menu has “New page” but no bin", (await gwen.getByRole("button", { name: "Нова сторінка" }).count()) === 1 && (await gwen.getByRole("link", { name: "Кошик" }).count()) === 0);
  await gwen.getByRole("button", { name: "Нова сторінка" }).click();
  await gwen.waitForURL(/\/p\/[0-9a-f-]{36}(\?new=1)?$/, { timeout: 20000 });
  // The page opens while the database makes it: wait for it to be on screen.
  await gwen.waitForSelector("textarea");
  const gwenPage = gwen.url().split("/").pop().split("?")[0];
  const ownerOf = sql(`select pr.email || ' ' || (select a.role from public.page_access a where a.page_id = p.id and a.user_id = '${gwenId}') from public.pages p join public.profiles pr on pr.id = p.owner_id where p.id = '${gwenPage}'`);
  check("…a page the guest makes belongs to the workspace owner, and she edits it", ownerOf === "alice@alpha.test editor", ownerOf);
  const below = await gwenClient.rpc("create_page", { ws: alphaId, parent: forClient, new_title: "Below" });
  check("…the same below the shared page", below.data?.ok === true && sql(`select pr.email from public.pages p join public.profiles pr on pr.id = p.owner_id where p.id = '${below.data?.id}'`) === "alice@alpha.test", JSON.stringify(below.data));
  const exported = await gwen.evaluate(async () => (await (await fetch("/api/me/export")).json()).workspaces);
  const alphaPart = exported.find((w) => w.name === "Alpha");
  check("…and “My data” gives a guest no content of the workspace", alphaPart && alphaPart.role === "guest" && !("pages" in alphaPart), JSON.stringify(alphaPart));

  await alice.goto(`${APP}/w/${alphaShort}/settings?tab=members`);
  check("the members list marks the guest and her date", (await alice.locator("li", { hasText: "gwen@client.test" }).locator("[data-guest-badge]").count()) === 1 && (await alice.locator("li", { hasText: "gwen@client.test" }).getByText(/доступ до/).count()) === 1);
  await alice.goto(`${APP}/w/${alphaShort}/p/${forClient}`);
  await alice.getByRole("button", { name: "Поділитися" }).click();
  const share = alice.getByRole("dialog", { name: "Доступ до сторінки" });
  await share.getByText(/gwen@client\.test · Гість|Гість/).first().waitFor({ timeout: 15000 }).catch(() => {});
  check("…and so does the share dialog", (await share.getByText(/· Гість/).count()) >= 1);
  await alice.keyboard.press("Escape");

  sql(`update public.workspace_members set access_until = now() - interval '1 minute' where user_id = '${gwenId}'`);
  await gwen.goto(`${APP}/w/${alphaShort}`);
  await gwen.waitForURL(/no-access/, { timeout: 15000 }).catch(() => {});
  const after = ((await gwenClient.from("pages").select("id")).data ?? []).length;
  check("past her date the guest sees nothing", gwen.url().includes("no-access") && after === 0, `${gwen.url()} ${after}`);
  await aliceClient.rpc("remove_member", { ws: alphaId, member: gwenId });
  await gwenClient.auth.signOut({ scope: "local" });
  await gwen.close();
}

// --- Active sessions: the person sees own devices; an admin ends them all -----------------------
{
  await fetch(`${API}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: "devices@alpha.test", password: "Test-password-1!" }),
  });
  const first = await sessionCookies("devices@alpha.test");
  await first.client.rpc("join_workspaces");
  const second = await sessionCookies("devices@alpha.test");
  const devicesId = sql("select id from public.profiles where email = 'devices@alpha.test'");
  // Sign-up itself also opens a session: count what the database holds.
  const live = Number(sql(`select count(*) from auth.sessions where user_id = '${devicesId}'`));
  const phone = await newPage(first.cookies);
  await phone.goto(`${APP}/w/${alphaShort}/profile`);
  await phone.locator("[data-my-devices] [data-session]").first().waitFor({ timeout: 15000 }).catch(() => {});
  const shown = await phone.locator("[data-my-devices] [data-session]").count();
  check("the person sees their devices in the profile", live >= 2 && shown === live, `${shown} of ${live}`);
  check("…with no IP address shown", !/\d+\.\d+\.\d+\.\d+/.test(await phone.locator("[data-my-devices]").innerText()));

  await alice.goto(`${APP}/w/${alphaShort}/settings?tab=people`);
  await alice.locator('[data-member-row="devices@alpha.test"] button').click();
  const card = alice.locator('[data-member-drawer="devices@alpha.test"]');
  await card.locator("[data-member-sessions] [data-session]").first().waitFor({ timeout: 15000 }).catch(() => {});
  const listed = await card.locator("[data-member-sessions] [data-session]").count();
  check("the owner sees the member's devices in the member card", listed === live, `${listed} of ${live}`);
  await card.locator("[data-end-sessions]").click();
  await card.getByText(`Завершено сесій: ${live}`).waitFor({ timeout: 15000 }).catch(() => {});
  check("…and ends them all, logged", sql(`select count(*) from auth.sessions where user_id = '${devicesId}'`) === "0" && sql(`select count(*) from public.audit_log where action = 'sessions_ended' and details ->> 'email' = 'devices@alpha.test'`) === "1");
  await alice.keyboard.press("Escape");

  await phone.goto(`${APP}/w/${alphaShort}`);
  await phone.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});
  check("the ended device has to sign in again at once", phone.url().includes("/login"), phone.url());
  const direct = ((await second.client.from("pages").select("id")).data ?? []).length;
  check("…and its token reads nothing from the database", direct === 0, String(direct));
  await phone.close();
  await aliceClient.rpc("remove_member", { ws: alphaId, member: devicesId });
}

// --- Moving in from another tracker (Rukh Р-3а): same numbers, dates, people and links ---------
{
  const { writeFileSync } = await import("node:fs");
  const dir = process.env.TRACKER_FAKE_DIR;
  if (!dir) throw new Error("TRACKER_FAKE_DIR is not set");
  const text = (value) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: value, marks: [{ type: "strong" }] }] }] });
  const status = (id, name, key) => ({ id, name, statusCategory: { key } });
  const statuses = [status("1", "Backlog", "new"), status("2", "In Review", "indeterminate"), status("3", "Released", "done")];
  const issue = (number, fields, changelog) => ({ key: `OLD-${number}`, ...(changelog ? { changelog } : {}), fields: { labels: [], issuelinks: [], created: "2025-03-01T10:00:00.000+0000", updated: "2025-03-05T10:00:00.000+0000", priority: { name: "High" }, ...fields } });
  // A file of 9 MB goes to the Drive in two parts; one file the tracker won't give; one too big.
  const { mkdirSync, statSync } = await import("node:fs");
  const bigFile = Buffer.alloc(9 * 1024 * 1024, 7);
  bigFile.write("EDGEKNOW-FILE", 0);
  mkdirSync(`${dir}/files`, { recursive: true });
  writeFileSync(`${dir}/files/900`, bigFile);
  writeFileSync(
    `${dir}/tracker.json`,
    JSON.stringify({
      token: "fake-tracker-key",
      me: { accountId: "u-alice", displayName: "Alice", emailAddress: "alice@alpha.test" },
      project: { key: "OLD", name: "Old tracker", issueTypes: [{ id: "10", name: "Epic", hierarchyLevel: 1 }, { id: "11", name: "Task" }, { id: "12", name: "Sub-task", subtask: true }] },
      statuses,
      priorities: ["High", "Low"],
      fields: [],
      users: [{ accountId: "u-alice", displayName: "Alice", emailAddress: "alice@alpha.test" }],
      roles: [{ name: "Developers", users: ["u-alice", "u-gone"] }, { name: "Empty role", users: [] }],
      // The project's permission scheme as the tracker gives it, and the site's groups it names.
      scheme: { name: "Old scheme", permissions: [
        { permission: "CREATE_ISSUES", holder: { type: "projectRole", parameter: "10002", projectRole: { id: 10002, name: "Developers" } } },
        { permission: "EDIT_ISSUES", holder: { type: "group", value: "g-design", group: { name: "Old designers", groupId: "g-design" } } },
        { permission: "TRANSITION_ISSUES", holder: { type: "assignee" } },
        { permission: "TRANSITION_ISSUES", holder: { type: "reporter" } },
        { permission: "DELETE_ISSUES", holder: { type: "user", value: "u-gone" } },
        { permission: "MANAGE_WATCHERS", holder: { type: "anyone" } },
      ] },
      groups: [{ id: "g-design", name: "Old designers", users: ["u-alice", "u-gone"] }],
      issues: [
        issue(1, { summary: "Old epic", description: text("Moved text"), status: statuses[0], issuetype: { id: "10" }, assignee: { accountId: "u-alice", displayName: "Alice", emailAddress: "alice@alpha.test" }, reporter: { accountId: "u-gone", displayName: "Gone Person" }, labels: ["legacy"], duedate: "2026-12-01", worklog: { total: 1, worklogs: [{ id: "w1", author: { accountId: "u-gone", displayName: "Gone Person" }, timeSpentSeconds: 7200, started: "2025-03-02T10:00:00.000+0000" }] }, attachment: [
          { id: "900", filename: "spec.bin", mimeType: "application/x-design", size: bigFile.length, author: { accountId: "u-gone", displayName: "Gone Person" }, created: "2025-03-02T09:00:00.000+0000" },
          { id: "901", filename: "lost.txt", mimeType: "text/plain", size: 5, created: "2025-03-02T09:00:00.000+0000" },
          { id: "902", filename: "giant.mov", mimeType: "video/quicktime", size: 300 * 1024 * 1024, created: "2025-03-02T09:00:00.000+0000" },
        ], comment: { total: 1, comments: [{ id: "c1", author: { accountId: "u-gone", displayName: "Gone Person" }, body: text("Said long ago"), created: "2025-03-02T08:00:00.000+0000", updated: "2025-03-02T08:00:00.000+0000" }] } }, { total: 1, histories: [{ id: "h1", created: "2025-03-03T08:00:00.000+0000", author: { accountId: "u-gone", displayName: "Gone Person" }, items: [{ field: "status", from: "2", to: "1" }] }] }),
        issue(2, { summary: "Old child", status: statuses[1], issuetype: { id: "12" }, parent: { key: "OLD-1" }, issuelinks: [{ type: { name: "Blocks" }, outwardIssue: { key: "OLD-5" } }] }),
        issue(5, { summary: "Old done", status: statuses[2], issuetype: { id: "11" }, assignee: { accountId: "u-gone", displayName: "Gone Person" }, security: { name: "Staff only" }, resolutiondate: "2025-03-04T10:00:00.000+0000" }),
      ],
    }),
  );
  await alice.goto(`${APP}/w/${alphaShort}/tasks`);
  await alice.locator("[data-open-import]").click();
  await alice.waitForURL(/\/tasks\/import$/);
  await alice.locator("[data-import-link]").fill("https://old-team.atlassian.net/jira/core/projects/OLD/board");
  check("the project's key is read from the pasted link", (await alice.locator("[data-import-project]").inputValue()) === "OLD");
  await alice.locator("[data-import-account]").fill("alice@alpha.test");
  await alice.locator("[data-import-token]").fill("a-wrong-key-123");
  await alice.locator("[data-import-connect]").click();
  await alice.locator("[data-import-error]").waitFor({ timeout: 20000 }).catch(() => {});
  check("a wrong access key is refused, and nothing is kept", (await alice.locator("[data-import-error]").count()) === 1 && sql("select count(*) from public.task_imports") === "0");
  await alice.locator("[data-import-token]").fill("fake-tracker-key");
  await alice.locator("[data-import-connect]").click();
  await alice.locator("[data-import-found]").waitFor({ timeout: 30000 });
  const kept = sql("select secret_encrypted not like '%fake-tracker-key%' and secret_encrypted like 'v1.%' from public.task_imports");
  check("the tracker's key is kept encrypted, and people are matched by email", kept === "t" && (await alice.locator("[data-import-people-found]").innerText()).includes("1 з 1"), kept);
  const roleRows = await alice.locator("[data-import-roles] select").evaluateAll((els) => els.map((el) => el.value).join(","));
  check("the tracker's roles that have people are offered a role of ours", roleRows === "editor", roleRows);
  // The tracker's permission scheme: its group is offered as a new unit, and the table says who will do what.
  const schemeCell = (action) => alice.locator(`[data-import-scheme-row="${action}"] td`).nth(1).innerText();
  check(
    "the tracker's permission scheme is shown before anything is written: who will do what, and what is left out",
    (await alice.locator('[data-import-scheme="carry"]').isChecked()) &&
      (await alice.locator("[data-import-scheme-groups] select").inputValue()) === "new" &&
      (await alice.locator("[data-import-scheme-row]").count()) === 19 &&
      (await schemeCell("create")) === "Редагує задачі" &&
      (await schemeCell("edit")).includes("Old designers") &&
      (await schemeCell("transition")) === "Автор задачі, Виконавець задачі" &&
      (await schemeCell("delete")) === "лише власники проєкту" &&
      (await alice.locator('[data-import-scheme-note="permission_unsupported"]').count()) === 1 &&
      (await alice.locator('[data-import-scheme-note="person_not_member"]').count()) === 1 &&
      sql("select count(*) from public.workspace_groups where name = 'Old designers'") === "0",
    `${await schemeCell("create")} | ${await schemeCell("edit")} | ${await schemeCell("transition")} | ${await schemeCell("delete")}`,
  );
  await alice.locator("[data-import-to-preview]").click();
  await alice.locator('[data-import-preview-task="OLD-1"]').waitFor({ timeout: 30000 });
  check("the dry run shows the first tasks, and nothing is written yet", (await alice.locator("[data-import-preview-task]").count()) === 3 && sql("select count(*) from public.task_projects where key = 'OLD'") === "0");
  await alice.locator("[data-import-start]").click();
  await alice.locator('[data-import-run="done"]').waitFor({ timeout: 60000 });
  // The scheme became the project's permissions, and the group a unit with its people who are members.
  const oldRule = (action, what) => sql(`select ${what} from public.task_permissions x where x.action = '${action}' and x.project_id = (select id from public.task_projects where key = 'OLD')`);
  const carried = [sql("select count(*) from public.task_permissions where project_id = (select id from public.task_projects where key = 'OLD')"), oldRule("create", "array_to_string(x.roles, ',')"), oldRule("edit", "(select string_agg(g.name, ',') from public.workspace_groups g where g.id = any (x.groups))"), oldRule("transition", "x.reporter::text || x.assignee::text"), oldRule("delete", "cardinality(x.members) + cardinality(x.groups) + cardinality(x.roles)")].join(" ");
  const unitPeople = sql("select string_agg(split_part(pr.email, '@', 1), ',') from public.workspace_group_members gm join public.workspace_groups g on g.id = gm.group_id join public.profiles pr on pr.id = gm.user_id where g.name = 'Old designers'");
  check("the tracker's permissions move in as the project's own, and its group as a unit", carried === "19 editor Old designers truetrue 0" && unitPeople === "alice" && (await alice.locator("[data-import-report-permissions]").innerText()).includes("19") && (await alice.locator("[data-import-report-permissions-failed]").count()) === 0, `${carried} / ${unitPeople}`);
  // The steps below go by the usual rules again.
  sql("delete from public.task_permissions where project_id = (select id from public.task_projects where key = 'OLD')");
  sql("delete from public.workspace_groups where name = 'Old designers'");
  const old = "(select id from public.task_projects where key = 'OLD')";
  const moved = sql(`select string_agg(t.number || ':' || s.name || ':' || t.type, ',' order by t.number) || ' next ' || (select next_number from public.task_projects where key = 'OLD') from public.tasks t join public.task_statuses s on s.id = t.status_id where t.project_id = ${old}`);
  check("tasks move in with their numbers, columns and types", moved === "1:Backlog:epic,2:In Review:task,5:Released:task next 6" && (await alice.locator("[data-import-all-moved]").count()) === 1, moved);
  const people = sql(`select (select email from public.profiles where id = t.assignee_id) || ' ' || t.imported_reporter || ' ' || to_char(t.created_at at time zone 'utc', 'YYYY-MM-DD') || ' ' || t.external_key || ' ' || (t.description::text like '%Moved text%') from public.tasks t where t.project_id = ${old} and t.number = 1`);
  check("…with people (a member by email, a stranger by name), dates and the description", people === "alice@alpha.test Gone Person 2025-03-01 OLD-1 true", people);
  const tied = sql(`select (select p.number from public.tasks p where p.id = t.parent_id) || ' ' || (select count(*) from public.task_links l where l.source_id = t.id and l.kind = 'blocks') from public.tasks t where t.project_id = ${old} and t.number = 2`);
  check("…and with subtasks and links", tied === "1 1", tied);
  const activity = sql(`select (select count(*) || ' ' || min(to_char(c.created_at at time zone 'utc', 'YYYY-MM-DD')) || ' ' || bool_and(c.author_id is null and c.author_slot is not null) from public.task_comments c join public.tasks t on t.id = c.task_id where t.project_id = ${old}) || ' / ' || (select count(*) || ' ' || min(to_char(e.created_at at time zone 'utc', 'YYYY-MM-DD')) from public.task_events e join public.tasks t on t.id = e.task_id where t.project_id = ${old} and e.field = 'status_id' and e.external_id is not null)`);
  check("…with comments and status changes, on their own dates and by the tracker's people", activity === "1 2025-03-02 true / 1 2025-03-03" && (await alice.locator("[data-import-report-activity]").count()) === 1, activity);
  const movedFile = sql(`select f.id || ' ' || f.mime_type || ' ' || f.bytes || ' ' || f.storage_backend || ' ' || f.drive_file_id from public.task_files f join public.tasks t on t.id = f.task_id where t.project_id = ${old} and f.external_id = '900'`).split(" ");
  const onDrive = movedFile[4] ? statSync(`${process.env.DRIVE_FAKE_DIR}/${movedFile[4]}`, { throwIfNoEntry: false })?.size : 0;
  check("…with files: a large one goes to the team's Drive whole, in parts", movedFile[1] === "application/x-design" && movedFile[2] === String(bigFile.length) && movedFile[3] === "drive" && onDrive === bigFile.length && (await alice.locator("[data-import-report-files]").count()) === 1, `${movedFile.join(" ")} / ${onDrive}`);
  await alice.locator("[data-import-gaps]").waitFor({ timeout: 15000 }).catch(() => {});
  const gapNames = await alice.locator("[data-import-gap]").evaluateAll((els) => els.map((el) => el.getAttribute("data-import-gap")).sort().join(","));
  check("…and what could not come is listed (a file the tracker won't give, a file too big)", gapNames === "giant.mov,lost.txt", gapNames);
  const fetched = await alice.evaluate(async (url) => {
    const whole = await fetch(url);
    const bytes = new Uint8Array(await whole.arrayBuffer());
    const part = await fetch(url, { headers: { Range: "bytes=0-12" } });
    return { status: whole.status, length: bytes.length, head: new TextDecoder().decode(bytes.slice(0, 13)), disposition: whole.headers.get("content-disposition") ?? "", partStatus: part.status, partText: await part.text() };
  }, `${APP}/api/tasks/files/${movedFile[0]}?ws=${alphaShort}`);
  check("a large file is handed out as a download, whole or by parts", fetched.status === 200 && fetched.length === bigFile.length && fetched.head === "EDGEKNOW-FILE" && fetched.disposition.startsWith("attachment") && fetched.partStatus === 206 && fetched.partText === "EDGEKNOW-FILE", JSON.stringify({ ...fetched, head: fetched.head.slice(0, 20) }));
  // «Дотягнути»: the tracker now gives the file it refused.
  writeFileSync(`${dir}/files/901`, "hello");
  await alice.locator("[data-import-retry-files]").click();
  const pulled = () => sql(`select (select count(*) from public.task_files f join public.tasks t on t.id = f.task_id where t.project_id = ${old} and f.external_id is not null) || ' ' || (select string_agg(g.name, ',') from public.task_import_gaps g where g.project_id = ${old} and g.resolved_at is null)`);
  check("pulling again brings the file that was refused and keeps the rest", await until(() => pulled() === "2 giant.mov", 40000), pulled());
  await alice.locator('[data-import-run="done"]').waitFor({ timeout: 30000 }).catch(() => {});
  const movedTime = sql(`select count(*) || ' ' || sum(e.minutes) || ' ' || min(e.spent_on::text) || ' ' || (select time_tracking from public.task_projects where key = 'OLD') from public.task_time_entries e join public.tasks t on t.id = e.task_id where t.project_id = ${old}`);
  check("…with the time people wrote down there (the project then tracks time)", movedTime === "1 120 2025-03-02 true", movedTime);
  check("…telling nobody about it", sql(`select count(*) from public.notifications n join public.tasks t on t.id = n.task_id where t.project_id = ${old}`) === "0");
  await alice.locator("[data-import-open-project]").click();
  await alice.waitForURL(/\/tasks\/OLD$/);
  await alice.goto(`${APP}/w/${alphaShort}/tasks/OLD/1`);
  check("a comment from the tracker shows who wrote it there", ((await alice.locator("[data-task-comment]").first().textContent().catch(() => "")) ?? "").includes("Gone Person (з трекера)"));
  check("an imported task says where it came from and who wrote it", (await alice.locator("[data-task-origin]").innerText()).includes("OLD-1") && (await alice.locator("[data-task-reporter]").innerText()) === "Gone Person");
  // The key changes in the project's settings; the tasks follow.
  await alice.goto(`${APP}/w/${alphaShort}/tasks/OLD`);
  await alice.getByRole("button", { name: "Доступ і налаштування" }).click();
  await alice.locator("[data-project-key]").fill("OLDER");
  await alice.locator("[data-project-key-save]").click();
  await alice.waitForURL(/\/tasks\/OLDER$/, { timeout: 20000 }).catch(() => {});
  check("a project's key changes, and its tasks keep their numbers", sql("select count(*) from public.task_projects where key = 'OLDER'") === "1" && alice.url().endsWith("/tasks/OLDER"), alice.url());
  // The tracker's people are seats: the one nobody knew is tied to a member later, and
  // the tasks follow (the restricted one too, which comes over private).
  const seatOf = () => sql(`select p.name || ' ' || coalesce(p.project_role, '-') || ' ' || array_to_string(p.tracker_roles, ',') || ' ' || coalesce((select email from public.profiles where id = p.user_id), 'free') from public.task_import_people p where p.external_id = 'u-gone'`);
  check("a tracker person nobody knows is kept as a seat with the role mapped", seatOf() === "Gone Person editor Developers free", seatOf());
  const restricted = () => sql(`select t.private || ' ' || coalesce((select email from public.profiles where id = t.assignee_id), t.imported_assignee) from public.tasks t where t.project_id = (select id from public.task_projects where key = 'OLDER') and t.number = 5`);
  check("a restricted task comes over private", restricted() === "true Gone Person", restricted());
  const colleagueSeat = sql("select id from public.profiles where email = 'colleague@alpha.test'");
  await alice.getByRole("button", { name: "Доступ і налаштування" }).click();
  await alice.locator('[data-import-person="Gone Person"] [data-import-person-seat]').waitFor({ timeout: 20000 });
  await alice.locator('[data-import-person="Gone Person"] [data-import-person-seat]').selectOption(colleagueSeat);
  await alice.locator("[data-import-people-note]").waitFor({ timeout: 20000 }).catch(() => {});
  const followed = () => sql(`select string_agg(t.number || ':' || coalesce((select split_part(email, '@', 1) from public.profiles where id = t.assignee_id), '-') || '/' || coalesce((select split_part(email, '@', 1) from public.profiles where id = t.reporter_id), '-'), ',' order by t.number) from public.tasks t where t.project_id = (select id from public.task_projects where key = 'OLDER') and t.number in (1, 5)`);
  check("tying the person to a member hands over the tasks they held and wrote", await until(() => followed() === "1:alice/colleague,5:colleague/-", 15000), followed());
  const seatedRole = sql(`select public.task_project_role_of((select id from public.task_projects where key = 'OLDER'), '${colleagueSeat}')`);
  check("…and the member has at least the mapped role in the project", ["editor", "owner"].includes(seatedRole), seatedRole);
  await alice.keyboard.press("Escape");
  // A second run of the same import doubles nothing.
  sql(`update public.task_imports set state = 'running', progress = jsonb_set(jsonb_set(progress, '{phase}', '"tasks"'), '{cursor}', 'null')`);
  await alice.goto(`${APP}/w/${alphaShort}/tasks/import`);
  await alice.locator("[data-import-resume]").click();
  await alice.locator('[data-import-run="done"]').waitFor({ timeout: 60000 });
  const again = sql(`select (select count(*) from public.task_comments c join public.tasks t on t.id = c.task_id where t.project_id = (select id from public.task_projects where key = 'OLDER')) || ' ' || (select count(*) from public.task_events e join public.tasks t on t.id = e.task_id where t.project_id = (select id from public.task_projects where key = 'OLDER') and e.external_id is not null) || ' ' || (select split_part(email, '@', 1) from public.profiles where id = (select author_id from public.task_comments where external_id = 'c1'))`);
  const filesAgain = sql(`select count(*) || ' ' || (select split_part(email, '@', 1) from public.profiles where id = (select uploaded_by from public.task_files where external_id = '900')) from public.task_files f join public.tasks t on t.id = f.task_id where t.project_id = (select id from public.task_projects where key = 'OLDER') and f.external_id is not null`);
  check("…nor files; the seated person's file is the member's", filesAgain === "2 colleague", filesAgain);
  check("…nor comments and history; the seated person's comment is the member's", again === "1 1 colleague", again);
  check("running an import again changes tasks, never doubles them", sql(`select count(*) from public.tasks where project_id = (select id from public.task_projects where key = 'OLDER')`) === "3");
  // «Оновити з трекера»: only what changed there since the last run comes again.
  {
    const { readFileSync } = await import("node:fs");
    const data = JSON.parse(readFileSync(`${dir}/tracker.json`, "utf8"));
    const soon = new Date(Date.now() + 60_000).toISOString().replace("Z", "+0000");
    data.issues[1].fields.summary = "Old child, renamed there";
    data.issues[1].fields.updated = soon;
    data.issues.push({ key: "OLD-6", fields: { ...data.issues[2].fields, summary: "Made after the move", updated: soon, created: soon, assignee: null, security: null, resolutiondate: null } });
    writeFileSync(`${dir}/tracker.json`, JSON.stringify(data));
    sql(`update public.tasks set title = 'Kept as it is here' where external_key = 'OLD-1'`);
    await alice.locator("[data-import-refresh]").click();
    const refreshed = () => sql(`select string_agg(t.number || ':' || t.title, ', ' order by t.number) from public.tasks t where t.project_id = (select id from public.task_projects where key = 'OLDER') and t.number in (1, 2, 6)`);
    check("updating from the tracker brings the new task and the changed one, and leaves the rest alone", await until(() => refreshed() === "1:Kept as it is here, 2:Old child, renamed there, 6:Made after the move", 60000), refreshed());
    await alice.locator('[data-import-run="done"]').waitFor({ timeout: 60000 }).catch(() => {});
    await alice.locator("[data-import-refresh]").waitFor({ timeout: 30000 }).catch(() => {});
    // A task is found by its old key or a link from the tracker, though the project's key is another now.
    await alice.goto(`${APP}/w/${alphaShort}/tasks`);
    await alice.locator("[data-task-finder-input]").fill("https://old-team.atlassian.net/browse/OLD-2?focusedCommentId=1");
    await alice.locator("[data-task-finder-open]").click();
    await alice.waitForURL(/\/tasks\/OLDER\/2$/, { timeout: 20000 }).catch(() => {});
    check("an old link from the tracker opens the task here", alice.url().endsWith("/tasks/OLDER/2"), alice.url());
    await alice.goto(`${APP}/w/${alphaShort}/tasks`);
    await alice.locator("[data-task-finder-input]").fill("OLD-777");
    await alice.locator("[data-task-finder-open]").click();
    check("…and a key nobody has says so", (await alice.locator("[data-task-finder-missing]").waitFor({ timeout: 15000 }).then(() => true).catch(() => false)));
    await alice.goto(`${APP}/w/${alphaShort}/tasks/import`);
  }
  await alice.locator("[data-import-forget]").click();
  await alice.locator("[data-import-connect]").waitFor({ timeout: 20000 });
  check("the connection and its key can be deleted", sql("select count(*) from public.task_imports") === "0");
}

await finish("tasks");
