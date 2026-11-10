# Project context pack

Self-contained descriptions of the project for AI chats, other tools and people.
Every file exists in two languages with the same content: `*-uk.md` (for the owner and people) and `*-en.md` (for AI tools — cheaper in tokens).

## Files

| File | What it is | Who needs it |
|---|---|---|
| `00-overview-<lang>.md` | Product, architecture, principles, workflow, map of all services | every chat |
| `platform-<lang>.md` | Shared core: people, access, storage, navigation, search, notifications | every chat that designs or builds anything |
| `services/<name>-<lang>.md` | One card per service (built or planned) | the chat of that service + chats of adjacent services |

Services: `wika` (wiki), `rukh` (tasks), `bordy` (boards and design), `nodo` (maps and diagrams), `sota` (tables), `kadry` (presentations), `questa` (surveys), `toker` (chat), `vault` (files), `doba` (calendar), `visio` (video meetings), `apus-ai` (AI tools), `showy` (personal pages), `obriy` (company apps), `spilno` (CRM).

Source of truth stays `docs/decisions.md`, `docs/backlog.md` and the code. If a card disagrees with them, the card is wrong — fix the card.

## One chat per service

Give each chat:
1. `00-overview` — always.
2. `platform` — always.
3. The service's own card.
4. Cards of adjacent services — the ones named in the card's "links with other services" table.

Adjacent cards by service:

| Chat | Add these cards |
|---|---|
| Wika | rukh, sota, questa, bordy, nodo, kadry |
| Rukh | wika, bordy, kadry, toker, doba |
| Bordy | kadry, wika, rukh |
| Nodo | wika, kadry |
| Sota | questa, wika, kadry |
| Kadry | bordy, wika, sota, rukh, questa |
| Questa | sota, wika, kadry |
| Toker | rukh, questa, doba, visio |
| Vault | platform only (touches every service) |
| Doba | rukh, toker, visio |
| Visio | toker, doba, apus-ai |
| Apus AI | wika, nodo, visio |
| Showy | obriy, wika, questa |
| Obriy | showy, sota |
| Spilno | rukh, doba, questa |
| Platform / pricing / launch | all cards are optional; `docs/pricing-uk.md`, `docs/roadmap-uk.md` |

## Starting prompt (any AI chat outside this repository)

Attach the files above, then send:

```
You are helping plan and analyse one service of a team-workspace platform.
The attached files describe the whole platform (overview, platform core) and
the service cards. Service in focus: <NAME>.

Rules:
- "Service" means a section of ONE platform (one app, one database schema,
  one sign-in), not a separate system. Never propose a separate backend,
  database or sign-in for a service.
- Reuse the shared core (people, roles, units, guests, storage, search,
  notifications, service objects) instead of re-inventing it.
- Anything that changes data, access rules, sign-in or secrets needs the
  owner's separate approval: flag it explicitly.
- Do not use third-party product names or logos in proposed UI text.
- The owner is not a developer: answer in plain Ukrainian, formal «ви»,
  short, no code unless asked.
- If the files do not answer something, say so instead of guessing. The cards
  are a snapshot; decisions made after the "state as of" date are not in them.
- When a proposal touches another service, name that service and what
  changes for it.

End every planning answer with:
1. "Decisions to record" — short list for docs/decisions.md.
2. "Affects other services" — which cards must be updated.
```

## Starting prompt (Claude Code session in this repository)

Nothing to attach — the files are read on demand:

```
Work on service <NAME>. Before planning, read docs/context/services/<name>-en.md
and the adjacent cards it names.
```

## Carrying decisions between chats

A chat does not see other chats. The repository is the only shared memory.

1. A planning chat ends with "Decisions to record" and "Affects other services".
2. The owner brings that list to a Claude Code session in this repository.
3. That session records the decision in `docs/decisions.md`, updates `docs/backlog.md` and the affected cards (both languages), and opens a PR.
4. Other chats get the refreshed files the next time they are started or re-synced.

Never treat a decision as made until it is in `docs/decisions.md`.

## Keeping the cards current (rule for the coding agent)

- A PR that changes a service's behaviour, data or links updates that service's card in the same PR — both `-uk` and `-en`, and the "state as of" date.
- A change in the shared core updates `platform-*`; a new service, a rename or a changed principle updates `00-overview-*`.
- Cards stay short: what exists, what is planned, links, open questions. History belongs in `docs/decisions.md`.
- Do not load the whole pack in every session; read only the cards the task needs.
