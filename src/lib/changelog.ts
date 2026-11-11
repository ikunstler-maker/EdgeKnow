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
