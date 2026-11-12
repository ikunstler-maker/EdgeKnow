# PR codes (parallel work without conflicts)

GitHub assigns PR numbers itself; we never reserve them. Every step instead gets a **code**: `CODE-n`
(e.g. `TOKER-3`, `DOBA-7`). Numbering is separate per code, so parallel sessions never collide.

## Codes

| Code | Scope |
|---|---|
| `WIKA` | Wika (wiki) |
| `RUKH` | Rukh (tasks) |
| `DOBA` | Doba (calendar) |
| `SOTA` | Sota (tables) |
| `KADRY` | Kadry (slides) |
| `BORDY` | Bordy (boards) |
| `NODO` | Nodo (maps) |
| `QUESTA` | Questa (surveys) |
| `OBRIY` | Obriy (apps) |
| `SHOWY` | Showy |
| `SPILNO` | Spilno |
| `TOKER` | Toker (chat) |
| `VAULT` | Vault |
| `VISIO` | Visio |
| `APUS` | Apus (AI) |
| `CORE` | Platform: sign-in, access/RLS, proxy, navigation |
| `UI` | Design system, shared components |
| `PROF` | Profile, WishList |
| `DB` | Shared database changes touching several services |
| `DOCS` | Documentation only |
| `CI` | Build, checks, scripts |

A new service or category → add a row here in the same PR.

## Where the code goes
- Branch: `<code-lower>-<n>-<short-slug>` (e.g. `toker-3-threads`), unless the session prescribes a branch name.
- PR title: `[TOKER-3] Short title`.
- `backlog.md` and `decisions.md` entries: start the topic with the code.
- Next number = highest existing number for that code + 1 (check `backlog.md`, `decisions.md`, open PRs).

## Rules against conflicts
- Migration file name includes the code: `<timestamp>_<code-lower>_<slug>.sql`.
- `backlog.md`, `decisions.md`: only append new lines at the end of the code's section/table; never reorder or rewrite others' lines.
- `src/i18n/*`: each service adds strings only inside its own block.
- Shared files (`CLAUDE.md`, platform components) → use `CORE`/`UI`, one such PR at a time.
