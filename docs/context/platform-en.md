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
- **Active sessions:** an admin sees a member's devices (phone / tablet / computer, sign-in and last activity, no IP) and ends all their sessions (signed out everywhere, logged); Profile → My devices ends one's own. An ended session loses access on its next request: `current_email()` requires the token's session to exist; the proxy then sends the browser to sign in.
- **Settings** in five tabs: General; Team & structure (members table with search, quick filters, unit filter and a member card; company structure); Roles & security (roles, domains, device limit and SSO marked Soon); Data & storage (Drive, backups, team database); Log. Old `?tab=` addresses still open the right tab.

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
- **Start page**: service tiles in four categories (mark, name, one-line description, recent items or "Create").
- **Left panel** (top to bottom): the workspace name opens the workspace and account menu (other workspaces, profile, settings, theme, language, "What's new", help, sign-out); a dock of pinned services and a button for the list of all services by category (Ctrl/Cmd+E; pins are kept in the browser); search, notifications; the current section's content (in Rukh: projects and boards, no tasks); at the bottom the bin and Apus. Resizable; collapses to a slim rail (button or Ctrl/Cmd+\; kept in the browser).
- **Collections:** shared folders of workspace objects; one object in many collections, no copies.
- **Search** across all services, with filters by service and content type.

### Notifications and analytics
- **Notifications** (bell): mentions, assignments, project rules, calendar events (invitation, request to join, answer, change or cancellation, reminder before the start), time off (a request to decide on, a decision, "you are the deputy", an absence for information); in the browser while the site is open; per-person settings. A new kind of notification adds its link column and its kinds to `notifications` and extends `my_notifications` and `set_notification_prefs`.
- **Analytics:** everyone sees their own numbers; owner and admins — everyone's; the platform admin — totals only.

### Look
- Light and dark themes, Ukrainian and English.
- **Apus** — the mascot: a small one in the left panel next to the current place, a big one as a floating button with a menu (notifications, feedback); can be dragged, collapsed or hidden.
- Service names, gradients and the four service categories (Knowledge & planning, Visuals & design, Data & storage, Communication & business) — `src/lib/services.ts`.
- **Design system** (updated 2026-11-11, PR 1 of 6): three surface levels — the shell (left panel), the canvas, raised cards — and thin translucent hairlines instead of grey outlines; colours in `src/app/globals.css` (`--shell`, `--background`, `--surface`, `--overlay`, `--border`, `--border-strong`, `--hover`). Corners: buttons, inputs and pills 8 px, cards 12 px, dialogs 16 px. Thin scrollbars everywhere.
- **Icons:** our own line icon set `Icon` (`src/components/ui/icon.tsx`, 1.75 stroke) and each service's mark `ServiceIcon` (`src/components/services/service-icon.tsx`: a tile in the service's gradient with a drawn glyph). No emoji in the interface; the exception is icons a person picked themselves (Wika pages, Rukh projects).
- **Document studio** (updated 2026-11-11): a table, a deck, a board, a "Design" file, a map and a diagram open on the whole screen under one 48 px bar (`StudioShell`, `src/components/ui/studio-shell.tsx`). Left: the panel toggle, "back", the name and the save state; centre: the document's own switch; right: "Export / Import", "Access", one main action and "More" (with "To the bin"). In a studio Apus stands higher, clear of the editor's corners.
- **Profile** (`/w/<id>/profile`): a card with photo, name, job title, role, department and team (from the unit tree: department = top-level unit, team = a lower unit the person is in). The person changes their own name and photo (cropped in the browser to 256×256, kept in the private `avatars` bucket, served by `/api/avatar/<id>` only to people sharing a workspace; sign-in no longer overwrites a custom name or photo). The job title: the person or the owner/admins. A colleague's profile (`/w/<id>/profile/<uid>`) shows the card to all members (not guests) with the birthday (day and month); who manages time off (the owner among them) sets it there without a year; statistics only if the person shared them; "My wishlists" creates a wishlist for the next birthday and lists one's own. **Wishlist** (`/w/<id>/wishlists/<id>`, a `wishlists` object in `service_objects`, photos in `object_files`): wishes (title, note, price, up to 3 http/https links, a photo), a look (10 gradients, accent, effect, emoji pattern); a draft only its owner sees (not admins), a published one members (not guests) while the birthday is shown; the owner edits (autosave), publishes, copies to the next birthday, deletes for good; profiles show cards (past ones folded into an archive), the home birthdays block a "Wishlist" button; "I'll give this" / "I'll chip in" (`wishlist_gifts`) are seen by colleagues, never the owner; removing a taken wish warns first and then notifies those taking part (`wishlist_item_removed`, `wishlist_deleted`); a wishlist is embedded as a live card in Wika (the "Wishlist" block), slides and "Design" boards (embed), tasks (`task_wishlist_links`), plain boards get a "Wishlist · name" link; without access — "Wishlist unavailable"; who sees the statistics as two choice cards; numbers as tiles; "Appearance" with a switch and Apus choice cards; "My data" with a separate danger zone for deleting the account.
- **Dialogs:** a dark blurred backdrop, a raised panel with 16 px corners. Permanent explanatory paragraphs under screen titles became "i" hints.
- **Shared controls** (`src/components/ui/`): `Button`/`IconButton` (32 px on a desktop, 44 px on a phone), `inputClass` (36/44 px), `Segmented`, `Dialog`, `Hint`, `Popover`. A screen header has at most one primary button.

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
| Own icons instead of emoji | done (6 PRs, decision 2026-11-11) | no emoji in the interface; `scripts/check-ui-emoji.mjs` checks it before every build |
| Service logos on the start page | done | `ServiceIcon` |
| Smart chips everywhere | owner's request | the wiki already has page, person and task chips |
| Notifications when the site is closed | planned (Toker stage 4) | Web Push: works with the tab closed; the browser gets the key's public part from the server (the list of browser variables does not grow), the private part lives only in hosting settings → separate approval. Shared by all services (Rukh, Doba, Toker) |
| Chat in global search and "My data" | with Toker | search sees only messages of channels the person is a member of; secret rooms are not indexed; "My data" exports one's own permitted chat history |
| "Organization" level above several workspaces | planned | Business |
| Objects shared between workspaces | planned | together with chat |
| Pricing: feature flags, PRO badge, payments | planned (stage 4) | `docs/pricing-uk.md` |
| 2 devices per email limit | planned | sign-in change → approval |
| Corporate SSO, exportable audit log | planned | Business |
| Key `CALENDAR_TOKEN_KEY` | in use since Doba 3b (`v3.cal.…`, no fallback key) | its own key for external calendars' secrets, next to `DRIVE_TOKEN_KEY` and `TEAM_DB_KEY` (`src/lib/drive/secret-box.ts`) |
| Mini-game with Apus | owner's request | original game; online mode → approval |
| Phone app (PWA) | planned | |

## 4. Data (main)

| Table | Holds |
|---|---|
| `profiles` | people (`name_custom`, `avatar_custom` — own name and photo) |
| `workspaces`, `workspace_members`, `workspace_roles` | spaces, members, roles |
| `workspace_groups`, `workspace_group_members` | unit tree |
| `workspace_domains`, `workspace_domain_claims`, `invitations` | domains and invitations |
| `team_databases` | connected team databases |
| `drive_connections`, `drive_accounts` | Google Drive |
| `service_objects` and their access tables | service objects |
| `object_collections`, `object_collection_items` | collections |
| `object_files`, `attachments` | files |
| `chat_categories`, `chat_category_access`, `chat_channels`, `chat_channel_members`, `chat_messages`, `chat_reactions` | Toker: categories, channels, people, messages, reactions (see the Toker card) |
| `notifications`, `notification_prefs` | notifications (links: task, page, calendar event, time-off request, chat message) |
| `calendar_events`, `calendar_event_attendees`, `calendar_settings` | Doba: events, their people, working days and time zone |
| `leave_policies`, `leave_balances`, `leave_requests`, `leave_holidays`, `leave_member_settings` | Doba: time-off policies, the balance ledger, requests, holidays, start dates |
| `calendar_external_busy`, `calendar_connections` (central only) | Doba: busy slots read from a person's outside calendar (start and end only); the calendar's address, encrypted, closed to everyone |
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
