# Shared platform core

> **Core card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. Everything that belongs to no single service but concerns all of them. Source of truth: `docs/decisions.md` and the code. Ukrainian twin: `platform-uk.md`.

## 1. Purpose

The core gives every service people, access, storage, search, notifications and navigation ready-made. A new service **uses** the core instead of repeating it.

## 2. What is built

### Sign-in and accounts
- Sign-in with Google and with email and password.
- Joining a workspace: by the company's email domain (proven through DNS) or by invitation.
- **"My data":** download one's data and delete the account.
- Open registration is a switch in the platform panel.

### Workspace
- Create, name, permanent short ID in the URL, transfer ownership, delete, leave.
- **Onboarding** of a new workspace with example pages.
- **Storage:** the workspace's Google Drive or the database's storage; moving files between them.
- **Team-owned database:** connection wizard, health state, automatic schema updates, moving a workspace there and back.
- **Backups** to Google Drive.

### People and access
- Roles: owner, admin, member, guest.
- **Custom roles** with rights (among them "Manage time off" for HR: policies, balances, approvals) and a "level" (the most a person gets on content open to the whole workspace).
- **Unit tree** (up to 8 levels), unit managers; access flows down the tree and up — to managers only.
- **Guest:** personal invitation to any email, optional end date; what a guest creates belongs to the workspace owner.

### "Service object" — the shared base
- Table `service_objects`: name, content, search text, version (guards against concurrent edits), trash.
- Access like pages: owner, admins, whole workspace, people, units.
- Bordy, Nodo, Sota, Kadry and Questa are built on it. A new "file-like" service starts from it.

### Navigation
- **Start page** with service tiles; service switcher.
- **Left panel** shows the current section's content; resizable; bottom row of icons (profile, trash, settings, help, sign out), theme and language.
- **Collections:** shared folders of workspace objects; one object in many collections, no copies.
- **Search** across all services, with filters by service and content type.

### Notifications and analytics
- **Notifications** (bell): mentions, assignments, project rules, calendar events (invitation, request to join, answer, change or cancellation, reminder before the start), time off (a request to decide on, a decision, "you are the deputy", an absence for information); in the browser while the site is open; per-person settings. A new kind of notification adds its link column and its kinds to `notifications` and extends `my_notifications` and `set_notification_prefs`.
- **Analytics:** everyone sees their own numbers; owner and admins — everyone's; the platform admin — totals only.

### Look
- Light and dark themes, Ukrainian and English.
- **Apus** — the mascot: a small one in the left panel next to the current place, a big one as a floating button with a menu (notifications, feedback); can be dragged, collapsed or hidden.
- Service names and gradients — `src/lib/services.ts`.

### Public pages
- Landing `/about` (always dark, with "Soon" badges).
- "What's new" `/changelog`.
- Help `/help`, privacy `/privacy`.

### Platform panel (`/admin`)
- Platform admin only: statistics, freezing a workspace, domain requests, registration switch, sign-in key for team databases.
- Shows no team content.

### Protection
- Rate limits; file type verified by content; embedding other sites is forbidden.
- Isolation tests: one team can never see another.

## 3. Planned

| What | State | Note |
|---|---|---|
| Rename to Synkvela | approved, not done | texts, logo, emails, domain, redirects from old URLs |
| Own icons instead of emoji | owner's request | |
| Service logos on the start page | planned | |
| Smart chips everywhere | owner's request | the wiki already has page, person and task chips |
| Notifications when the site is closed | planned | needs a key in hosting settings |
| "Organization" level above several workspaces | planned | Business |
| Objects shared between workspaces | planned | together with chat |
| Pricing: feature flags, PRO badge, payments | planned (stage 4) | `docs/pricing-uk.md` |
| 2 devices per email limit | planned | sign-in change → approval |
| Corporate SSO, exportable audit log | planned | Business |
| Key `CALENDAR_TOKEN_KEY` | approved (Doba phase 3) | its own key for external calendars' secrets, next to `DRIVE_TOKEN_KEY` and `TEAM_DB_KEY` (`src/lib/drive/secret-box.ts`) |
| Mini-game with Apus | owner's request | original game; online mode → approval |
| Phone app (PWA) | planned | |

## 4. Data (main)

| Table | Holds |
|---|---|
| `profiles` | people |
| `workspaces`, `workspace_members`, `workspace_roles` | spaces, members, roles |
| `workspace_groups`, `workspace_group_members` | unit tree |
| `workspace_domains`, `workspace_domain_claims`, `invitations` | domains and invitations |
| `team_databases` | connected team databases |
| `drive_connections`, `drive_accounts` | Google Drive |
| `service_objects` and their access tables | service objects |
| `object_collections`, `object_collection_items` | collections |
| `object_files`, `attachments` | files |
| `notifications`, `notification_prefs` | notifications (links: task, page, calendar event, time-off request) |
| `calendar_events`, `calendar_event_attendees`, `calendar_settings` | Doba: events, their people, working days and time zone |
| `leave_policies`, `leave_balances`, `leave_requests`, `leave_holidays`, `leave_member_settings` | Doba: time-off policies, the balance ledger, requests, holidays, start dates |
| `calendar_feeds` | Doba: the hash of a person's calendar-feed secret (closed to everyone; the server reads the feed) |
| `audit_log`, `admin_audit_log` | action logs |
| `platform_settings`, `rate_limits` | platform settings and limits |

## 5. Key files

| What | Where |
|---|---|
| Access check on every request | `src/proxy.ts`, `src/lib/supabase/proxy.ts` |
| Workspace, sign-in | `src/lib/workspace.ts`, `src/lib/auth.ts` |
| Units | `src/lib/groups.ts` |
| Team databases | `src/lib/team-db/` |
| Sign-in for team databases | `src/lib/oidc.ts`, `src/app/oidc/` |
| Google Drive | `src/lib/drive/` |
| Left panel, collections | `src/components/sidebar/` |
| Service tiles | `src/components/services/`, `src/lib/services.ts` |
| Search | `src/components/search/` |
| Notifications | `src/components/notifications/`, `src/lib/notifications.ts` |
| Apus | `src/components/apus/` |
| Workspace settings | `src/app/w/[wid]/settings/` |
| Landing | `src/app/about/`, `src/components/landing/` |
| UI strings | `src/i18n/uk.ts`, `src/i18n/en.ts` |
| Migrations | `supabase/migrations/`, `supabase/team/migrations/` |
| Tests | `scripts/test-db.sh`, `scripts/test-team-db.sh`, `scripts/e2e/` |

## 6. Rules for services

0. The request's workspace, role and data location come from one function, `workspace_context` (`src/lib/workspace.ts`).
1. A new "file-like" service is built on `service_objects`, not on its own objects table.
2. The database checks access. The UI only hides what is already forbidden.
3. Embedding an object in another service stores only its ID; without access — "No access" with no name.
4. Every new table: `workspace_id`, policies in the same migration, rollback, tests, team migration, move between databases.
5. Guests get no access through "whole workspace" or units.
6. Everything new goes into search, trash, backup and "My data" where it makes sense.
7. Strings in both languages; phone and both themes are mandatory.

## 7. Open questions

- "Organization" level: how it combines with the unit tree and custom roles.
- Which core features become paid beyond those already set (SSO, audit log, manager analytics).
