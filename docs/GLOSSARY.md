# Glossary

| Term | Meaning | In code |
|---|---|---|
| Workspace | a team's space; URL by permanent short ID | `workspaces`, `/w/<short_id>` |
| Власник / Адмін / Учасник / Гість | workspace roles; guest sees only what's shared, until a date | `workspace_members.role`, `access_until` |
| Адміністратор платформи | service owner; sees statistics only | `profiles.is_platform_admin`, `/admin` |
| Домен компанії | email domain that lets people join; proven via DNS | `workspace_domains` |
| Шлях В / база команди | team-owned Supabase holding its data | `supabase/team/**`, `src/lib/team-db/**` |
| Спершу — власна база | new workspaces need their own DB before pages | `platform_settings.require_team_database`, `central_allowed` |
| Сервіс | a section: Вікі, Задачі, Дошки, Нодовий простір, Таблиці, Опитування (+ Презентації, Чат, Файли later) | `src/lib/services.ts` |
| Об'єкт сервісу | a board, map, table or survey | `service_objects` (`service`, `kind`) |
| Вставка (embed) | a service object shown live on a wiki page | `src/components/editor/*-block.tsx` |
| Чип | inline mention of a page, person or task | editor inline content |
| Посилання для будь-кого | public survey link, server-only access | `survey_settings.public_token`, `/f/<ws>/<token>` |
| Підключена таблиця | sheet receiving survey answers as rows | `survey_settings.sheet_id` |
| Скоро | landing mark for planned, not built features | `t.landing.soon` |
| Крок (Д1, Т4, О3…) | numbered stage of a service plan | `docs/decisions.md` |
