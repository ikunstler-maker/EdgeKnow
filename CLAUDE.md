@AGENTS.md

# EdgeKnow — internal wiki (Notion-like)

`docs/SPEC.md` is the single source of truth (in Ukrainian), amended by owner-approved decisions in `docs/decisions.md`. If a request contradicts them, ask first.

## Working agreement
- Work strictly stage by stage (SPEC → "Етапи реалізації"): plan → owner's OK → code → verify "Готово, коли" → commit.
- Only v1. Do not build v2 / "Пізніше" items, but don't block them architecturally.
- Stack is fixed: Next.js (App Router, TS), BlockNote, Supabase (@supabase/ssr), Tailwind, browser-image-compression; React Flow only in v2.
- The owner is not a professional developer: explain decisions briefly, in plain Ukrainian.
- UI is Ukrainian; every UI string lives in `src/i18n/uk.ts`. Code, identifiers and commits are English.
- Never hard-code email domains; they live in the `allowed_domains` table.

## Database
- Schema changes only via `supabase/migrations/*.sql`; CI (`.github/workflows/db-migrate.yml`) tests and applies them on push to `main`.
- Write RLS policies in the same migration as the table. RLS on every table.
- Client never writes protected tables directly: use SECURITY DEFINER functions with `set search_path = ''`, explicit `revoke ... from public, anon, authenticated` and minimal grants.
- Security tests: `supabase/tests/stage*.sql` + `.expected`, run with `scripts/test-db.sh` against any Postgres.

## Secrets
- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` reach the browser. Secret keys only in Vercel/GitHub env, never in code.

## Next.js 16 notes
- `src/proxy.ts` (formerly middleware) refreshes the session and re-checks the domain on every request.
- `cacheComponents` is intentionally off: every page is per-user.
