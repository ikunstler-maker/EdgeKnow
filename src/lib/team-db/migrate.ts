// Bringing every team database to the current schema (path C).
//
// The team migrations (supabase/team/migrations) run in name order, each in its
// own transaction, and are recorded in public.edgeknow_migrations in the team
// database, so each one runs exactly once there. One team failing doesn't stop
// the others: its error is reported and it is tried again next time.
//
// Kept free of app imports so CI can run it directly with Node.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

export type TeamMigration = { name: string; sql: string };

// How a team database is reached. Postgres for a connection string; the
// Supabase Management API (step 1.5) will be another one.
export type TeamExecutor = {
  applied(): Promise<Set<string>>;
  apply(migration: TeamMigration): Promise<void>;
  close?(): Promise<void>;
};

export type TeamMigrationResult = { team: string; applied: string[]; error?: string };

export function loadTeamMigrations(dir = path.join(process.cwd(), "supabase/team/migrations")): TeamMigration[] {
  return readdirSync(dir)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => ({ name: name.replace(/\.sql$/, ""), sql: readFileSync(path.join(dir, name), "utf8") }));
}

export async function migrateTeam(executor: TeamExecutor, migrations: TeamMigration[]): Promise<string[]> {
  const done = await executor.applied();
  const applied: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.name)) continue;
    await executor.apply(migration);
    applied.push(migration.name);
  }
  return applied;
}

export async function migrateTeams(
  teams: { team: string; executor: () => TeamExecutor }[],
  migrations: TeamMigration[],
): Promise<TeamMigrationResult[]> {
  const results: TeamMigrationResult[] = [];
  for (const { team, executor: open } of teams) {
    let executor: TeamExecutor | null = null;
    try {
      executor = open();
      results.push({ team, applied: await migrateTeam(executor, migrations) });
    } catch (error) {
      results.push({ team, applied: [], error: String((error as Error)?.message ?? error).split("\n")[0].slice(0, 300) });
    } finally {
      await executor?.close?.().catch(() => {});
    }
  }
  return results;
}

const TRACKING = `create table if not exists public.edgeknow_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
revoke all on public.edgeknow_migrations from anon, authenticated;`;

export function postgresExecutor(connectionString: string): TeamExecutor {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000, statement_timeout: 120_000 });
  let connected: Promise<void> | null = null;
  const ready = () => (connected ??= client.connect().then(() => client.query(TRACKING)).then(() => undefined));
  return {
    async applied() {
      await ready();
      const { rows } = await client.query<{ name: string }>("select name from public.edgeknow_migrations");
      return new Set(rows.map((row) => row.name));
    },
    async apply(migration) {
      await ready();
      // A failed migration leaves the database as it was.
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query("insert into public.edgeknow_migrations (name) values ($1)", [migration.name]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw new Error(`${migration.name}: ${(error as Error).message}`);
      }
      // A migration may change the session (search_path); start the next one clean,
      // and make the team's API see new functions and tables right away.
      await client.query("reset all");
      await client.query("notify pgrst, 'reload schema'");
    },
    async close() {
      await client.end();
    },
  };
}
