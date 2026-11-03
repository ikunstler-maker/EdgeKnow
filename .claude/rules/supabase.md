---
paths:
  - "supabase/**"
  - "**/*.sql"
  - "src/lib/team-db/**"
  - "src/lib/supabase/**"
  - "scripts/test-db.sh"
  - "scripts/test-team-db.sh"
---
# Database rules
- Data / access / RLS changes need the owner's explicit approval first.
- Schema changes only via `supabase/migrations/*.sql`; CI (`.github/workflows/db-migrate.yml`) tests them and applies on push to `main` (backup first). A migration merged without CI is NOT applied.
- Every team table: `workspace_id`; RLS on every table, policies in the same migration as the table.
- Client never writes protected tables directly: SECURITY DEFINER functions with `set search_path = ''`, explicit `revoke ... from public, anon, authenticated`, minimal grants. Server-only functions: grant to `service_role` only.
- Each migration: exact rollback in `supabase/rollbacks/` (verify by diffing function defs, ACLs, policies, constraints, indexes, columns before/after).
- Tests: `supabase/tests/stage*.sql` + `.expected` via `scripts/test-db.sh` (`--update` rewrites expected — review the diff); `supabase/tests/upgrade/*` replay data migrations and rollbacks.
- Path C (team-owned DBs): team schema in `supabase/team/migrations/` (+ `rollbacks/`, `tests/`, `scripts/test-team-db.sh`). `0001_baseline.sql` is generated — never edit. A page/service feature needs both a central and a team migration. New side tables of a feature: add to `src/lib/team-db/move.ts` (and backup if useful).
- CI also runs `scripts/team-isolation.mjs`, `scripts/api-isolation.mjs` and `scripts/e2e/*.mjs` against local Supabase; errors surface as run annotations.
