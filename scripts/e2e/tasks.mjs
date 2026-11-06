// Browser smoke test, part 2: freezing, the angler fish, groups and Tasks (board,
// fields, links, files, tasks in the wiki, the start page).
// Usage: node scripts/e2e/tasks.mjs status.json http://localhost:3000

import {
  ANON, API, APP, alice, aliceClient, aliceCookies, alphaId, alphaPage, alphaShort, betaId, bob, bobCookies, browser, check, colleague,
  colleagueClient, colleagueCookies, colleagueId, fakeDir, finish, makeTestPng, newPage, pageContent, pageVersion, problems, readdirSync,
  results, sessionCookies, setLastPage, sql, status, until,
} from "./common.mjs";

// What the wiki part leaves behind and this part needs: alice is platform admin,
// and Alpha has its (stand-in) Google Drive connected.
sql("update public.profiles set is_platform_admin = true where email = 'alice@alpha.test'");
if (sql(`select count(*) from public.drive_connections where workspace_id = '${alphaId}' and active`) === "0") {
  await alice.goto(`${APP}/w/${alphaShort}/settings?tab=storage`);
  await alice.getByRole("link", { name: "Підключити Google Drive" }).click();
  await alice.waitForURL(/tab=storage&drive=connected/);
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
  check("…the platform panel shows it frozen", (await betaRow.getByText("❄️ E2E freeze check").count()) === 1);
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
  check("the start page shows every service, the unbuilt ones as “Soon”", (await alice.locator("[data-service]").count()) === 15 && (await alice.locator("[data-service]", { hasText: "Скоро" }).count()) === 9);
  check("…as a launcher: no page buttons at the top", (await alice.locator("main").getByRole("button", { name: /Нова сторінка/ }).count()) === 0);
  await alice.locator('[data-service="tasks"]').getByRole("link", { name: "Rukh" }).click();
  await alice.waitForURL(new RegExp(`/w/${alphaShort}/tasks$`), { timeout: 15000 });
  check("…and a whole tile opens its service", true);
  await alice.goto(`${APP}/w/${alphaShort}`);
  await alice.locator("[data-service-switcher]").getByRole("link", { name: "Задачі" }).click();
  await alice.waitForURL(new RegExp(`/w/${alphaShort}/tasks$`), { timeout: 15000 });
  check("…and the switcher in the sidebar opens Tasks", true);
  await alice.goto(`${APP}/w/${alphaShort}/tasks`);
  const form = alice.getByRole("form", { name: "Новий проєкт" });
  await form.getByLabel("Назва проєкту").fill("Маркетинг");
  check("the project key is suggested from its name", (await form.getByLabel(/Ключ/).inputValue()) === "MAR");
  await form.getByRole("button", { name: "Створити" }).click();
  await alice.waitForURL(new RegExp(`/w/${alphaShort}/tasks/MAR$`), { timeout: 15000 });
  check("an admin makes a project and lands on it", (await alice.getByRole("heading", { name: /Маркетинг/ }).count()) === 1);
  check("…it is in the sidebar, with the fish beside it", (await alice.locator("aside [data-angler-here]").first().innerText()).includes("Маркетинг"));
  check("…and opens on the board", (await alice.locator("[data-task-board]").count()) === 1 && (await alice.locator('[data-column="Зробити"]').count()) === 1);
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR?view=list`);
  const quick = alice.getByLabel("Нова задача");
  await quick.fill("Draw the logo");
  await quick.press("Enter");
  await alice.locator('[data-task="MAR-1"]').waitFor({ timeout: 15000 });
  await quick.fill("Write the brief");
  await quick.press("Enter");
  await alice.locator('[data-task="MAR-2"]').waitFor({ timeout: 15000 });
  check("tasks are made from one line and get MAR-1, MAR-2", (await alice.locator("[data-task]").count()) === 2);
  await alice.getByLabel("Пошук за назвою чи ключем").fill("logo");
  check("the search filters the list", (await alice.locator("[data-task]").count()) === 1);
  await alice.getByLabel("Пошук за назвою чи ключем").fill("");

  await alice.locator('[data-task="MAR-1"]').getByRole("link").click();
  await alice.waitForURL(new RegExp(`/tasks/MAR/1$`));
  const colleagueId2 = sql("select id from public.profiles where email = 'colleague@alpha.test'");
  await alice.getByLabel("Статус").selectOption({ label: "В роботі" });
  await alice.waitForTimeout(800);
  await alice.getByLabel("Виконавець").selectOption(colleagueId2);
  await alice.waitForTimeout(800);
  await alice.getByLabel("Пріоритет").selectOption("high");
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
  check("…comments show, and the history tells who changed what", (await alice.getByText("Please use the new palette").count()) === 1 && (await alice.getByText(/змінив\(-ла\) статус/).count()) === 1 && (await alice.getByText(/змінив\(-ла\) виконавця/).count()) === 1);

  // Everyone in the workspace edits by default; the project can make them viewers.
  const made = await colleagueTasks.rpc("create_task", { target_project: sql("select id from public.task_projects where key = 'MAR'"), fields: { title: "From a colleague" } });
  check("a member makes tasks in the project", made.data?.key === "MAR-3", JSON.stringify(made.data));
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR?view=list`);
  await alice.getByRole("button", { name: "⚙️ Доступ і налаштування" }).click();
  const dialog = alice.getByRole("dialog", { name: /Доступ до проєкту/ });
  await dialog.getByRole("combobox").first().selectOption("viewer");
  await alice.waitForTimeout(1500);
  const colleagueTab = await newPage(colleagueTaskCookies);
  await colleagueTab.goto(`${APP}/w/${alphaShort}/tasks/MAR?view=list`);
  check("…until the project lets the workspace only view", (await colleagueTab.getByText("У цьому проєкті у вас лише перегляд.").count()) === 1 && (await colleagueTab.getByLabel("Нова задача").count()) === 0);
  const refused = await colleagueTasks.rpc("create_task", { target_project: sql("select id from public.task_projects where key = 'MAR'"), fields: { title: "Not now" } });
  check("…and the database refuses their new tasks", refused.data?.error === "forbidden", JSON.stringify(refused.data));
  await colleagueTab.close();
  await colleagueTasks.auth.signOut();

  // The project's own fields: a dropdown with its items and a toggle, then values on a task.
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  await alice.getByRole("link", { name: "🧩 Поля задач" }).click();
  await alice.waitForURL(/\/tasks\/MAR\/fields$/);
  await alice.getByRole("button", { name: "＋ Додати поле" }).click();
  const fieldForm = alice.getByRole("form", { name: "Додати поле" });
  await fieldForm.getByLabel("Назва поля").fill("Формат");
  await fieldForm.getByLabel("Формат", { exact: true }).selectOption("select");
  await fieldForm.getByLabel("Пункт 1").fill("Відео");
  await fieldForm.getByRole("button", { name: "＋ Додати пункт" }).click();
  await fieldForm.getByLabel("Пункт 2").fill("Статика");
  await fieldForm.getByRole("button", { name: "Зберегти" }).click();
  await alice.locator('[data-custom-field="Формат"]').waitFor({ timeout: 15000 });
  await alice.getByRole("button", { name: "＋ Додати поле" }).click();
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

  // The board: quick add in a column, drag a card to another, a column limit, what the card shows.
  await alice.goto(`${APP}/w/${alphaShort}/tasks/MAR`);
  await alice.locator("[data-task-board]").waitFor();
  await alice.getByLabel("Нова задача в колонці «Зробити»").fill("Board task");
  await alice.getByLabel("Нова задача в колонці «Зробити»").press("Enter");
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
  await alice.getByRole("button", { name: "🗂 Що показувати на картці" }).click();
  const cardDialog = alice.getByRole("dialog", { name: "Що показувати на картці" });
  await cardDialog.getByLabel("Автор").check();
  await cardDialog.getByLabel("🧩 Формат").check();
  await cardDialog.getByRole("button", { name: "Зберегти" }).click();
  await alice.locator('[data-card="MAR-1"] [data-card-field="Формат"]').waitFor({ timeout: 15000 }).catch(() => {});
  check("the card shows the chosen fields, own ones too", (await alice.locator('[data-card="MAR-1"] [data-card-field="Формат"]').getByText("Відео").count()) === 1);
  await cardDialog.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await alice.getByRole("button", { name: "🗂 Що показувати на картці" }).click();
  await cardDialog.getByLabel("Початок").check();
  await cardDialog.getByRole("button", { name: "Зберегти" }).click();
  await alice.locator('[data-card="MAR-1"] dt', { hasText: "Початок" }).waitFor({ timeout: 15000 }).catch(() => {});
  check("…every chosen field shows, an empty one as “—”", (await alice.locator('[data-card="MAR-1"] dt', { hasText: "Початок" }).count()) === 1);
  const marOnePriority = () => sql("select priority from public.tasks t join public.task_projects p on p.id = t.project_id where p.key = 'MAR' and t.number = 1");
  const priorityBefore = marOnePriority();
  await alice.locator('[data-card="MAR-1"] [data-card-priority]').selectOption("highest");
  check("the priority changes right on the card", await until(() => marOnePriority() === "highest", 15000), marOnePriority());
  await alice.locator('[data-card="MAR-1"] [data-card-priority]').selectOption(priorityBefore);
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
  await alice.getByLabel("Нова задача", { exact: true }).fill("Ролик");
  await alice.getByLabel("Нова задача", { exact: true }).press("Enter");
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
  check("…a task can't move under its own subtask", (await alice.locator("[data-parent-picker] option", { hasText: "MAR-5" }).count()) === 0 && (await alice.locator("[data-parent-picker] option", { hasText: "MAR-3" }).count()) === 1);
  const links = alice.locator("[data-links]");
  await links.getByLabel("Вид зв'язку").selectOption("blocked_by");
  await links.getByLabel("Ключ задачі, наприклад MKT-12").fill("mar-1");
  await links.getByRole("button", { name: "Зв'язати" }).click();
  await alice.locator('[data-link="MAR-1"]').waitFor({ timeout: 15000 });
  check("a link by key: MAR-2 is blocked by MAR-1", sql(`select kind from public.task_links where source_id = ${marTask(1)} and target_id = ${marTask(2)}`) === "blocks" && (await alice.locator("[data-blocked-notice]").count()) === 1);
  await links.getByLabel("Ключ задачі, наприклад MKT-12").fill("NOPE-1");
  await links.getByRole("button", { name: "Зв'язати" }).click();
  await alice.getByText("Задачу не знайдено або у вас немає до неї доступу.").last().waitFor({ timeout: 15000 }).catch(() => {});
  check("…a key no one can see is refused", sql(`select count(*) from public.task_links where target_id = ${marTask(2)} or source_id = ${marTask(2)}`) === "1");
  sql(`update public.tasks set description = '[{"id":"c1","type":"checkListItem","props":{"checked":false},"content":[{"type":"text","text":"Check fonts","styles":{}}],"children":[]},{"id":"c2","type":"checkListItem","props":{"checked":true},"content":[{"type":"text","text":"Done already","styles":{}}],"children":[]}]' where id = ${marTask(2)}`);
  await alice.reload();
  await alice.getByRole("button", { name: "☑ Зробити підзадачі з чек-листа опису" }).click();
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
  await alice.locator("li", { hasText: "mover@alpha.test" }).getByRole("button", { name: "Видалити" }).click();
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

  const lastLine = await alice.locator('[data-id="z3"] .bn-inline-content').first().boundingBox();
  await alice.mouse.click(lastLine.x + 5, lastLine.y + lastLine.height / 2);
  await alice.keyboard.type("@Brand new idea");
  await alice.locator(".bn-suggestion-menu-item", { hasText: "＋ MAR: «Brand new idea»" }).click({ timeout: 15000 });
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
  check("…who can't see the page yet", (await colleagueClient.rpc("effective_role", { target_page: groupPage })).data === null);
  await alice.goto(`${APP}/w/${alphaShort}/p/${groupPage}`);
  await alice.getByRole("button", { name: "Поділитися" }).click();
  const dialog = alice.getByRole("dialog", { name: "Доступ до сторінки" });
  await dialog.getByLabel("Група", { exact: true }).waitFor({ timeout: 15000 });
  await dialog.getByLabel("Група", { exact: true }).selectOption({ label: "Reviewers · 1 особа" });
  await dialog.getByLabel("Роль групи").selectOption("commenter");
  await dialog.getByRole("button", { name: "Додати" }).nth(1).click();
  await dialog.getByText("👥 Reviewers · 1 особа").waitFor({ timeout: 15000 }).catch(() => {});
  check("the page owner gives the group a role in the share dialog", (await dialog.getByText("👥 Reviewers · 1 особа").count()) === 1);
  check("…and the colleague in the group gets it", (await colleagueClient.rpc("effective_role", { target_page: groupPage })).data === "commenter");
  await alice.keyboard.press("Escape");
  await alice.goto(`${APP}/w/${alphaShort}/settings?tab=groups`);
  await alice.locator('[data-group="Reviewers"]').getByRole("button", { name: /з групи «Reviewers»/ }).click();
  await alice.locator('[data-group="Reviewers"]').getByText("учасників: 0").waitFor({ timeout: 15000 }).catch(() => {});
  check("out of the group, the access is gone", (await colleagueClient.rpc("effective_role", { target_page: groupPage })).data === null);
  await colleagueClient.auth.signOut();
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
  await gwen.getByRole("link", { name: "Мій профіль" }).waitFor({ timeout: 15000 });
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
  await gwenClient.auth.signOut();
  await gwen.close();
}

await finish("tasks");
