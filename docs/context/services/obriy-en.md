# Obriy — company apps

> **Service card (planned).** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. No code yet: this is the intent and open questions. Source of truth: `docs/decisions.md`, `docs/backlog.md`. Ukrainian twin: `obriy-uk.md`.

## 1. Purpose

A section of apps that live inside the company's space: ready-made ones from the product owner and the companies' own.

- **State:** ⏳ planned.

## 2. Intent

- **Ready-made apps** from the owner. The first is **financial monitoring** (an existing separate app of the owner): build it into the ecosystem, adapt to corporate requirements, data in the workspace database, access for organization admins only. Team and above.
- **Companies' own apps:** a company adds and embeds its apps next to the services, with the same access.
- Financial monitoring is **not a separate service** but one of the apps of this section.

## 3. Expected links

| Service | Link |
|---|---|
| **Core** | access, roles, units, collections |
| **Showy** | corporate pages with code — draw the line |
| **Sota** | app data may rest on tables |
| **Apus AI** | automations may call apps |

## 4. Open questions

- How foreign code runs: isolation, separate domain, what it may read → security approval.
- Moving the financial app in: its data, roles, what "organization admin" means before the "Organization" level exists.
- Whether there will be an app catalogue and who reviews apps.

## Rules shared by any new service

- It is a section of the platform: shared accounts, workspaces, roles, units, guests, storage, search, notifications.
- Data lives in tables with `workspace_id` and access rules in the database; two migrations (central and team) plus the move between databases.
- New tables and access rules need the owner's separate approval before code.
- The service tile already exists on the start page and the landing with a "Soon" badge (`src/lib/services.ts`).
- No third-party product names or logos.
