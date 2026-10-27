# Налаштування сервісів (Етап 1)

Ключі й паролі вводяться лише в панелях Google, Supabase, Vercel та в GitHub Secrets. Не вставляйте їх у код, чат чи документи.

## 1. Google Cloud Console

1. Відкрийте проєкт **EdgeKnow** під корпоративним акаунтом @iyo.gg.
2. **Google Auth Platform → Audience**:
   - тип **External**;
   - у блоці *Publishing status* натисніть **Publish app** → **Confirm**, статус має стати **In production**.

   У режимі *Testing* увійти можуть лише люди зі списку *Test users*, а вхід злітає кожні 7 днів.
3. **Data Access**: лише `openid`, `email`, `profile`.
4. **Branding → Authorized domains**: `xcnfeyajqrrfvtrmmteu.supabase.co`, а коли буде свій піддомен, ще й його.

   Просто `supabase.co` Google не приймає, бо це спільний домен багатьох проєктів. Якщо й повна адреса не додається, залиште поле порожнім: для стандартних даних (пошта, ім'я, фото) це вхід не блокує.
5. **Clients → (ваш клієнт)**:
   - *Authorized JavaScript origins*: `http://localhost:3000` і адреса з Vercel (`https://….vercel.app`);
   - *Authorized redirect URIs*: `https://xcnfeyajqrrfvtrmmteu.supabase.co/auth/v1/callback`.

## 2. Supabase

1. **Authentication → Sign In / Providers → Google**:
   - увімкніть провайдер;
   - вставте *Client ID* і *Client Secret*;
   - натисніть **Save**.
2. **Email**, **Anonymous sign-ins** — вимкнено.
3. **Authentication → URL Configuration**:
   - *Site URL*: адреса Vercel, наприклад `https://edgeknow.vercel.app`;
   - *Redirect URLs*: `http://localhost:3000/auth/callback` і `https://<адреса Vercel>/auth/callback`.
4. **Після першого успішного запуску GitHub Action «Database»:**
   - **Authentication → Hooks → Before User Created** → *Add hook*;
   - тип **Postgres**, схема `public`, функція `hook_before_user_created`;
   - **Create**.

   Цей хук не дає створити акаунт людині з домену поза списком.

## 3. GitHub Secrets

**Settings → Secrets and variables → Actions → Repository secrets:**

| Name | Звідки взяти |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | supabase.com → аватар → **Account preferences → Access Tokens → Generate new token**. Значення починається з `sbp_`. Це **не** токен GitHub. |
| `SUPABASE_DB_PASSWORD` | Пароль бази, заданий при створенні проєкту. Якщо загубили, скиньте його: **Project Settings → Database → Reset database password**. |
| `SUPABASE_PROJECT_REF` | `xcnfeyajqrrfvtrmmteu` |

## 4. Vercel

1. **Add New → Project** → імпорт репозиторію `ikunstler-maker/EdgeKnow`.
2. **Environment Variables** (для Production і Preview):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://xcnfeyajqrrfvtrmmteu.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = ключ `sb_publishable_…` з Supabase (**Project Settings → API Keys**)

   Ці два значення не секретні, вони все одно потрапляють у браузер. Дані захищає база через правила RLS. Секретний ключ Supabase (`sb_secret_…`) на цьому етапі не потрібен узагалі.
3. **Deploy**. Отриману адресу внесіть у Google (крок 1.5) і Supabase (крок 2.3).

## 5. Призначити адмінів

Обидва адміни мають хоча б раз увійти у вікі. Потім виконайте в **Supabase → SQL Editor**:

```sql
update public.profiles
set is_admin = true
where email in ('elaidzha_motion.designer@iyo.gg', 'daniil_head.of.design@iyo.gg');
```

Це зміна даних, а не схеми, тому міграція тут не потрібна. Далі доменами керують з інтерфейсу: **Головна → Налаштування доступу до сервісу**.

## 6. Перевірка етапу 1 («Готово, коли»)

1. Акаунт @iyo.gg входить і бачить «Вітаємо, …».
2. Акаунт Gmail отримує сторінку «Немає доступу». У **Supabase → Authentication → Users** нового користувача не з'являється.
3. Адмін додає домен у налаштуваннях. Людина з цього домену входить одразу, без нового деплою.
4. Звичайний користувач, який відкриє `/settings/access`, бачить «доступна лише адміністраторам».
5. Після вимкнення домену його користувач на наступному кліку потрапляє на «Немає доступу».
