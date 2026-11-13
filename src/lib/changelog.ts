// «What's new»: the release history, newest first. Each item names what kind of
// change it is and where it happened. Added by hand with each release; both languages.
export type UpdateActionType = "added" | "improved" | "fixed" | "visual" | "deprecated";

export type ServiceScope =
  | "wiki" | "tasks" | "board" | "nodes" | "sheets" | "slides"
  | "forms" | "chat" | "files" | "calendar" | "meet" | "ai"
  | "sites" | "apps" | "crm"
  | "global" | "profile" | "security" | "storage" | "integrations";

type Text = { uk: string; en: string };

export interface UpdateItem {
  id: string;
  type: UpdateActionType;
  scope: ServiceScope;
  title: Text;
  description?: Text;
}

export interface ReleaseLog {
  id: string; // also the link anchor: #release-<id>
  version: string;
  date: string; // ISO 8601
  summaryTitle: Text;
  summaryDescription?: Text;
  // A picture, or a short MP4/WebM/GIF, from /public; opens full screen.
  media?: { src: string; kind: "image" | "video"; alt: Text };
  items: UpdateItem[];
}

export const ACTION_TYPES: UpdateActionType[] = ["added", "improved", "fixed", "visual", "deprecated"];

export const RELEASES: ReleaseLog[] = [
  {
    id: "2026-11-13-faster-pages",
    version: "0.52.1",
    date: "2026-11-13",
    summaryTitle: { uk: "Швидше відкриваються сторінки й коментарі", en: "Pages and comments open faster" },
    items: [
      { id: "faster-pages", type: "improved", scope: "global", title: { uk: "Права на сторінки, коментарі й файли задач перевіряються раз на запит: великі списки відкриваються в рази швидше. Хто що бачить — не змінилося.", en: "Access to pages, task comments and files is checked once per request: large lists open several times faster. Who sees what is unchanged." } },
    ],
  },
  {
    id: "2026-11-13-live-maps",
    version: "0.53.0",
    date: "2026-11-13",
    summaryTitle: { uk: "Карти Nodo — разом наживо", en: "Nodo maps, live together" },
    items: [
      { id: "live-maps", type: "added", scope: "nodes", title: { uk: "Ментальні карти редагуються разом: зміни, курсори й «Стежити за людиною», як у презентаціях.", en: "Mind maps are edited together: changes, cursors and \"Follow\", as in presentations." } },
    ],
  },
  {
    id: "2026-11-13-vault-versions",
    version: "0.52.0",
    date: "2026-11-13",
    summaryTitle: { uk: "Vault: версії файлів", en: "Vault: file versions" },
    items: [
      { id: "vault-new-version", type: "added", scope: "files", title: { uk: "«Нова версія» замінює файл скрізь, де він вставлений; попередні версії зберігаються.", en: "\"New version\" replaces the file wherever it is inserted; earlier versions are kept." } },
      { id: "vault-versions-list", type: "added", scope: "files", title: { uk: "«Версії»: відкрити, зробити поточною або видалити попередню версію.", en: "\"Versions\": open, make current or delete an earlier version." } },
    ],
  },
  {
    id: "2026-11-13-chips-step3",
    version: "0.51.1",
    date: "2026-11-13",
    summaryTitle: { uk: "Чипи на дошках, у картах і подіях", en: "Chips on boards, maps and events" },
    items: [
      { id: "chips-boards", type: "added", scope: "board", title: { uk: "Елемент дошки з посиланням показує чип з актуальною назвою; кнопка «Чип» додає посилання.", en: "A board element with a link shows a chip with the current title; the \"Chip\" button adds a link." } },
      { id: "chips-maps", type: "added", scope: "nodes", title: { uk: "Вузол карти можна прив'язати до сторінки, задачі, таблиці чи файлу — під текстом з'явиться чип.", en: "A map node can link to a page, task, table or file — a chip shows under its text." } },
      { id: "chips-events", type: "added", scope: "calendar", title: { uk: "Посилання в описі події показуються чипами.", en: "Links in an event's description show as chips." } },
    ],
  },
  {
    id: "2026-11-13-vault-space",
    version: "0.51.0",
    date: "2026-11-13",
    summaryTitle: { uk: "Vault: скільки місця займають файли", en: "Vault: how much space files take" },
    items: [
      { id: "vault-used", type: "added", scope: "files", title: { uk: "«Зайнято» у Vault — за сервісами; бачать власник і адміністратори простору.", en: "\"Used\" in Vault by service; seen by the workspace's owner and admins." } },
      { id: "vault-quota", type: "fixed", scope: "storage", title: { uk: "Ліміт сховища тепер однаково рахує файли всіх сервісів разом із Vault.", en: "The storage limit now counts every service's files, Vault included, the same way." } },
      { id: "vault-handover", type: "added", scope: "files", title: { uk: "«Передати» для колишнього учасника передає й його файли Vault; вони є й у «Мої дані».", en: "\"Hand over\" for a former member also hands over their Vault files; they are in \"My data\" too." } },
    ],
  },
  {
    id: "2026-11-13-sheet-chips",
    version: "0.50.0",
    date: "2026-11-13",
    summaryTitle: { uk: "Чипи в таблицях", en: "Chips in tables" },
    items: [
      { id: "sheet-chips", type: "added", scope: "sheets", title: { uk: "Посилання на сторінку, задачу, дошку чи файл у клітинці показується чипом з актуальною назвою; «Вставити чип» над таблицею.", en: "A link to a page, task, board or file in a cell shows as a chip with its current title; \"Insert chip\" above the table." } },
    ],
  },
  {
    id: "2026-11-13-smart-chips",
    version: "0.49.0",
    date: "2026-11-13",
    summaryTitle: { uk: "Розумні чипи всюди", en: "Smart chips everywhere" },
    summaryDescription: {
      uk: "Згадайте будь-яку таблицю, дошку, карту, презентацію, опитування, застосунок, ВішЛіст чи файл — у Wika й в описі задачі.",
      en: "Mention any table, board, map, presentation, survey, app, wishlist or file — in the wiki and in task descriptions.",
    },
    items: [
      { id: "chips-at", type: "added", scope: "wiki", title: { uk: "«@» знаходить таблиці, дошки, карти, презентації, опитування, застосунки, ВішЛісти й файли Vault і вставляє їх чипом з актуальною назвою.", en: "\"@\" finds tables, boards, maps, presentations, surveys, apps, wishlists and Vault files and inserts them as a chip with the current title." } },
      { id: "chips-tasks", type: "added", scope: "tasks", title: { uk: "В описі задачі тепер є чипи: сторінки, задачі, події й будь-які об'єкти.", en: "Task descriptions now take chips: pages, tasks, events and any object." } },
      { id: "chips-paste", type: "added", scope: "global", title: { uk: "Вставлене посилання на щось у вашому просторі одразу стає чипом.", en: "A pasted link to something in your workspace turns into a chip." } },
      { id: "chips-access", type: "improved", scope: "security", title: { uk: "Хто не має доступу, бачить «Немає доступу» без назви.", en: "Without access a chip shows \"No access\" and no title." } },
    ],
  },
  {
    id: "2026-11-13-faster-access",
    version: "0.48.1",
    date: "2026-11-13",
    summaryTitle: { uk: "Швидше відкриваються задачі", en: "Tasks open faster" },
    items: [
      { id: "faster-access", type: "improved", scope: "global", title: { uk: "Права доступу до задач, сторінок і файлів сервісів перевіряються раз на запит, а не для кожного рядка: великі списки задач відкриваються в рази швидше. Хто що бачить — не змінилося.", en: "Access to tasks, pages and service files is checked once per request instead of for every row: large task lists open several times faster. Who sees what is unchanged." } },
    ],
  },
  {
    id: "2026-11-13-vault-embeds",
    version: "0.48.0",
    date: "2026-11-13",
    summaryTitle: { uk: "Файли з Vault у сторінках, задачах, презентаціях і чаті", en: "Vault files in pages, tasks, presentations and chat" },
    summaryDescription: {
      uk: "Кнопка «Із Vault» вставляє картку файлу. Її бачать ті, кому файл відкритий; іншим — «Файл недоступний».",
      en: "\"From Vault\" inserts a file's card. Those the file is open to see it; others see \"File unavailable\".",
    },
    items: [
      { id: "vault-embed-wiki", type: "added", scope: "wiki", title: { uk: "Блок «Файл із Vault» на сторінці (меню «/»).", en: "A \"File from Vault\" block on a page (the \"/\" menu)." } },
      { id: "vault-embed-tasks", type: "added", scope: "tasks", title: { uk: "«Із Vault» у вкладеннях задачі.", en: "\"From Vault\" in a task's attachments." } },
      { id: "vault-embed-slides", type: "added", scope: "slides", title: { uk: "Файл із Vault у презентації, файлі «Дизайн» і на дошці для ідей.", en: "A Vault file in a presentation, a \"Design\" file and on an idea board." } },
      { id: "vault-embed-chat", type: "added", scope: "chat", title: { uk: "«Із Vault» у повідомленні чату: файл показується карткою.", en: "\"From Vault\" in a chat message: the file shows as a card." } },
    ],
  },
  {
    id: "2026-11-13-done-date",
    version: "0.47.1",
    date: "2026-11-13",
    summaryTitle: { uk: "Дата завершення задач", en: "Task done dates" },
    items: [
      { id: "done-date-board", type: "fixed", scope: "tasks", title: { uk: "Задача, перетягнута в «Готово» на дошці чи кнопкою статусу, тепер має дату завершення й потрапляє в аналітику.", en: "A task moved to \"Done\" on the board or with a status button now gets its done date and shows in analytics." } },
      { id: "done-date-reopen", type: "fixed", scope: "tasks", title: { uk: "Задача, повернута з «Готово» в роботу, знову видно в «Моїх задачах».", en: "A task moved back out of \"Done\" shows in \"My tasks\" again." } },
    ],
  },
  {
    id: "2026-11-13-vault-folders",
    version: "0.47.0",
    date: "2026-11-13",
    summaryTitle: { uk: "Vault: власні папки й файли команди", en: "Vault: the team's own folders and files" },
    summaryDescription: {
      uk: "Папки, завантаження перетягуванням, доступ як на спільному диску, кошик на 30 днів і ліміт розміру від адміністратора.",
      en: "Folders, drag-and-drop uploads, access as on a shared drive, a 30-day bin and a size limit set by an admin.",
    },
    items: [
      { id: "vault-folders", type: "added", scope: "files", title: { uk: "Папки й файли у Vault: створення, завантаження, перейменування, переміщення, кошик.", en: "Folders and files in Vault: create, upload, rename, move, bin." } },
      { id: "vault-access", type: "added", scope: "security", title: { uk: "Доступ до папки чи файлу: усім у просторі, окремим людям і підрозділам або лише запрошеним. Гості Vault не бачать.", en: "Access to a folder or file: everyone in the workspace, particular people and units, or invited only. Guests don't see Vault." } },
      { id: "vault-large", type: "added", scope: "storage", title: { uk: "Великі файли йдуть на Google Диск простору частинами; адміністратор може обмежити розмір файлу.", en: "Large files go to the workspace's Google Drive in parts; an admin can limit a file's size." } },
    ],
  },
  {
    id: "2026-11-13-vault",
    version: "0.46.0",
    date: "2026-11-13",
    summaryTitle: { uk: "Vault: усі файли в одному місці", en: "Vault: every file in one place" },
    summaryDescription: {
      uk: "Файли сторінок, задач, чату, дошок, презентацій та опитувань в одному списку. Ви бачите лише те, що бачите й у самих сервісах.",
      en: "Files of pages, tasks, chat, boards, presentations and surveys in one list. You see only what you also see in the services.",
    },
    items: [
      { id: "vault-all", type: "added", scope: "files", title: { uk: "Розділ Vault: список або плитка, фільтр за сервісом і типом, пошук, сортування.", en: "The Vault section: list or grid, filter by service and type, search, sort." } },
      { id: "vault-preview", type: "added", scope: "files", title: { uk: "Перегляд зображень, аудіо й відео, «Перейти туди» до місця, де файл використано, і завантаження.", en: "Preview of images, audio and video, \"Go there\" to where the file is used, and download." } },
    ],
  },
  {
    id: "2026-11-13-live-boards",
    version: "0.45.0",
    date: "2026-11-13",
    summaryTitle: { uk: "Дошка для ідей — разом наживо", en: "Idea boards, live together" },
    summaryDescription: {
      uk: "Нотатки, фігури й малюнки на дошці для ідей з'являються в усіх одразу; курсори й «Стежити за людиною» — як у презентаціях.",
      en: "Sticky notes, shapes and drawings on an idea board show for everyone at once; cursors and \"Follow\" as in presentations.",
    },
    items: [
      { id: "live-board-edit", type: "added", scope: "board", title: { uk: "Зміни на дошці для ідей видно всім одразу; дві зміни водночас не губляться.", en: "Changes on an idea board show for everyone at once; two changes at the same time are both kept." } },
      { id: "live-board-cursors", type: "added", scope: "board", title: { uk: "Аватари, курсори з іменами, рамки виділення й «Стежити за людиною» на дошці для ідей.", en: "Avatars, cursors with names, selection outlines and \"Follow\" on idea boards." } },
      { id: "live-board-undo", type: "improved", scope: "board", title: { uk: "«Скасувати» прибирає лише ваші дії, а не чужі.", en: "Undo takes back only your own changes, not others'." } },
    ],
  },
  {
    id: "2026-11-12-live",
    version: "0.44.0",
    date: "2026-11-12",
    summaryTitle: { uk: "Спільне редагування наживо", en: "Live co-editing" },
    summaryDescription: {
      uk: "Презентації й файли «Дизайну» можна редагувати разом: зміни, курсори й «Стежити за людиною». Вмикає власник workspace.",
      en: "Presentations and \"Design\" files can be edited together: changes, cursors and \"Follow\". The workspace owner turns it on.",
    },
    items: [
      { id: "live-switch", type: "added", scope: "global", title: { uk: "Перемикач «Спільне редагування в реальному часі» в налаштуваннях workspace (лише власник, за замовчуванням вимкнено).", en: "A \"Real-time co-editing\" switch in the workspace settings (owner only, off by default)." } },
      { id: "live-edit", type: "added", scope: "slides", title: { uk: "Зміни інших з'являються одразу; аватари учасників, курсори з іменами й рамки їхнього виділення.", en: "Others' changes show at once; avatars, cursors with names and outlines of what they selected." } },
      { id: "live-follow", type: "added", scope: "board", title: { uk: "«Стежити за людиною»: ваш екран іде за її слайдом чи сторінкою; людина бачить, хто за нею стежить.", en: "\"Follow\": your view goes where theirs goes; the person sees who follows them." } },
      { id: "live-viewers", type: "added", scope: "security", title: { uk: "Курсори глядачів — лише з дозволу редактора документа; змінити документ глядач не може (перевіряє база).", en: "Viewers' cursors only if an editor of the document allows them; a viewer can't change the document (the database checks)." } },
    ],
  },
  {
    id: "2026-11-12-birthdays",
    version: "0.43.0",
    date: "2026-11-12",
    summaryTitle: { uk: "Дні народження", en: "Birthdays" },
    summaryDescription: {
      uk: "Дні народження колег — у календарі, на головному екрані й у дзвіночку. Рік бачите лише ви.",
      en: "Colleagues' birthdays — in the calendar, on the home screen and in the bell. Only you see the year.",
    },
    items: [
      { id: "birthday-profile", type: "added", scope: "calendar", title: { uk: "Свій день народження вказується в профілі; можна приховати від колег.", en: "Set your birthday in the profile; you can hide it from colleagues." } },
      { id: "birthday-home", type: "added", scope: "calendar", title: { uk: "На головному екрані — блок «Сьогодні святкуємо» і найближчі дні народження.", en: "The home screen shows “Celebrating today” and the birthdays coming up." } },
      { id: "birthday-bell", type: "added", scope: "calendar", title: { uk: "Нагадування в дзвіночок у день народження колеги з вашого підрозділу.", en: "A reminder in the bell on the birthday of a colleague from your unit." } },
    ],
  },
  {
    id: "2026-11-12-j",
    version: "0.42.0",
    date: "2026-11-12",
    summaryTitle: { uk: "Rukh: дозволи переїжджають разом із задачами", en: "Rukh: permissions move in with the tasks" },
    items: [
      { id: "import-scheme", type: "added", scope: "tasks", title: { uk: "Майстер перенесення читає схему дозволів трекера й показує, хто що зможе, ще до перенесення.", en: "The import wizard reads the tracker's permission scheme and shows who will be able to do what before the move." } },
      { id: "import-groups", type: "added", scope: "tasks", title: { uk: "Групи трекера стають підрозділами — наявними або новими.", en: "The tracker's groups become units, existing or new." } },
    ],
  },
  {
    id: "2026-11-12-i",
    version: "0.41.0",
    date: "2026-11-12",
    summaryTitle: { uk: "Rukh: більше видів полів", en: "Rukh: more kinds of fields" },
    items: [
      { id: "field-kinds", type: "added", scope: "tasks", title: { uk: "Нові поля задач: тривалість, мова, гео, валюта, заголовок і роздільник.", en: "New task fields: duration, language, geo, currency, heading and divider." } },
      { id: "field-multi", type: "improved", scope: "tasks", title: { uk: "Кілька варіантів обираються у випадному списку з галочками; у списках є «Інше».", en: "Several choices are picked in a drop-down with tick boxes; lists take an own value." } },
      { id: "field-tools", type: "improved", scope: "tasks", title: { uk: "Поле можна змінити, скопіювати й зробити на пів ширини просто в задачі.", en: "A field can be edited, copied and made half width right in a task." } },
    ],
  },
  {
    id: "2026-11-12-h",
    version: "0.40.0",
    date: "2026-11-12",
    summaryTitle: { uk: "Rukh: дозволи для коментарів, вкладень і часу", en: "Rukh: permissions for comments, attachments and time" },
    items: [
      { id: "permissions-more", type: "added", scope: "tasks", title: { uk: "Дозволи проєкту охоплюють коментарі, вкладення й час — «свої» окремо від «будь-чиїх».", en: "A project's permissions cover comments, attachments and time, one's own apart from anyone's." } },
      { id: "permissions-board", type: "improved", scope: "tasks", title: { uk: "Дошка перетягує й створює задачі за дозволами проєкту.", en: "The board drags and makes tasks by the project's permissions." } },
    ],
  },
  {
    id: "2026-11-12-g",
    version: "0.39.0",
    date: "2026-11-12",
    summaryTitle: { uk: "Rukh: дозволи проєкту", en: "Rukh: project permissions" },
    items: [
      { id: "permissions", type: "added", scope: "tasks", title: { uk: "Для кожної дії із задачами можна задати, хто її виконує: ролі, підрозділи, люди, автор чи виконавець.", en: "For each action on tasks a project can say who may do it: roles, units, people, the author or the assignee." } },
    ],
  },
  {
    id: "2026-11-12-f",
    version: "0.38.0",
    date: "2026-11-12",
    summaryTitle: { uk: "Rukh: повторювані задачі", en: "Rukh: repeating tasks" },
    items: [
      { id: "repeat", type: "added", scope: "tasks", title: { uk: "Задачу можна повторювати кожні N діб, тижнів, місяців або років.", en: "A task can repeat every N days, weeks, months or years." } },
    ],
  },
  {
    id: "2026-11-12-e",
    version: "0.37.0",
    date: "2026-11-12",
    summaryTitle: { uk: "Rukh: більші вкладення", en: "Rukh: larger attachments" },
    items: [
      { id: "large-files", type: "added", scope: "tasks", title: { uk: "Для проєкту можна підняти розмір вкладень до 250 МБ (архів ZIP — до 10 ГБ); такі файли зберігаються на Google Drive команди.", en: "A project's attachments can go up to 250 MB (a ZIP archive up to 10 GB); such files are kept on the team's Google Drive." } },
    ],
  },
  {
    id: "2026-11-12-d",
    version: "0.36.0",
    date: "2026-11-12",
    summaryTitle: { uk: "Rukh: облік часу й «Мої задачі»", en: "Rukh: time tracking and \"My tasks\"" },
    items: [
      { id: "time-log", type: "added", scope: "tasks", title: { uk: "Облік часу в задачах: вмикається в проєкті, з вибором, хто бачить записи.", en: "Time tracking on tasks: turned on per project, with a choice of who sees the entries." } },
      { id: "time-import", type: "added", scope: "tasks", title: { uk: "Записи часу переносяться з іншого трекера.", en: "Time entries come over from another tracker." } },
      { id: "my-tasks", type: "added", scope: "tasks", title: { uk: "«Мої задачі»: відкриті задачі з усіх проєктів за термінами.", en: "\"My tasks\": open tasks from every project by due date." } },
    ],
  },
  {
    id: "2026-11-12-c",
    version: "0.35.0",
    date: "2026-11-12",
    summaryTitle: { uk: "Rukh: оновлене вікно задачі", en: "Rukh: the task window, rearranged" },
    items: [
      { id: "card-order", type: "visual", scope: "tasks", title: { uk: "Статуси над назвою, власні поля під нею, файли під описом; підзадачі й зв'язки — у властивостях.", en: "Statuses over the title, own fields under it, files under the description; subtasks and links in the properties." } },
      { id: "card-files", type: "improved", scope: "tasks", title: { uk: "Файли плиткою або списком, із фільтром за видом.", en: "Files as tiles or a list, with a filter by kind." } },
      { id: "card-links", type: "added", scope: "tasks", title: { uk: "До задачі можна додати посилання на файл чи сторінку.", en: "A link to a file or a page can be kept with a task." } },
      { id: "card-priority", type: "visual", scope: "tasks", title: { uk: "У списку пріоритетів — іконки.", en: "Priorities are listed with their marks." } },
    ],
  },
  {
    id: "2026-11-12-b",
    version: "0.34.0",
    date: "2026-11-12",
    summaryTitle: { uk: "Rukh: оновлення з трекера й пошук за старим ключем", en: "Rukh: updating from the tracker and finding by the old key" },
    items: [
      { id: "import-refresh", type: "added", scope: "tasks", title: { uk: "«Оновити з трекера» підтягує лише те, що змінилося після перенесення.", en: "\"Update from the tracker\" brings only what changed since the move." } },
      { id: "task-finder", type: "added", scope: "tasks", title: { uk: "Задачу можна відкрити за старим ключем або посиланням з трекера.", en: "A task opens by its old key or a link from the tracker." } },
    ],
  },
  {
    id: "2026-11-12-a",
    version: "0.33.0",
    date: "2026-11-12",
    summaryTitle: { uk: "Rukh: файли з іншого трекера", en: "Rukh: files from another tracker" },
    items: [
      { id: "import-files", type: "added", scope: "tasks", title: { uk: "Файли задач переносяться на Google Drive команди: до 250 МБ, архів — до 10 ГБ.", en: "Task files move to the team's Google Drive: up to 250 MB, an archive up to 10 GB." } },
      { id: "import-gaps", type: "added", scope: "tasks", title: { uk: "Що не перенеслося, видно списком; «Дотягнути» пробує ще раз.", en: "What did not come over is listed; \"Pull again\" retries it." } },
    ],
  },
  {
    id: "2026-11-11-g",
    version: "0.32.0",
    date: "2026-11-11",
    summaryTitle: { uk: "Rukh: коментарі та історія з іншого трекера", en: "Rukh: comments and history from another tracker" },
    items: [
      { id: "import-comments", type: "added", scope: "tasks", title: { uk: "Коментарі переносяться зі своїми датами й авторами.", en: "Comments come over with their dates and authors." } },
      { id: "import-history", type: "added", scope: "tasks", title: { uk: "Історія статусів переноситься: час у колонці рахується з неї.", en: "Status history comes over: time in a column counts from it." } },
      { id: "import-private-owner", type: "improved", scope: "tasks", title: { uk: "Закриті задачі з трекера бачить власник проєкту.", en: "The project's owner sees restricted tasks from the tracker." } },
    ],
  },
  {
    id: "2026-11-11-f",
    version: "0.31.0",
    date: "2026-11-11",
    summaryTitle: { uk: "Rukh: люди й ролі з іншого трекера", en: "Rukh: people and roles from another tracker" },
    items: [
      { id: "import-seats", type: "added", scope: "tasks", title: { uk: "Людей з трекера можна прив'язати до учасників пізніше: їхні задачі переходять слідом.", en: "People from the tracker can be tied to members later: their tasks follow." } },
      { id: "import-roles", type: "added", scope: "tasks", title: { uk: "Ролі з трекера стають ролями в проєкті.", en: "The tracker's roles become roles in the project." } },
      { id: "import-private", type: "added", scope: "tasks", title: { uk: "Задачі з обмеженим доступом переносяться приватними.", en: "Restricted tasks come over private." } },
    ],
  },
  {
    id: "2026-11-11-e",
    version: "0.30.0",
    date: "2026-11-11",
    summaryTitle: { uk: "Rukh: кнопки статусу й правила колонок", en: "Rukh: status buttons and column rules" },
    items: [
      { id: "status-buttons", type: "added", scope: "tasks", title: { uk: "Статус задачі на комп'ютері — ряд кнопок; колонка має коротку назву й колір.", en: "A task's status on a computer is a row of buttons; a column has a short name and a colour." } },
      { id: "column-notify", type: "added", scope: "tasks", title: { uk: "Сповіщення колонки: задача прийшла, пішла або змінилася, поки стоїть там.", en: "A column's notifications: a task came, left or changed while standing there." } },
      { id: "column-moves", type: "added", scope: "tasks", title: { uk: "Для колонки можна задати, які підрозділи забирають з неї задачі і які кладуть у неї.", en: "A column can say which units take tasks out of it and which put tasks into it." } },
    ],
  },
  {
    id: "2026-11-11-d",
    version: "0.29.0",
    date: "2026-11-11",
    summaryTitle: { uk: "Rukh: дошка для великих проєктів", en: "Rukh: a board for large projects" },
    items: [
      { id: "board-lanes", type: "improved", scope: "tasks", title: { uk: "Групування за виконавцем: смуга на людину з аватаром і кількістю, смуги згортаються.", en: "Grouping by assignee: a lane per person with avatar and count; lanes fold." } },
      { id: "board-order", type: "added", scope: "tasks", title: { uk: "Порядок карток (нові, старі, змінені, термін, пріоритет, найдовше чекають) і фільтр за часом.", en: "Card order (newest, oldest, changed, due, priority, waiting longest) and a time filter." } },
      { id: "board-fold", type: "added", scope: "tasks", title: { uk: "Колонку можна згорнути; довга колонка показує 50 карток і «Показати ще».", en: "A column can be folded; a long column shows 50 cards and “Show more”." } },
      { id: "dark-selects", type: "fixed", scope: "global", title: { uk: "Темна тема: спадні списки читаються; опис задачі без сірої плашки.", en: "Dark theme: dropdown lists are readable; a task's description has no grey plate." } },
    ],
  },
  {
    id: "2026-11-11-c",
    version: "0.28.0",
    date: "2026-11-11",
    summaryTitle: { uk: "Rukh: переїзд з іншого трекера", en: "Rukh: moving in from another tracker" },
    summaryDescription: {
      uk: "Задачі переносяться зі своїми номерами, датами, людьми й описами; перед запуском — пробний перегляд.",
      en: "Tasks come over with their numbers, dates, people and descriptions; a dry run comes first.",
    },
    items: [
      { id: "import-wizard", type: "added", scope: "tasks", title: { uk: "Майстер переїзду для власника й адміністраторів: підключення, відповідності, пробний перегляд, перенесення, звіт.", en: "A move wizard for the owner and admins: connection, mapping, dry run, move, report." } },
      { id: "import-numbers", type: "added", scope: "tasks", title: { uk: "Номери задач, дати, епіки, підзадачі, зв'язки й форматування описів зберігаються; повторний запуск не створює дублікатів.", en: "Task numbers, dates, epics, subtasks, links and description formatting are kept; running again makes no duplicates." } },
      { id: "import-people", type: "added", scope: "tasks", title: { uk: "Люди зіставляються за поштою чи іменем; хто не є учасником — лишається іменем у задачі.", en: "People are matched by email or name; someone who isn't a member stays as a name on the task." } },
      { id: "project-key", type: "added", scope: "tasks", title: { uk: "Ключ проєкту можна змінити в «Доступ і налаштування»; задачі зберігають номери.", en: "A project's key can be changed in “Access and settings”; tasks keep their numbers." } },
    ],
  },
  {
    id: "2026-11-11-b",
    version: "0.27.0",
    date: "2026-11-11",
    summaryTitle: { uk: "Rukh: зручна картка задачі", en: "Rukh: a handier task card" },
    summaryDescription: {
      uk: "Опис — на першому екрані, властивості — збоку, а задача відкривається поверх дошки.",
      en: "The description comes first, the properties sit on the side, and a task opens over the board.",
    },
    items: [
      { id: "task-two-columns", type: "improved", scope: "tasks", title: { uk: "Картка задачі у дві колонки: ліворуч опис, підзадачі, зв'язки, файли й коментарі; праворуч властивості.", en: "The task card has two columns: description, subtasks, links, files and comments on the left; properties on the right." } },
      { id: "task-panel", type: "added", scope: "tasks", title: { uk: "Задача відкривається в панелі поверх дошки чи списку; посиланням можна поділитися, Esc закриває.", en: "A task opens in a panel over the board or the list; the link can be shared, Esc closes it." } },
      { id: "task-people", type: "improved", scope: "tasks", title: { uk: "Виконавець, співвиконавці й відповідальні — зі списку з пошуком.", en: "The assignee, co-assignees and responsible people are picked from a list with search." } },
      { id: "task-search", type: "improved", scope: "tasks", title: { uk: "Батьківська задача й зв'язки шукаються за назвою чи ключем.", en: "The parent task and links are found by title or key." } },
      { id: "task-labels", type: "improved", scope: "tasks", title: { uk: "Мітки — кольорові позначки з підказками наявних у проєкті.", en: "Labels are coloured marks, with the project's existing ones offered." } },
      { id: "task-history", type: "improved", scope: "tasks", title: { uk: "Історія без сміття: серія правок опису — один рядок; видно, що на що змінилося.", en: "A tidy history: a run of description edits is one line; it says what changed to what." } },
      { id: "board-tidy", type: "improved", scope: "tasks", title: { uk: "Дошка: «+» для нової колонки й стрілки до схованих колонок.", en: "The board: a “+” for a new column and arrows to hidden columns." } },
      { id: "tasks-tree", type: "added", scope: "tasks", title: { uk: "Ліва панель — дерево: проєкти, дошки й задачі на кожній дошці з кольором колонки та пріоритетом.", en: "The left panel is a tree: projects, boards and the tasks on each board with the column colour and priority." } },
      { id: "task-add-field-fix", type: "fixed", scope: "tasks", title: { uk: "Кнопка «Поле» в задачі більше не має подвійного плюса.", en: "The “Field” button in a task no longer shows a double plus." } },
    ],
  },
  {
    id: "2026-11-11-a",
    version: "0.26.0",
    date: "2026-11-11",
    summaryTitle: { uk: "Новий вигляд і навігація", en: "A new look and navigation" },
    summaryDescription: {
      uk: "Спокійніші поверхні з тонкими рамками, власні значки замість емодзі та ліва панель, у якій лишилося тільки потрібне.",
      en: "Calmer surfaces with thin hairlines, our own icons instead of emoji, and a left panel that keeps only what you need.",
    },
    items: [
      { id: "look-surfaces", type: "visual", scope: "global", title: { uk: "Нові кольори поверхонь, тонкі рамки й скролбари в обох темах.", en: "New surface colours, thin hairlines and scrollbars in both themes." } },
      { id: "look-icons", type: "visual", scope: "global", title: { uk: "Власні значки інтерфейсу й знак кожного сервісу з його градієнтом.", en: "Our own interface icons and a mark for every service in its gradient." } },
      { id: "nav-menu", type: "improved", scope: "global", title: { uk: "Профіль, налаштування, тема, мова, «Що нового», довідка й вихід — в одному меню під назвою workspace.", en: "Profile, settings, theme, language, “What's new”, help and sign-out — in one menu under the workspace name." } },
      { id: "nav-services", type: "improved", scope: "global", title: { uk: "Сервіси за чотирма категоріями: закріплені — в панелі, усі — у списку (Ctrl+E).", en: "Services in four categories: pinned ones in the panel, all of them in the list (Ctrl+E)." } },
      { id: "nav-collapse", type: "added", scope: "global", title: { uk: "Ліву панель можна згорнути (Ctrl+\\).", en: "The left panel can be collapsed (Ctrl+\\)." } },
      { id: "studio", type: "visual", scope: "global", title: { uk: "Таблиці, презентації, дошки й карти відкриваються на весь екран під однією компактною шапкою: «Експорт / Імпорт», «Доступ», основна дія й «Ще».", en: "Tables, decks, boards and maps open on the whole screen under one compact bar: “Export / Import”, “Access”, the main action and “More”." } },
      { id: "sheets-charts", type: "improved", scope: "sheets", title: { uk: "Sota: діаграми — у бічній панелі поруч із таблицею.", en: "Sota: charts sit in a side panel beside the table." } },
      { id: "slides-rail", type: "improved", scope: "slides", title: { uk: "Kadry: вузька стрічка слайдів, копія й видалення на мініатюрі, нотатки у висувній смузі.", en: "Kadry: a slim slide rail, copy and delete on the thumbnail, notes in a drawer." } },
      { id: "boards-dock", type: "improved", scope: "board", title: { uk: "Bordy: шаблони, голосування, таймер і задача зі стікера — в одній плаваючій панелі.", en: "Bordy: templates, voting, the timer and a task from a sticky note in one floating dock." } },
      { id: "wiki-bar", type: "improved", scope: "wiki", title: { uk: "Wika: дії сторінки зібрано в одну шапку; на сторінках із зовнішнього джерела назва більше не повторюється двічі.", en: "Wika: a page's actions sit in one bar; on pages fed from outside the name is no longer shown twice." } },
      { id: "forms-builder", type: "visual", scope: "forms", title: { uk: "Questa: вкладки зі значками, питання — окремі картки без зайвих рамок.", en: "Questa: tabs with icons, each question its own card without extra frames." } },
      { id: "profile-cards", type: "visual", scope: "profile", title: { uk: "Профіль: картка людини, показники плитками, перемикачі-картки й окрема зона для видалення акаунта.", en: "Profile: a person card, numbers as tiles, choice cards and a separate zone for deleting the account." } },
      { id: "kadry-panel", type: "visual", scope: "slides", title: { uk: "Kadry: панель оформлення і шарів схована за замовчуванням — слайд займає більше місця; відкривається кнопкою на панелі інструментів.", en: "Kadry: the design and layers panel is closed by default, so the slide gets more room; a toolbar button opens it." } },
      { id: "dialogs", type: "visual", scope: "global", title: { uk: "Усі діалоги — в єдиному вигляді; пояснення під заголовками екранів сховано в підказки «i».", en: "Every dialog shares one look; explanations under screen titles moved into “i” hints." } },
      { id: "tasks-card", type: "visual", scope: "tasks", title: { uk: "Rukh: компактна картка задачі — пріоритет і виконавець змінюються прямо на ній; один рядок заголовка й один рядок фільтрів.", en: "Rukh: a compact task card — priority and assignee change right on it; one header row and one filter row." } },
      { id: "tasks-new-project", type: "improved", scope: "tasks", title: { uk: "Rukh: новий проєкт створюється в діалозі з кнопки «Новий проєкт».", en: "Rukh: a new project is created in a dialog from the “New project” button." } },
      { id: "calendar-header", type: "improved", scope: "calendar", title: { uk: "Doba: у шапці один перемикач «Календар / Відсутності» й одна кнопка «Створити».", en: "Doba: the header has one “Calendar / Time off” switch and one “Create” button." } },
      { id: "nav-tasks", type: "improved", scope: "tasks", title: { uk: "У лівій панелі Rukh — проєкти й дошки; самі задачі лишаються на дошці.", en: "The left panel in Rukh lists projects and boards; the tasks themselves stay on the board." } },
    ],
  },
  {
    id: "2026-11-10-i",
    version: "0.25.0",
    date: "2026-11-10",
    summaryTitle: { uk: "Obriy: галерея додатків компанії", en: "Obriy: your company's app gallery" },
    summaryDescription: {
      uk: "Усі зовнішні додатки й сервіси компанії в одному місці — плитками, з логотипом, категорією й описом.",
      en: "All your company's outside apps and services in one place — as tiles with a logo, category and description.",
    },
    items: [
      { id: "apps-gallery", type: "added", scope: "apps", title: { uk: "Плитки додатків з фільтром за категоріями; додаток відкривається в новій вкладці.", en: "App tiles with a category filter; an app opens in a new tab." } },
      { id: "apps-fill", type: "added", scope: "apps", title: { uk: "Назва, опис і логотип підтягуються з посилання; усе можна змінити вручну або завантажити свій логотип.", en: "Name, description and logo are filled from the link; everything is editable, or upload your own logo." } },
      { id: "apps-access", type: "added", scope: "apps", title: { uk: "Додають і змінюють додатки власник та адміністратори; доступ — усій компанії, людям чи підрозділам.", en: "The owner and admins add and change apps; access goes to the whole company, people or units." } },
    ],
  },
  {
    id: "2026-11-10-h",
    version: "0.24.0",
    date: "2026-11-10",
    summaryTitle: { uk: "Doba: зайнятість з вашого календаря", en: "Doba: busy time from your calendar" },
    summaryDescription: {
      uk: "Підключіть власний календар за адресою-підпискою — колеги бачитимуть, коли ви зайняті, без жодних подробиць.",
      en: "Connect your own calendar by its subscription address — colleagues see when you are busy, with no details at all.",
    },
    items: [
      { id: "outside-busy", type: "added", scope: "calendar", title: { uk: "Зайнятість із зовнішнього календаря: лише час, без назв і учасників.", en: "Busy time from an outside calendar: times only, no titles or people." } },
      { id: "outside-refresh", type: "added", scope: "calendar", title: { uk: "Оновлюється сама у фоні; є «Оновити зараз» і «Відключити».", en: "Refreshes by itself in the background; “Refresh now” and “Disconnect” are there." } },
    ],
  },
  {
    id: "2026-11-10-g",
    version: "0.23.0",
    date: "2026-11-10",
    summaryTitle: { uk: "Doba у вашому календарі", en: "Doba in your own calendar" },
    summaryDescription: {
      uk: "Особиста адреса-підписка: події Doba й ваші відсутності видно у власному календарі на телефоні чи в пошті.",
      en: "A personal subscription address: Doba events and your time off show in your own calendar on the phone or in the mail.",
    },
    items: [
      { id: "feed", type: "added", scope: "calendar", title: { uk: "«У моєму календарі»: секретна адреса для підписки у будь-якому календарі.", en: "“In my calendar”: a secret address to subscribe from any calendar app." } },
      { id: "feed-renew", type: "added", scope: "calendar", title: { uk: "Адресу можна замінити новою або вимкнути будь-коли.", en: "The address can be replaced or turned off at any time." } },
    ],
  },
  {
    id: "2026-11-10-f",
    version: "0.22.0",
    date: "2026-11-10",
    summaryTitle: { uk: "Doba: створення розтягуванням", en: "Doba: drag to create" },
    summaryDescription: {
      uk: "Сітка календаря відповідає на курсор: підсвічування, розтягування, відсутність просто з календаря.",
      en: "The calendar grid answers the pointer: highlight, dragging, time off right from the calendar.",
    },
    items: [
      { id: "drag-create", type: "added", scope: "calendar", title: { uk: "Подія розтягуванням по клітинках: по годинах (крок 15 хвилин) і по днях.", en: "An event by dragging across cells: down the hours (steps of 15 minutes) and across the days." } },
      { id: "absence-grid", type: "added", scope: "calendar", title: { uk: "Режим «Відсутність»: заявка на обрані в сітці дні.", en: "The “Time off” mode: a request for the days picked on the grid." } },
      { id: "withdraw", type: "added", scope: "calendar", title: { uk: "Свою відсутність можна відкликати кліком у календарі.", en: "Your own absence can be withdrawn with a click in the calendar." } },
      { id: "hover", type: "visual", scope: "calendar", title: { uk: "Клітинка під курсором підсвічується.", en: "The cell under the pointer is highlighted." } },
    ],
  },
  {
    id: "2026-11-10-e",
    version: "0.21.0",
    date: "2026-11-10",
    summaryTitle: { uk: "Doba: свята й автоматичне нарахування", en: "Doba: holidays and accrual by itself" },
    summaryDescription: {
      uk: "Свята не списуються з відпустки, норма нараховується сама, новачки отримують її пропорційно.",
      en: "Holidays aren't taken from time off, the norm arrives by itself, newcomers get it in proportion.",
    },
    items: [
      { id: "holidays", type: "added", scope: "calendar", title: { uk: "Свята й неробочі дні: список на рік і «скопіювати з минулого року».", en: "Holidays and days off: a list per year and “copy from last year”." } },
      { id: "auto-accrual", type: "added", scope: "calendar", title: { uk: "Нарахування щороку або щомісяця — без кнопки й без подвоєння.", en: "Accrual every year or every month — without the button, and never twice." } },
      { id: "start-date", type: "added", scope: "calendar", title: { uk: "Дата початку роботи: норма першого року — пропорційно місяцям.", en: "Start date: the first year's norm is in proportion to the months." } },
    ],
  },
  {
    id: "2026-11-10-d",
    version: "0.20.0",
    date: "2026-11-10",
    summaryTitle: { uk: "Doba: задачі в календарі, підрозділи, пошук подій", en: "Doba: tasks on the calendar, units, event search" },
    summaryDescription: {
      uk: "Календар бачить решту платформи — з тими самими правами доступу.",
      en: "The calendar sees the rest of the platform — with the same access rules.",
    },
    items: [
      { id: "calendar-tasks", type: "added", scope: "calendar", title: { uk: "Терміни задач у календарі: мої або всі доступні; чужі приватні задачі не показуються.", en: "Task due dates on the calendar: mine or all I can see; other people's private tasks never show." } },
      { id: "invite-unit", type: "added", scope: "calendar", title: { uk: "Запрошення цілого підрозділу на подію з кнопкою «Оновити склад».", en: "Inviting a whole unit to an event, with “Refresh” for those who joined later." } },
      { id: "event-search", type: "added", scope: "global", title: { uk: "Події в пошуку та чіп події у вікі.", en: "Events in search, and an event chip in the wiki." } },
    ],
  },
  {
    id: "2026-11-10-c",
    version: "0.19.0",
    date: "2026-11-10",
    summaryTitle: { uk: "Doba: повторювані події й нагадування", en: "Doba: repeating events and reminders" },
    summaryDescription: {
      uk: "Серії подій із гнучкими змінами: один день, цей і наступні або всі.",
      en: "Series of events with flexible changes: one day, this and the following, or all.",
    },
    items: [
      { id: "repeats", type: "added", scope: "calendar", title: { uk: "Повтори: щодня, щотижня у вибрані дні, щомісяця, щороку — до дати або певну кількість разів.", en: "Repeats: daily, weekly on chosen days, monthly, yearly — until a date or a number of times." } },
      { id: "series-scope", type: "added", scope: "calendar", title: { uk: "Зміна й скасування: лише ця подія, ця й наступні або вся серія.", en: "Changing and cancelling: only this event, this and the following, or the whole series." } },
      { id: "reminders", type: "added", scope: "calendar", title: { uk: "Нагадування учасникам за 10 хвилин, годину або день до початку.", en: "Reminders for the people 10 minutes, an hour or a day before the start." } },
    ],
  },
  {
    id: "2026-11-10-b",
    version: "0.18.0",
    date: "2026-11-10",
    summaryTitle: { uk: "Doba: відпустки й відсутності", en: "Doba: time off" },
    summaryDescription: {
      uk: "Правила, баланси, заявки із заступником і погодження керівником підрозділу.",
      en: "Policies, balances, requests with a deputy and approval by the unit's lead.",
    },
    items: [
      { id: "leave-requests", type: "added", scope: "calendar", title: { uk: "Заявки на відпустку, лікарняний, відгул і віддалену роботу — на день, кілька днів або пів дня.", en: "Requests for vacation, sick leave, a day off and remote work — a day, several days or half a day." } },
      { id: "leave-approval", type: "added", scope: "calendar", title: { uk: "Погодження керівником підрозділу; власну заявку не погоджує ніхто.", en: "Approval by the unit's lead; nobody approves their own request." } },
      { id: "leave-balances", type: "added", scope: "calendar", title: { uk: "Баланси з річним нарахуванням, перенесенням залишку й ручними правками.", en: "Balances with a yearly accrual, carry-over and manual corrections." } },
      { id: "leave-calendar", type: "added", scope: "calendar", title: { uk: "Відсутності колег видно в календарі — без зайвих подробиць.", en: "Colleagues' absences show on the calendar — without extra details." } },
      { id: "leave-role", type: "added", scope: "security", title: { uk: "Право ролі «Керувати відпустками» для HR.", en: "The role right “Manage time off” for HR." } },
    ],
  },
  {
    id: "2026-11-10",
    version: "0.17.0",
    date: "2026-11-10",
    summaryTitle: { uk: "Doba: календар команди", en: "Doba: the team calendar" },
    summaryDescription: {
      uk: "Події чотирьох видів, запити на участь і зайнятість колег без зайвих деталей.",
      en: "Four kinds of events, requests to join and colleagues' busy time without extra details.",
    },
    items: [
      { id: "events", type: "added", scope: "calendar", title: { uk: "Події: відкриті, із запитом на участь, лише за запрошенням і приватні.", en: "Events: open, by request, invite-only and private." } },
      { id: "busy", type: "added", scope: "calendar", title: { uk: "Доступність колег: закриті події видно лише як «Зайнято», без назви й учасників.", en: "Colleagues' availability: hidden events show only as “Busy”, without the title or the people." } },
      { id: "views", type: "added", scope: "calendar", title: { uk: "Місяць, тиждень і список; на телефоні тиждень показує один день.", en: "Month, week and list; on a phone the week shows one day." } },
      { id: "event-notifications", type: "added", scope: "global", title: { uk: "Сповіщення про запрошення, запити на участь, зміну часу й скасування подій.", en: "Notifications about invitations, requests to join, time changes and cancelled events." } },
    ],
  },
  {
    id: "2026-11-07",
    version: "0.16.0",
    date: "2026-11-07",
    summaryTitle: { uk: "Галереї у вікі", en: "Galleries in the wiki" },
    summaryDescription: { uk: "Зображення, відео YouTube та аудіо в одному блоці з чотирма виглядами.", en: "Images, YouTube videos and audio in one block with four layouts." },
    items: [
      { id: "gallery", type: "added", scope: "wiki", title: { uk: "Блок «Галерея»: головний перегляд, слайди, список і сітка.", en: "The Gallery block: featured, slides, list and grid." } },
      { id: "audio", type: "added", scope: "storage", title: { uk: "Аудіо (mp3, m4a, ogg, wav) зберігається з файлами сторінки.", en: "Audio (mp3, m4a, ogg, wav) is stored with the page's files." } },
      { id: "changelog", type: "added", scope: "global", title: { uk: "Сторінка «Що нового» з фільтрами й посиланнями на кожен реліз.", en: "The «What's new» page with filters and a link to each release." } },
    ],
  },
  {
    id: "2026-11-06-b",
    version: "0.15.0",
    date: "2026-11-06",
    summaryTitle: { uk: "Шаблони задач і формули як в Excel", en: "Task templates and Excel-like formulas" },
    summaryDescription: { uk: "Нова задача — з шаблону проєкту чи власного; таблиці рахують масиви, LET і FILTER.", en: "A new task starts from a project or personal template; tables handle arrays, LET and FILTER." },
    items: [
      { id: "templates", type: "added", scope: "tasks", title: { uk: "Шаблони задач: спільні для проєкту й особисті, на окремих вкладках.", en: "Task templates: shared per project and personal, on separate tabs." } },
      { id: "formulas", type: "improved", scope: "sheets", title: { uk: "Масиви {1,2;3,4}, ROW/COLUMN, LET, FILTER, SORT, UNIQUE усередині формул.", en: "Arrays {1,2;3,4}, ROW/COLUMN, LET, FILTER, SORT, UNIQUE inside formulas." } },
      { id: "snapshot", type: "added", scope: "tasks", title: { uk: "Заморожена задача відкривається як знімок лише для читання.", en: "A frozen task opens as a read-only snapshot." } },
    ],
  },
  {
    id: "2026-11-06-a",
    version: "0.14.0",
    date: "2026-11-06",
    summaryTitle: { uk: "Апус і аналітика", en: "Apus and analytics" },
    summaryDescription: { uk: "П'ятнадцятиногий восьминіг став помічником, а команда бачить свою активність.", en: "The fifteen-legged octopus became your helper, and teams see their activity." },
    items: [
      { id: "apus", type: "visual", scope: "global", title: { uk: "Апус замість рибки: сповіщення, відгуки й гра в одному меню.", en: "Apus replaces the fish: notifications, feedback and the game in one menu." } },
      { id: "analytics", type: "added", scope: "profile", title: { uk: "Аналітика: свої показники для кожного, командні — для власника й адміністраторів.", en: "Analytics: own numbers for everyone, team numbers for owners and admins." } },
    ],
  },
  {
    id: "2026-11-06-0",
    version: "0.13.0",
    date: "2026-11-06",
    summaryTitle: { uk: "Дошки команд і приватні задачі", en: "Team boards and private tasks" },
    items: [
      { id: "boards", type: "added", scope: "tasks", title: { uk: "Одна задача на кількох дошках команд, правила між дошками й заморожування колонок.", en: "One task on several team boards, rules between boards and frozen columns." } },
      { id: "private", type: "added", scope: "security", title: { uk: "Приватні задачі: бачать лише автор, виконавці й відповідальні.", en: "Private tasks: only the author, assignees and responsible people see them." } },
      { id: "brands", type: "visual", scope: "global", title: { uk: "Кожен сервіс має власну назву й градієнт.", en: "Every service has its own name and gradient." } },
    ],
  },
  {
    id: "2026-11-05",
    version: "0.12.0",
    date: "2026-11-05",
    summaryTitle: { uk: "Сповіщення та правила задач", en: "Notifications and task rules" },
    items: [
      { id: "bell", type: "added", scope: "global", title: { uk: "Центр сповіщень, сповіщення браузера й тихі години.", en: "A notification centre, browser notifications and quiet hours." } },
      { id: "rules", type: "added", scope: "tasks", title: { uk: "Правила проєкту: кому повідомити, коли задача змінюється, і колонка «Перевіряють».", en: "Project rules: who to tell when a task changes, and a «Review» column." } },
      { id: "newpage", type: "improved", scope: "wiki", title: { uk: "Нова сторінка вікі відкривається одразу.", en: "A new wiki page opens at once." } },
      { id: "mydata", type: "added", scope: "security", title: { uk: "«Мої дані»: власні відповіді в опитуваннях; панель платформи не бачить вмісту.", en: "«My data» includes own survey answers; the platform panel never sees content." } },
      { id: "dragfix", type: "fixed", scope: "tasks", title: { uk: "Перетягування між колонками дошки задач.", en: "Dragging between task board columns." } },
    ],
  },
  {
    id: "2026-11-03",
    version: "0.11.0",
    date: "2026-11-03",
    summaryTitle: { uk: "Таблиці, опитування й нова презентація", en: "Tables, surveys and a new presentation" },
    media: { src: "/landing/hero-1600.webp", kind: "image", alt: { uk: "Головний екран презентації", en: "The presentation's first screen" } },
    items: [
      { id: "sheets", type: "added", scope: "sheets", title: { uk: "Таблиці: формули Excel, файли Excel і CSV, діаграми, вставка у вікі.", en: "Tables: Excel formulas, Excel and CSV files, charts, embedding in the wiki." } },
      { id: "surveys", type: "added", scope: "forms", title: { uk: "Опитування з посиланням для будь-кого й завантаженням файлів.", en: "Surveys with a link for anyone and file uploads." } },
      { id: "landing", type: "visual", scope: "global", title: { uk: "Нова сторінка «Про нас» у стилі презентації.", en: "A new presentation-style «About» page." } },
    ],
  },
  {
    id: "2026-11-02",
    version: "0.10.0",
    date: "2026-11-02",
    summaryTitle: { uk: "Дошки, нодовий простір і гості", en: "Boards, the node space and guests" },
    items: [
      { id: "boards", type: "added", scope: "board", title: { uk: "Дошки: полотно з наліпками, зображеннями й командними інструментами.", en: "Boards: a canvas with sticky notes, images and team tools." } },
      { id: "nodes", type: "added", scope: "nodes", title: { uk: "Нодовий простір: карти зв'язків і думок.", en: "The node space: maps of links and ideas." } },
      { id: "guests", type: "added", scope: "profile", title: { uk: "Роль «Гість» із запрошенням до дати й доступом лише до спільного.", en: "The «Guest» role: invited until a date, sees only what is shared." } },
      { id: "storage", type: "improved", scope: "storage", title: { uk: "Одне сховище на робочий простір для всіх файлів.", en: "One storage per workspace for every file." } },
      { id: "token", type: "fixed", scope: "security", title: { uk: "Перепустка до власної бази команди прив'язана до робочого простору.", en: "The pass to a team's own database is tied to its workspace." } },
    ],
  },
];

export const releaseAnchor = (id: string) => `release-${id}`;
