# Apus AI — AI tools

> **Service card (planned).** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. No code yet: this is the intent and open questions. Source of truth: `docs/decisions.md`, `docs/backlog.md`. Ukrainian twin: `apus-ai-uk.md`.

## 1. Purpose

AI for the whole company at no cost to the product owner: the team connects its own key or its own model.

- **State:** ⏳ planned.
- **Do not confuse:** Apus is the product mascot (already there: floats in the left panel, opens a menu with notifications and feedback). Apus AI is the planned AI service; the AI assistant is meant to appear in Apus's menu.

## 2. Intent

- **AI assistant with the team's own key:** page drafts, answers with links to the wiki, diagram from text, page review, translation.
- **Transcription** of audio and video to text.
- **Dictation** by voice in any field.
- **Node-based automations:** trigger → actions across services and external tools.
- **Own models:** the company's local models or online models through the MCP protocol.

## 3. Expected links

| Service | Link |
|---|---|
| **Wika** | drafts, answers with links, translation |
| **Nodo** | diagram from text |
| **Visio, Toker** | transcription of meetings and voice messages |
| **All services** | automations between them |

## 4. Open questions

- Keys and model addresses live in workspace settings, encrypted → security approval.
- The AI sees only what the asking person sees: how to guarantee that in the database.
- Automations act on someone's behalf: whose rights they carry.
- Free limits — open question.
- Before building, verify current model capabilities and names against the providers' documentation.

## Rules shared by any new service

- It is a section of the platform: shared accounts, workspaces, roles, units, guests, storage, search, notifications.
- Data lives in tables with `workspace_id` and access rules in the database; two migrations (central and team) plus the move between databases.
- New tables and access rules need the owner's separate approval before code.
- The service tile already exists on the start page and the landing with a "Soon" badge (`src/lib/services.ts`).
- No third-party product names or logos.
