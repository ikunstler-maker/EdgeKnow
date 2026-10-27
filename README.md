# EdgeKnow

Internal wiki with a Notion-like editor. Next.js on Vercel + Supabase (Auth, Postgres with RLS, Storage).

- Spec: [`docs/SPEC.md`](docs/SPEC.md)
- Setup guide (Google Cloud, Supabase, Vercel), in Ukrainian: [`docs/setup-uk.md`](docs/setup-uk.md)

## Local development

```bash
cp .env.example .env.local   # fill in the Supabase URL and publishable key
npm install
npm run dev                  # http://localhost:3000
```

## Database

Migrations live in `supabase/migrations`. On every push to `main` that touches `supabase/`,
GitHub Actions runs the security tests and then `supabase db push`.

Run the database tests locally against any Postgres 15+:

```bash
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres scripts/test-db.sh
```
