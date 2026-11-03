# Backlog (open work, short)

Long-term plan: `docs/roadmap-uk.md`, `docs/suite-plan-uk.md`. Decisions: `docs/decisions.md`.

## Next by plan
- Chat (suite plan, after surveys) → Presentations → Files manager (roadmap stage 2b).
- Boards Д2: realtime co-editing (postponed by the owner).
- Organization level, shared objects between workspaces (later).

## Known gaps / follow-ups
- `platform_workspaces`: hide name/owner email in the DB function itself for workspaces the admin isn't in (now hidden on the page only). Needs a migration + CI run.
- Team move (`src/lib/team-db/move.ts`) doesn't copy `object_files` (board pictures, survey files) or `board_sessions`/`board_votes`; check and add with tests.
- "Мої дані" export doesn't include a person's own named survey answers (needs an RPC: tables are function-only).
- Tables: formula engine lacks array literals `{1,2}`, spill (FILTER/SORT/UNIQUE/TRANSPOSE), ROW/COLUMN(ref), LET/LAMBDA (121/126 match Excel).
- e2e flake: Т4 "a change made elsewhere shows up without editing the page" (sheet embed) fails intermittently.
- Turnstile: confirm the check shows on open forms once both Vercel keys are set.
- Open registration is a switch in the platform panel (turns on "own database first").
