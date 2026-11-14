// ADMIN-1: the ecosystem's road map for the platform admin (owner) — every service's stages,
// what is done, in review, planned, paused or later, and what each stage needs.
// Kept in code (no database): every PR that moves a stage updates it here in the same PR.

import type { ServiceKey } from "@/lib/services";

type Text = { uk: string; en: string };

export type StageStatus = "done" | "review" | "planned" | "paused" | "later";
// owner: needs the owner's decision or action · external: an outside key, account, console or review
// cost: extra spending · db: risky for the database (shared data, rules, moves)
// security: risky for people's safety (sign-in, access, public links, secrets, personal data)
export type StageFlag = "owner" | "external" | "cost" | "db" | "security";

export type Stage = {
  code: string;
  title: Text;
  status: StageStatus;
  pr?: number;
  flags?: StageFlag[];
  // Added on the way, beyond the service's first plan.
  extra?: boolean;
  note?: Text;
};

export type Track = { key: string; service?: ServiceKey; icon?: "platform" | "design" | "profile" | "money"; name: Text; stages: Stage[] };

export const STAGE_STATUSES: StageStatus[] = ["done", "review", "planned", "paused", "later"];
export const STAGE_FLAGS: StageFlag[] = ["owner", "external", "cost", "db", "security"];

const s = (code: string, uk: string, en: string, status: StageStatus, more: Partial<Omit<Stage, "code" | "title" | "status">> = {}): Stage => ({ code, title: { uk, en }, status, ...more });

export const ROADMAP: Track[] = [
  {
    key: "platform",
    icon: "platform",
    name: { uk: "Платформа", en: "Platform" },
    stages: [
      s("CORE-0", "Команди, вхід, ролі, свої бази команд", "Workspaces, sign-in, roles, team-owned databases", "done", { flags: ["db", "security"] }),
      s("B-1…B-3", "Дерево підрозділів, власні ролі, доступ за структурою", "Unit tree, custom roles, access by structure", "done", { pr: 114, flags: ["db", "security"] }),
      s("SET-1", "Налаштування команди: 5 вкладок, картка учасника", "Workspace settings: 5 tabs, member card", "done", { pr: 142 }),
      s("SET-2", "Активні сеанси: завершити вхід на всіх пристроях", "Active sessions: sign out everywhere", "done", { pr: 143, flags: ["security"] }),
      s("CORE-1", "Спільне редагування: «Дизайн» і презентації", "Live co-editing: Design and slides", "done", { pr: 172, flags: ["owner"], note: { uk: "Ваша дія: у Supabase поставити час життя токена 10 хв.", en: "Your action: set the sign-in token lifetime to 10 min in Supabase." } }),
      s("CORE-2", "Спільне редагування: дошка для ідей", "Live co-editing: idea board", "done", { pr: 189 }),
      s("CORE-3", "Швидкість: доступ раз на запит (задачі, об'єкти)", "Speed: access once per query (tasks, objects)", "done", { pr: 194, flags: ["db", "security"] }),
      s("CORE-4", "Спільне редагування: карти Nodo", "Live co-editing: Nodo maps", "done", { pr: 201, flags: ["db"] }),
      s("CORE-5", "Швидкість: сторінки й записи задач", "Speed: pages and task records", "done", { pr: 204, flags: ["db", "security"] }),
      s("CORE-6", "Спільне редагування таблиць і сторінок Wika", "Live co-editing of tables and Wika pages", "planned", { flags: ["db"] }),
      s("SPD-1", "Один запит на перевірку доступу в проксі", "One call for the proxy's access check", "later", { flags: ["db"] }),
      s("REG-1", "Відкрита реєстрація з власною базою команди", "Open registration with a team's own database", "done", { flags: ["security"] }),
      s("PUSH-1", "Push-сповіщення, коли сайт закрито", "Push notifications while the site is closed", "planned", { flags: ["owner", "external"], note: { uk: "Потрібен ключ VAPID у Vercel.", en: "Needs a VAPID key in Vercel." } }),
      s("REN-1", "Перейменування EdgeKnow → Synkvela", "Rename EdgeKnow → Synkvela", "planned", { flags: ["owner", "external", "cost"], note: { uk: "Домен, адреси входу у Vercel і Supabase.", en: "Domain, sign-in addresses in Vercel and Supabase." } }),
      s("ORG-1", "Рівень організації: спільні об'єкти між командами", "Organization level: objects shared between workspaces", "later", { flags: ["db", "security"] }),
      s("ADMIN-1", "Дорожня карта в панелі платформи", "Road map in the platform panel", "review", { extra: true }),
      s("ADMIN-2", "Моніторинг команд, бази й сховища", "Monitoring of workspaces, database and storage", "planned", { extra: true, flags: ["db"] }),
      s("ADMIN-3", "Моніторинг хостингу", "Hosting monitoring", "planned", { extra: true, flags: ["owner", "external"], note: { uk: "Потрібен ключ Vercel лише для читання.", en: "Needs a read-only Vercel key." } }),
    ],
  },
  {
    key: "design-system",
    icon: "design",
    name: { uk: "Дизайн-система й спільні частини", en: "Design system and shared parts" },
    stages: [
      s("UI-0", "Нова дизайн-система: 6 кроків, власні іконки", "New design system: 6 steps, own icons", "done", { pr: 149 }),
      s("UI-1", "Розумні чипи: Wika й задачі", "Smart chips: Wika and tasks", "done", { pr: 197 }),
      s("UI-2", "Чипи в клітинках таблиць", "Chips in table cells", "done", { pr: 198 }),
      s("UI-3", "Чипи на дошках, картах, у подіях", "Chips on boards, maps, events", "done", { pr: 199 }),
      s("UI-4", "Чипи в полях задач і на слайдах", "Chips in task fields and slides", "done", { pr: 205 }),
      s("UI-5", "Дії з файлами в списках", "File actions in lists", "done", { pr: 211, extra: true }),
      s("UI-5b", "Копія з власними картинками", "A copy with its own pictures", "done", { pr: 212, extra: true }),
      s("UI-6", "Менше тексту в браузер: лише поточна мова", "Less sent to the browser: only the current language", "later"),
    ],
  },
  {
    key: "wiki",
    service: "wiki",
    name: { uk: "Wika — знання", en: "Wika — knowledge" },
    stages: [
      s("WIKA-0", "Сторінки, дерево, доступи, коментарі", "Pages, tree, access, comments", "done", { flags: ["db", "security"] }),
      s("WIKA-ACK", "Підтвердження прочитання", "Read confirmations", "done", { pr: 120 }),
      s("WIKA-EXP", "Експорт: посилання, PDF, MD", "Export: link, PDF, MD", "done"),
      s("WIKA-DRAFT", "Чернетки й «Опублікувати»", "Drafts and Publish", "done", { flags: ["db", "security"] }),
      s("WIKA-HIST", "Історія версій сторінки", "Page version history", "done", { pr: 136 }),
      s("WIKA-GAL", "Блок «Галерея»", "Gallery block", "done", { extra: true }),
      s("WIKA-TPL", "Шаблони сторінок", "Page templates", "later"),
      s("WIKA-PUB", "Публічна база знань", "Public knowledge base", "later", { flags: ["owner", "security"] }),
      s("WIKA-PROMISE", "Глосарій, «що змінилось», термін перегляду, онбординг", "Glossary, what changed, review-by date, onboarding", "later", { note: { uk: "Обіцяно на лендінгу як «Скоро».", en: "Promised on the landing as Soon." } }),
    ],
  },
  {
    key: "tasks",
    service: "tasks",
    name: { uk: "Rukh — задачі", en: "Rukh — tasks" },
    stages: [
      s("RUKH-0", "Проєкти, дошки, поля, шаблони, приватні задачі", "Projects, boards, fields, templates, private tasks", "done", { flags: ["db", "security"] }),
      s("Р-1/Р-2", "Картка задачі, швидкий перегляд, дерево ліворуч", "Task card, quick view, left tree", "done", { pr: 151 }),
      s("Р-3а", "Перенесення з іншого трекера: майстер", "Move from another tracker: wizard", "done", { pr: 152, flags: ["external"] }),
      s("PKG-1…4", "Усе для переїзду: доріжки, коментарі, файли, час, повтори", "Everything for the move: lanes, comments, files, time, repeats", "done", { pr: 158, flags: ["db"] }),
      s("Д-1…Д-3", "Доступи один в один зі схемою трекера", "Permissions one to one with the tracker's scheme", "done", { pr: 162, flags: ["db", "security"] }),
      s("RUKH-1", "Посилання задач при перенесенні команди", "Task links when a workspace moves", "done", { pr: 186, flags: ["db"] }),
      s("RUKH-2", "Дата завершення йде за колонкою", "Done date follows the column", "done", { pr: 191, flags: ["db"] }),
      s("RUKH-MOVE", "Справжній переїзд на тестовому акаунті", "Real move on the test account", "paused", { flags: ["owner", "external"], note: { uk: "Чекає вашого повернення: справжній трекер і Google Диск.", en: "Waits for you: the real tracker and Google Drive." } }),
      s("RUKH-SPRINT", "Спринти", "Sprints", "paused", { flags: ["owner"] }),
      s("RUKH-BULK", "Масові дії на дошці", "Bulk actions on the board", "later"),
    ],
  },
  {
    key: "calendar",
    service: "calendar",
    name: { uk: "Doba — календар і відпустки", en: "Doba — calendar and time off" },
    stages: [
      s("DOBA-1", "Події й відпустки", "Events and time off", "done", { pr: 130, flags: ["db"] }),
      s("DOBA-2", "Повтори, нагадування, політики відпусток", "Repeats, reminders, leave policies", "done", { pr: 137 }),
      s("DOBA-3а", "Власна стрічка для календарних застосунків", "Own feed for calendar apps", "done", { pr: 138, flags: ["security"] }),
      s("DOBA-3б", "Зайнятість із зовнішнього календаря", "Busy time from an outside calendar", "done", { pr: 139, flags: ["owner", "external"], note: { uk: "Потрібен CALENDAR_TOKEN_KEY у Vercel.", en: "Needs CALENDAR_TOKEN_KEY in Vercel." } }),
      s("DOBA-3в", "Вхід через провайдера календаря", "Sign-in with a calendar provider", "paused", { flags: ["owner", "external", "security"], note: { uk: "Налаштування й перевірка застосунку в консолі провайдера.", en: "App setup and review in the provider's console." } }),
      s("DOBA-BDAY", "Дні народження", "Birthdays", "done", { pr: 167, extra: true, flags: ["security"] }),
      s("DOBA-DRAG", "Перетягування подій, створення на телефоні", "Dragging events, creating on a phone", "later"),
    ],
  },
  {
    key: "boards",
    service: "boards",
    name: { uk: "Bordy — дошки й «Дизайн»", en: "Bordy — boards and Design" },
    stages: [
      s("BORDY-0", "Дошка для ідей: стікери, голосування, таймер", "Idea board: stickies, voting, timer", "done"),
      s("Д-1…Д-4", "«Дизайн»: рамки, автомакет, перо, прототипи, експорт", "Design: frames, auto layout, pen, prototypes, export", "done", { pr: 119 }),
      s("BORDY-1", "Коментарі на полотні, компоненти й варіанти", "Comments on the canvas, components and variants", "done", { pr: 210, flags: ["db"] }),
      s("BORDY-2", "Історія версій рамки, зміни всередині копій", "Frame version history, overrides inside copies", "later"),
    ],
  },
  {
    key: "nodes",
    service: "nodes",
    name: { uk: "Nodo — карти й схеми", en: "Nodo — maps and flows" },
    stages: [
      s("NODO-0", "Ментальні карти й схеми", "Mind maps and flows", "done"),
      s("CORE-4", "Спільне редагування карт", "Live co-editing of maps", "done", { pr: 201, flags: ["db"] }),
      s("NODO-1", "Спільне редагування схем", "Live co-editing of flows", "later"),
    ],
  },
  {
    key: "sheets",
    service: "sheets",
    name: { uk: "Sota — таблиці", en: "Sota — tables" },
    stages: [
      s("SOTA-0", "Таблиці, формули, діаграми, XLSX/CSV", "Tables, formulas, charts, XLSX/CSV", "done"),
      s("SOTA-1", "Розлив формул і LAMBDA", "Spilling formulas and LAMBDA", "done", { pr: 208 }),
      s("SOTA-2", "Власні скрипти в пісочниці", "Own scripts in a sandbox", "later", { flags: ["security"] }),
    ],
  },
  {
    key: "slides",
    service: "slides",
    name: { uk: "Kadry — презентації", en: "Kadry — presentations" },
    stages: [
      s("П-1…П-3", "Редактор, вигляд, показ, вбудовування", "Editor, look, show, embeds", "done", { pr: 118 }),
      s("KADRY-1", "Поява об'єктів і показ за посиланням", "Builds and a show link", "done", { pr: 209, flags: ["db", "security"] }),
    ],
  },
  {
    key: "surveys",
    service: "surveys",
    name: { uk: "Questa — опитування", en: "Questa — surveys" },
    stages: [
      s("QUESTA-0", "Опитування, відкриті форми, результати", "Surveys, open forms, results", "done", { flags: ["security"] }),
      s("QUESTA-TS", "Перевірка Turnstile на відкритих формах", "Turnstile check on open forms", "planned", { flags: ["owner", "external"], note: { uk: "Обидва ключі Turnstile у Vercel.", en: "Both Turnstile keys in Vercel." } }),
    ],
  },
  {
    key: "files",
    service: "files",
    name: { uk: "Vault — файли", en: "Vault — files" },
    stages: [
      s("VAULT-1", "«Усі файли»", "All files", "done", { pr: 190 }),
      s("VAULT-2", "Власні папки й файли", "Own folders and files", "done", { pr: 192, flags: ["db", "security"] }),
      s("VAULT-2б", "Доступи на Google Диску команди", "Access on the team's Google Drive", "done", { pr: 203, flags: ["external", "security"] }),
      s("VAULT-3", "Файл Vault в інших сервісах", "A Vault file in other services", "done", { pr: 193 }),
      s("VAULT-4", "Облік місця, передача файлів", "Space count, handing files over", "done", { pr: 196, flags: ["db"] }),
      s("VAULT-5", "Дрібниці після Vault", "Small fixes after Vault", "done", { pr: 200 }),
      s("VAULT-6", "Версії файлів", "File versions", "done", { pr: 202, flags: ["db"] }),
      s("VAULT-7", "Диск команди всередині", "The team's Drive inside", "done", { pr: 207, flags: ["db", "external", "security"] }),
    ],
  },
  {
    key: "chat",
    service: "chat",
    name: { uk: "Toker — чат", en: "Toker — chat" },
    stages: [
      s("TOKER-1", "Канали, гілки, реакції, згадки", "Channels, threads, reactions, mentions", "done", { pr: 174, flags: ["db", "security"] }),
      s("TOKER-2", "Розмови, файли й голосові, пошук", "Conversations, files and voice, search", "done", { pr: 180, flags: ["db"] }),
      s("TOKER-3", "Живі картки, задача з повідомлення, опитування", "Live cards, task from a message, surveys", "done", { pr: 185 }),
      s("TOKER-3в-2", "Погодження відпусток у повідомленні", "Time-off approval in a message", "paused", { flags: ["owner", "db"] }),
      s("TOKER-4", "Зберігання, «Мої дані», Web Push, PWA", "Retention, My data, Web Push, PWA", "planned", { flags: ["external", "security"] }),
      s("TOKER-5", "Секретні кімнати з шифруванням", "Secret rooms with encryption", "later", { flags: ["owner", "security"] }),
      s("TOKER-6", "Форуми, голосові кімнати, спільні канали компаній", "Forums, voice rooms, cross-company channels", "later", { flags: ["cost", "security"] }),
      s("TOKER-7", "Програми для комп'ютера й телефону", "Desktop and phone apps", "later", { flags: ["external", "cost"] }),
    ],
  },
  {
    key: "apps",
    service: "apps",
    name: { uk: "Obriy — корпоративні додатки", en: "Obriy — company apps" },
    stages: [
      s("О-1", "Галерея зовнішніх додатків команди", "Gallery of the team's outside apps", "done", { pr: 141 }),
      s("О-2", "Фінансовий моніторинг усередині", "Financial monitoring inside", "planned", { flags: ["owner", "db", "security"], note: { uk: "Потрібен репозиторій модуля.", en: "Needs the module's repository." } }),
    ],
  },
  {
    key: "profile",
    icon: "profile",
    name: { uk: "Профіль і вішлісти", en: "Profile and wishlists" },
    stages: [
      s("PROF-1…4", "Профіль, вішлісти, картки в сервісах", "Profile, wishlists, cards in services", "done", { pr: 187, extra: true, flags: ["security"] }),
      s("APUS-1", "Маскот Apus і меню", "Apus mascot and menu", "done", { extra: true }),
      s("GAME-1", "Міні-гра «Територія» з Apus", "Mini-game Territory with Apus", "later", { extra: true, flags: ["cost", "security"] }),
    ],
  },
  {
    key: "meet",
    service: "meet",
    name: { uk: "Visio — відеозустрічі", en: "Visio — video meetings" },
    stages: [s("VISIO-1", "План: відео з каналів, календаря й задач", "Plan: video from channels, calendar and tasks", "planned", { flags: ["owner", "cost", "external", "security"], note: { uk: "Спершу перевірити вартість сервера для відео.", en: "Check the video server's cost first." } })],
  },
  {
    key: "ai",
    service: "ai",
    name: { uk: "Apus AI", en: "Apus AI" },
    stages: [s("APUS-AI-1", "Помічник із ключем команди, розшифровка, підсумки", "Helper with the team's key, transcription, summaries", "later", { flags: ["external", "cost", "security"] })],
  },
  {
    key: "sites",
    service: "sites",
    name: { uk: "Showy — персональна сторінка", en: "Showy — personal page" },
    stages: [s("SHOWY-1", "Сторінка компанії з блоків, візитки", "Company page from blocks, business cards", "planned", { flags: ["owner", "security"] })],
  },
  {
    key: "crm",
    service: "crm",
    name: { uk: "Spilno — CRM", en: "Spilno — CRM" },
    stages: [s("SPILNO-1", "План сервісу", "Service plan", "planned", { flags: ["owner", "db", "security"] })],
  },
  {
    key: "money",
    icon: "money",
    name: { uk: "Оплата й тарифи", en: "Payments and plans" },
    stages: [
      s("PAY-0", "Тарифи погоджено", "Plans agreed", "done", { flags: ["owner"] }),
      s("PAY-1", "Перевірити ціни сервісів і податки з бухгалтером", "Check service prices and taxes with an accountant", "planned", { flags: ["owner", "external"] }),
      s("PAY-2", "Оплата, позначки PRO, ліміти Free", "Payments, PRO marks, Free limits", "later", { flags: ["owner", "external", "cost", "db", "security"] }),
      s("PAY-3", "Ліміт пристроїв на пошту", "Device limit per email", "later", { flags: ["owner", "security"] }),
    ],
  },
];

export const roadmapCounts = (tracks: Track[] = ROADMAP) => {
  const all = tracks.flatMap((track) => track.stages);
  const status = Object.fromEntries(STAGE_STATUSES.map((key) => [key, all.filter((stage) => stage.status === key).length])) as Record<StageStatus, number>;
  // Flags count what is still ahead — done stages no longer need anything.
  const open = all.filter((stage) => stage.status !== "done");
  const flags = Object.fromEntries(STAGE_FLAGS.map((key) => [key, open.filter((stage) => stage.flags?.includes(key)).length])) as Record<StageFlag, number>;
  return { total: all.length, status, flags, extra: all.filter((stage) => stage.extra).length };
};
