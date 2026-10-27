# Налаштування сервісів (Етап 1) — як зроблено

Довідка на випадок, якщо доведеться повторити налаштування (новий проєкт, заміна ключа). Ключі й паролі вводяться лише в панелях сервісів і GitHub Secrets — ніколи в код, чат чи документи.

Поточні значення: проєкт Supabase `xcnfeyajqrrfvtrmmteu`, сайт `https://edge-know.vercel.app`.

## Google Cloud (під акаунтом @iyo.gg — він власник проєкту EdgeKnow)

1. **Google Auth Platform → Audience**: тип External, статус In production, тестові користувачі не потрібні після публікації.
2. **Data Access**: лише `openid`, `email`, `profile`.
3. **Branding**: пошта підтримки й контактна — корпоративні; Application home page `https://edge-know.vercel.app`; Privacy policy `https://edge-know.vercel.app/privacy`; Authorized domains `xcnfeyajqrrfvtrmmteu.supabase.co` і `edge-know.vercel.app`.
4. **Clients → клієнт**: JavaScript origins `http://localhost:3000`, `https://edge-know.vercel.app`; Redirect URI `https://xcnfeyajqrrfvtrmmteu.supabase.co/auth/v1/callback`. Новий секрет: **+ Add secret**, старий — Disable → Delete.

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

## Адміни

Нового адміна призначає SQL Editor (людина має хоча б раз увійти):

```sql
update public.profiles set is_admin = true where email = 'name@iyo.gg';
```
