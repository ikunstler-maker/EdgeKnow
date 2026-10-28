@AGENTS.md

# EdgeKnow — internal wiki (Notion-like)

`docs/SPEC.md` is the single source of truth (in Ukrainian), amended by owner-approved decisions in `docs/decisions.md`. If a request contradicts them, ask first.

## Working agreement
- Work strictly stage by stage (SPEC → "Етапи реалізації"): plan → owner's OK → code → verify "Готово, коли" → commit.
- Only v1. Do not build v2 / "Пізніше" items, but don't block them architecturally.
- Stack is fixed: Next.js (App Router, TS), BlockNote, Supabase (@supabase/ssr), Tailwind, browser-image-compression; React Flow only in v2.
- The owner is not a professional developer: explain decisions briefly, in plain Ukrainian.
- UI is Ukrainian; every UI string lives in `src/i18n/uk.ts`. Code, identifiers and commits are English.
- Never hard-code email domains; they live in the `workspace_domains` table.
- Multi-tenant: every table with team data has `workspace_id`; every policy starts with
  `is_workspace_member(workspace_id)`; `effective_role()` checks membership first.
  The platform admin sees statistics only, never page contents.
- Workspace URLs are `/w/<short_id>/...` (short_id is permanent, the name is not).

## Database
- Schema changes only via `supabase/migrations/*.sql`; CI (`.github/workflows/db-migrate.yml`) tests and applies them on push to `main`.
- Write RLS policies in the same migration as the table. RLS on every table.
- Client never writes protected tables directly: use SECURITY DEFINER functions with `set search_path = ''`, explicit `revoke ... from public, anon, authenticated` and minimal grants.
- Security tests: `supabase/tests/stage*.sql` + `.expected`, run with `scripts/test-db.sh` against any Postgres
  (`--update` rewrites the expected files — review the diff). `supabase/tests/upgrade/*` replay data migrations
  and rollbacks.
- Each migration gets a rollback script in `supabase/rollbacks/`.
- Path C (team-owned databases): the team schema lives in `supabase/team/migrations/` with rollbacks in
  `supabase/team/rollbacks/` and tests in `supabase/team/tests/` (`scripts/test-team-db.sh`).
  `0001_baseline.sql` is a generated dump; never edit it, add numbered migrations instead.
  Until step 1.7, a page-feature change needs both a central and a team migration.
  CI's `team` job runs `scripts/team-isolation.mjs` against two local Supabase stacks.
- CI also runs `scripts/api-isolation.mjs` (real HTTP against local Supabase) and `scripts/e2e-smoke.mjs`
  (browser). Errors surface as annotations on the run.

## Secrets
- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` reach the browser. Secret keys only in Vercel/GitHub env, never in code.

## Next.js 16 notes
- `src/proxy.ts` (formerly middleware) refreshes the session and re-checks the domain on every request.
- `cacheComponents` is intentionally off: every page is per-user.
