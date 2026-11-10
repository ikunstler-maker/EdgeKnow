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
