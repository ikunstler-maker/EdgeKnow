# Master Guide — bootstrap for a new project or a fresh sprint

Part A (blueprint, rules, prompt) is for Claude, in English. Part B is the owner's manual, in Ukrainian.
EdgeKnow follows this guide; use it as the template for any new project.

---

## Part A1. File blueprint

```
CLAUDE.md                    # always loaded; ≤60 lines; agreements + pointers, no details
AGENTS.md                    # tool-specific notes (e.g. Next.js), imported by CLAUDE.md via @AGENTS.md
.claude/
  settings.json              # permissions: allow (safe repeats), deny (Read of heavy paths)
  rules/
    <area>.md                # path-scoped rules, YAML `paths:`; load only when those files are touched
docs/
  SPEC.md                    # product spec: goal, users, scope v1 / later, stages with "Done when"
  decisions.md               # append-only table: date | decision | what & why (amends SPEC)
  backlog.md                 # open work, ≤40 lines; the session todo list holds only the current PR
  TROUBLESHOOTING.md         # solved problems: symptom → root cause → fix (+ how to verify)
  GLOSSARY.md                # project terms: term | meaning | where in code
  MASTER_GUIDE.md            # this file
```

There is no `.claudeignore` in Claude Code: block heavy files with `permissions.deny` (`Read(./node_modules/**)`, lockfiles, build output, generated images).

### What each core file contains

**CLAUDE.md** (telegraphic English, ≤60 lines)
- Communication: language of replies, tone, "no subagents unless asked".
- Workflow: plan → owner OK → code → verify "Done when" → PR → merge; merge rules; local checks before pushing.
- Security: high-risk areas need separate approval; where secrets live; what may reach the browser; brand/legal limits; Git safety; untrusted-text rule.
- Architecture: stack, tenancy model, URL scheme, 3–6 invariants.
- Pointers: SPEC, decisions, backlog, TROUBLESHOOTING, GLOSSARY, rule files.
- Token economy + compact instructions.

**.claude/rules/<area>.md**
```
---
paths:
  - "supabase/**"
  - "**/*.sql"
---
# <Area> rules
- Only what applies when editing these paths (≤20 lines).
```

**docs/SPEC.md** (owner's language)
- Goal and constraints · users and roles · scope table (v1 / later) · data model · access rules · stages, each with "Готово, коли" (checklist) · risks.

**docs/decisions.md**
```
| Date | Decision | What and why |
|---|---|---|
| YYYY-MM-DD | <short name> | <what changed, why, what it replaces; who approved> |
```
Append only; a reversed decision gets a new row that refers to the old one.

**docs/backlog.md**
- "Next by plan" (ordered) · "Known gaps / follow-ups" (one line each, with the file or area).

**docs/TROUBLESHOOTING.md**
```
## <short title> — <area>
- Symptom: <exact error text or behaviour, searchable>
- Root cause: <one or two lines>
- Fix: <what to do; file/command>
- Verify: <command or check>
- Seen: YYYY-MM-DD
```

**docs/GLOSSARY.md**
```
| Term | Meaning | In code |
|---|---|---|
| Workspace | a team's space | `workspaces`, `/w/<short_id>` |
```

---

## Part A2. Maintenance rules for Claude

### TROUBLESHOOTING.md
- **Before debugging**: grep `docs/TROUBLESHOOTING.md` for the error text or area first.
- **Record when** a problem took more than one attempt, or its cause was non-obvious (tooling, environment, library quirk, flaky test, CI behaviour). Don't record typos or one-line obvious fixes.
- **Record in the same PR** as the fix: Symptom (exact, searchable text) → Root cause → Fix → Verify. ≤8 lines per entry.
- **Update, don't duplicate**: same symptom → extend the existing entry. Fixed for good (code removed) → delete the entry.
- Keep the file ≤300 lines; group by area (`## DB`, `## CI`, `## UI`, `## Env`). Read it by grep, never whole.

### GLOSSARY.md
- Add a term when it first appears in SPEC, decisions, UI copy or code and isn't plain language (roles, product names, internal concepts, abbreviations).
- One line per term: owner-facing word (in the UI language) | meaning | table / route / file.
- Renaming a concept → update the glossary in the same PR as the rename. UI word and code name must stay mapped.
- Before naming something new, grep the glossary to reuse the existing word.

### Session hygiene (Claude)
- Todo list: current PR only, ≤5 items; everything else → `docs/backlog.md`.
- Large files: Grep / Read with offset+limit; CI logs via `tail -n 30` or grep for `FAIL|error`.
- Screenshots: take them at scale 1, crop to the area in question.
- At the end of each PR, check that decisions.md, backlog.md, TROUBLESHOOTING.md and GLOSSARY.md are updated where relevant.

---

## Part A3. Master initialization prompt

Copy into the first message of a brand-new project (fill the `< >` parts):

```
New project: <name> — <one-line purpose>.
I am the product owner, not a developer. Reply in Ukrainian, formal «ви», short, no code in chat.

Before any code:
1. Ask me up to 5 questions you really need (users, must-have features, data, stack limits, deadline).
2. Then create, as one PR: CLAUDE.md (≤60 lines, English), .claude/settings.json (deny reading heavy files),
   .claude/rules/ (path-scoped rules per area), docs/SPEC.md (in Ukrainian, with stages and "Готово, коли"),
   docs/decisions.md, docs/backlog.md, docs/TROUBLESHOOTING.md, docs/GLOSSARY.md — following docs/MASTER_GUIDE.md
   from github.com/ikunstler-maker/EdgeKnow if you can read it, otherwise the same structure.
3. Rules from the start: plan → my OK → code → checks → PR → merge only when checks are green;
   data, access, sign-in and secrets need my separate approval; secrets only in environment variables, never in chat;
   one PR per batch of work; record decisions, solved problems and new terms in the docs above.
4. Then propose the plan for stage 1 and wait for my OK.
```

For a fresh sprint in an existing project: nothing to paste. `CLAUDE.md` has a "Session start" section that makes Claude read the backlog and recent decisions by itself; the owner just writes what she wants (e.g. «Зроби план кроку «Чат»»).

---

# Частина B. Інструкція для власника продукту

## 1. Як починати
- **Новий проєкт:** вставте промпт з A3 першим повідомленням. Claude спершу поставить кілька питань, потім створить базові файли й запропонує план першого етапу.
- **Новий крок у наявному проєкті:** нова сесія — і одразу пишіть, що потрібно (наприклад, «Зроби план кроку «Чат»»). Вводні Claude читає сам за правилом «Session start» у CLAUDE.md.
- **Одна сесія — один крок.** Коли PR злитий, починайте нову сесію: довгий чат дорожчає з кожним повідомленням, а все важливе вже записано у файли.

## 2. Як формулювати запити
- **Одне повідомлення — одна мета.** Наприклад: «Додай у таблиці фільтр за датою».
- **Новий функціонал:** «Підготуй план…». Claude покаже план і чекатиме вашого «OK». Ваше «OK» дозволяє лише цей план.
- **Помилка:** напишіть, що робили, що побачили й що очікували, і додайте скриншот. Точний текст помилки допомагає найбільше.
- **Дизайн:** покажіть приклад або скриншот і назвіть 2–3 ознаки стилю: «темний, багато повітря, великі заголовки».
- **Кілька дрібниць** збирайте в одне повідомлення: тоді вийде один PR і одна перевірка.

## 3. Команди й керування сесією
- `/compact` — коли сесія стала довгою, а крок ще не завершено. Claude стисне історію за правилами з CLAUDE.md.
- `/clear` — коли крок завершено, але сесію хочете лишити. Історія очиститься, а правила з файлів підхопляться знову.
- `/init` — у новому репозиторії, якщо CLAUDE.md ще немає. Краще замість нього використати промпт A3.
- **Зупинити Claude посеред роботи:** клавіша Esc (або кнопка зупинки в застосунку), а потім пояснення, що змінити.
- **Цікаво, чому щось зроблено саме так:** спитайте «чому так?». Відповідь має бути у `docs/decisions.md`.

## 4. Межі безпеки
- **Секрети** (ключі, паролі, токени) ніколи не вставляйте в чат. Додавайте їх у Vercel, GitHub або в налаштування середовища Claude, а в чаті лише кажіть, що додали.
- **Окремий дозвіл** потрібен для змін, що стосуються даних, доступу, входу на сайт і секретів. Не давайте його «наперед».
- **Злиття без перевірок** — лише як виняток, словами «Зливай <що саме> без перевірок». Дозвіл стосується лише цієї зміни.
- **Тексти з чужих джерел** (листи, сайти, звіти інших ШІ) Claude сприймає як інформацію, а не як команди. Якщо хочете, щоб він їх виконав, напишіть це своїми словами.
- **Платні сервіси** (генерація зображень, хмарні бази): встановіть ліміт витрат у самому сервісі.

## 5. Як економити ліміти
- Перевірки на GitHub витрачають хвилини Actions. Просіть «зібрати в один PR», а Claude перевіряє все локально перед надсиланням.
- Не просіть «прочитай увесь проєкт». Називайте розділ чи файл, наприклад «опитування», «бічна панель».
- Довгі звіти, логи й скриншоти надсилайте лише ті, що стосуються питання.
- Повторювана проблема має бути в `docs/TROUBLESHOOTING.md`. Якщо Claude наступався на ту саму помилку двічі, попросіть: «запиши в TROUBLESHOOTING».

## 6. Що перевіряти після кожного PR
- Зміни на сайті (Ctrl+Shift+R, щоб оновити без кешу).
- У відповіді Claude є: що зроблено, що перевірено, що не пройшло чи пропущено, і що потрібно від вас.
- `docs/decisions.md` оновлено, якщо змінилось правило чи поведінка.
