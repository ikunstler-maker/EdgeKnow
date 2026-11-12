# Toker — team chat

> **Service card (planned).** Read with `docs/context/00-overview-en.md`. **State as of:** 2026-11-12. No code yet: this is the intent, the stages and open questions. Source of truth: `docs/decisions.md` (decision 2026-11-12 "Toker: architecture and stages"), `docs/backlog.md`. Ukrainian twin: `toker-uk.md`.

## 1. Purpose

Team chat next to the work: channels, direct messages, threads, voice rooms. Combines the structure of a work messenger with the sense of presence of a community app. The next big service by plan.

- **State:** ✅ stage 1 (#169, #171, #174); 🛠 stage 2: direct and group conversations (2a, #176); files and voice messages (2b, #177); 2d — chosen-publisher channels, voice player. Before: stage 1: database (1a) and main screen (1b) — channels, categories, stream, composer, members, live updates. Threads (right panel), reactions, pins, "@" mentions and the bell — 1c. Decisions 2026-11-12 "Toker, етап 1", "Toker, PR 1б", "Toker, PR 1в".

## 2. Intent

**Structure and interface**
- Three zones: left panel (categories, channels, direct messages, voice rooms), centre (channel stream with pinned messages on top), right slide-out panel (thread, members with roles, details of an attached object).
- Collapsible channel categories ("General", "Projects", "Units", "Voice rooms", "External partners"); visibility can be set for a whole category.
- Channel kinds: text, forum (separate discussion cards instead of one stream), voice.
- Open and closed channels; direct and group messages; reply threads.
- Mentions of a person and a channel, reactions, pinned messages, edit and delete.
- Files and voice messages; history search.
- Presence statuses, quiet hours, per-channel notifications, drafts, scheduled send.

**Security**
- Messages are written only through database functions that check channel and workspace membership; never directly from the browser.
- **Unit channel:** a closed channel can be bound to a unit (tree up to 8 levels). When a person moves to another unit or leaves, the database closes access by itself.
- **Guests:** see only channels they were personally invited to; never the workspace's general channels. After their access end date they lose the history too.
- **Secret rooms** (optional, for rooms and direct chats): on-device encryption (the browser's built-in Web Crypto). The database holds only ciphertext; without the key it cannot be read even with direct table access.
- **Retention:** the owner sets the history period for the workspace and separately for sensitive channels (e.g. 24 hours or 7 days). Everyone can export their own permitted history via "My data".
- **Attachments:** the server checks a file by its first bytes and serves it only after checking channel access.
- The platform admin sees no content.

**Links with the ecosystem**
- Live chips: a link to a page, task, table or board becomes a card; a task's status and assignee can be changed right from chat. No rights to the object — a neutral "No access" badge without the title.
- Actions from a message or a selected fragment: a Rukh task (with a link back to the thread), a Wika note, a Doba event.
- Questa surveys are answered right in the channel.
- Doba sets the "On leave" status; a unit lead approves time off with a button in a system message.
- Apus AI: voice-message transcription (searchable) and a short summary of a long thread — with the team's own AI key.
- "Sit nearby" voice rooms: click to join in the background, see who is there, share the screen in one click (with Visio).
- Channels shared with another company: approved by both owners; each side keeps its own history.

## 3. Stages (approved 2026-11-12)

| Stage | What |
|---|---|
| 1. Core | open and closed channels, categories, members, messages, threads, reactions, mentions, pins, edit and delete, unread, realtime; unit channel; guests only in invited channels |
| 2. Direct & files | direct and group messages; files and voice messages with content checks; search; drafts, scheduled send, per-channel notifications, quiet hours |
| 3. Links | live chips, message actions (task, note, event), Questa surveys, Doba status and time-off approval |
| 4. Retention & notifications | retention periods, "My data", notifications when the site is closed (Web Push), PWA app |
| 5. Secret rooms | on-device encryption |
| 6. Later | forum channels, voice rooms (with Visio), Apus (transcription, summaries), cross-company shared channels |
| 7. Platforms | desktop (Tauri: tray, global hotkeys, OS key store), phones (Capacitor or Expo: background calls, biometrics, "Share") |

## 4. Technical frame (already decided)

- Toker is a section of the platform: shared sign-in, database schema, roles and units; no separate servers or third-party backends.
- Messages are stored where the rest of the data is: the central database or the team's own database.
- Real-time delivery through the database's realtime mechanism (Supabase Realtime).
- A closed channel is seen only by its members; checked by the database.
- Cross-platform on one codebase: web + PWA first, then desktop, then phones.
- **Data (stage 1a):** `chat_categories` (folders; "restricted" — only for its people), `chat_category_access` (units and people of a restricted category), `chat_channels` (open/closed, unit, archive), `chat_channel_members` (added — `invited`; read mark and notifications — others' hidden), `chat_messages` (thread — one level; a deleted one stays as an empty row), `chat_reactions`. Migrations `supabase/migrations/20270123100000_chat.sql` and `supabase/team/migrations/0068_chat.sql`; tests `stage76_chat`, `team9u_chat`.
- **Access:** `chat_can_see(channel, person)` — category open + (added; or open channel and not a guest; or closed unit channel and `unit_reaches`). Admins see a closed channel only as members. Changes only through `chat_*` functions (creating by role rights `create_open_channels` / `create_closed_channels`; at most 30 messages a minute).
- **Screen (1b):** `src/app/w/[wid]/chat/page.tsx` → `src/components/chat/chat-screen.tsx` (left column `channel-list.tsx`, stream and composer `message-stream.tsx`, `members-panel.tsx`, dialogs `chat-dialogs.tsx`, live signals `use-chat-live.ts`); server actions `src/app/chat-actions.ts`; types `src/lib/chat.ts`. Channel address — `?c=<id>`. Central database — realtime signals; team database — 5 s polling.
- **Bell (1c):** kinds `chat_mention`, `chat_reply`; `notifications.chat_message_id`; trigger `chat_notify_message` → `chat_notify` (only who sees the channel, not "Nothing", kind not muted, once per message). Migrations `20270126100000_chat_mentions.sql`, team `0070_chat_mentions.sql`; tests `stage79_chat_mentions`, `team9w_chat_mentions`. Bell link: `?c=<channel>&t=<thread>&m=<message>`.
- **Direct conversations (2a):** `chat_channels.visibility = 'direct'`, `dm_key` (one conversation per pair), `history_visible`; `chat_channel_members.history_from` — from when a person sees messages (`chat_history_ok` in the message and reaction rules). Functions `chat_open_direct`, `chat_set_history_visible`, `chat_set_member_history`, `chat_add_members(…, show_history)`. Migrations `20270129100000_chat_direct.sql`, team `0073_chat_direct.sql`; tests `stage82_chat_direct`, `team9z_chat_direct`.
- **Files (2b):** `chat_files` (message, kind file/image/voice, duration, size; stored like task files: the workspace Drive or the `chat-files` bucket), `chat_messages.file_count`; `register_chat_file` → `POST /api/chat/files` (first bytes, `chatFileLooksLike`) → `chat_post_message(…, file_ids)`; served by `GET /api/chat/files/<id>` by access; `clean_chat_files` in the daily cleanup. Migrations `20270131150000_chat_files.sql`, team `0074_chat_files.sql`; tests `stage83_chat_files`, `team9z1_chat_files`. UI: `src/components/chat/chat-files.tsx`.
- **Chosen publishers (2d):** `chat_channels.post_policy` (`everyone`/`chosen`), `chat_channel_members.can_post`, `chat_can_publish`; `chat_set_post_policy`, `chat_set_member_can_post`; `chat_post_message` checks top messages (not replies). Voice: `chat_files.waveform` (levels 0..5), player `src/components/chat/voice-player.tsx`. Migrations `20270202150000_chat_publish.sql`, team `0075_chat_publish.sql`; tests `stage84_chat_publish`, `team9z2_chat_publish`.
- **Realtime:** triggers send id-only signals to private topics `chat:<channel>` and `chat-user:<person>`; who may join — `chat_topic_allowed`.

## 5. Expected links

| Service | Link |
|---|---|
| **Rukh** | task from a message with a link back; status and assignee change from a chip; task notifications to a channel |
| **Questa** | survey in a channel; form answers by a bot |
| **Doba** | meeting from a channel; reminders; "On leave" status from `team_absences`; time-off approval with a button in a message. Doba's bell is not duplicated |
| **Visio** | call from a channel; persistent voice rooms in the left panel |
| **Wika** | page chips; note from a message |
| **Apus AI** | voice-message transcription; thread summary |
| **Vault** | chat files and voice messages in the file manager — with channel access |
| **Core** | global search, "My data", notifications when the site is closed |
| **Free / Team** | on Free limited history and no shared channels — draft, open pricing question |

## 6. Open questions

- Secret rooms: search, transcription, AI summaries and live chips do not work there; a lost key means lost history. Needs the owner's consent to these limits (before stage 5).
- Drive backup of chat — later. Live signals for team databases — separate approval.
- Web Push key: serve the public part to the browser from the server, so the list of browser variables does not grow; the private part lives only in hosting settings.
- Cost and limits of realtime in a team database.
- Voice messages: storage and size.

## Rules shared by any new service

- It is a section of the platform: shared accounts, workspaces, roles, units, guests, storage, search, notifications.
- Data lives in tables with `workspace_id` and access rules in the database; two migrations (central and team) plus the move between databases.
- New tables and access rules need the owner's separate approval before code.
- The service tile already exists on the start page and the landing with a "Soon" badge (`src/lib/services.ts`).
- No third-party product names or logos.
