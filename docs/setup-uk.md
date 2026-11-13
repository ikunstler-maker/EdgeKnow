# Налаштування сервісів (Етап 1) — як зроблено

Довідка на випадок, якщо доведеться повторити налаштування (новий проєкт, заміна ключа). Ключі й паролі вводяться лише в панелях сервісів і GitHub Secrets — ніколи в код, чат чи документи.

Поточні значення: проєкт Supabase `xcnfeyajqrrfvtrmmteu`, сайт `https://edge-know.vercel.app`.

## Google Cloud (під акаунтом @iyo.gg — він власник проєкту EdgeKnow)

1. **Google Auth Platform → Audience**: тип External, статус In production, тестові користувачі не потрібні після публікації.
2. **Data Access**: лише `openid`, `email`, `profile`.
3. **Branding**: пошта підтримки й контактна — корпоративні; Application home page `https://edge-know.vercel.app`; Privacy policy `https://edge-know.vercel.app/privacy`; Authorized domains `xcnfeyajqrrfvtrmmteu.supabase.co` і `edge-know.vercel.app`.
4. **Clients → клієнт**: JavaScript origins `http://localhost:3000`, `https://edge-know.vercel.app`; Redirect URI `https://xcnfeyajqrrfvtrmmteu.supabase.co/auth/v1/callback`. Новий секрет: **+ Add secret**, старий — Disable → Delete.

### Doba: календар через вхід і Google Meet (DOBA-1)

Без цього кнопки «Підключити Google Календар» і «Додати Google Meet» не з'являються; адреса-підписка (3б) працює й так.

1. **APIs & Services → Library**: увімкнути **Google Calendar API** і **Google Meet REST API**.
2. **Google Auth Platform → Data Access → Add or remove scopes**: додати три дозволи (крім наявних):
   - `https://www.googleapis.com/auth/calendar.events.owned.readonly` — читати події власних календарів (беремо лише основний: назва, час, «зайнятий/вільний»);
   - `https://www.googleapis.com/auth/calendar.app.created` — власний календар застосунку «Doba» та його події, нічого іншого;
   - `https://www.googleapis.com/auth/meetings.space.created` — кімнати відеозустрічей, які створює застосунок.
3. **Clients → клієнт → Authorized redirect URIs**: додати `https://edge-know.vercel.app/api/calendar-google/callback` (для тестової версії — ще й її адресу з тим самим шляхом).
4. **Verification Center**: подати застосунок на перевірку. Для кожного дозволу — пояснення, навіщо він (тексти вище), і відео: вхід у workspace → Doba → «У моєму календарі» → «Підключити Google Календар» → екран згоди → ваші події з назвами в тижні Doba → створена подія з'являється в календарі «Doba» → «Додати Google Meet» у вікні події → «Відключити». До схвалення люди бачать попередження «застосунок не перевірено».
5. **Vercel**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DRIVE_TOKEN_KEY` (уже є для Drive) і `CALENDAR_TOKEN_KEY` (уже є для 3б) — нових змінних не потрібно.

## Supabase

1. **Authentication → Sign In / Providers**: Google увімкнено (Client ID + Client Secret); Email і Anonymous — вимкнено.
2. **Authentication → URL Configuration**: Site URL `https://edge-know.vercel.app`; Redirect URLs `http://localhost:3000/auth/callback`, `https://edge-know.vercel.app/auth/callback`.
3. **Authentication → Hooks**: Before User Created → Postgres → `public.hook_before_user_created`.
4. **Access token для GitHub** (https://supabase.com/dashboard/account/tokens → Generate new token):
   - строк — менше року (рівно рік форма не приймає);
   - Resource access: Project → цей проєкт;
   - права: Database → **Migrations** і **Database** — Read-write, усе інше в Database — Read; Project, Application services, Infrastructure — Read; Account and organization — No access;
   - токен починається з `sbp_`.

## GitHub → Settings → Secrets and variables → Actions

`SUPABASE_ACCESS_TOKEN` (`sbp_…`), `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` = `xcnfeyajqrrfvtrmmteu`.

Якщо Action «Database» червоний — помилка видна в блоці **Annotations** на сторінці запуску.

## Vercel

Змінні середовища (Production і Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Деплой відбувається сам при кожному пуші в `main`.

## Workspace і ролі

- Учасників, адмінів, домени й запрошення workspace налаштовують у самому сервісі: **сайдбар → ⚙️ Налаштування workspace**. SQL для цього не потрібен.
- Посилання для входу в конкретний workspace (з підказкою домену для Google) — у вкладці «Загальні».
- Супер-адмін платформи (статистика всіх workspace, перемикач «Відкрита реєстрація») — **сайдбар → 🛰️ Панель платформи**. Призначити ще одного супер-адміна можна лише в SQL Editor:

```sql
update public.profiles set is_platform_admin = true where email = 'name@example.com';
```
