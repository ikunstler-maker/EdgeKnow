// CI helper (path C): creates the "Gamma" workspace for alice in the central
// database, gives it the team database from scripts/team-stacks.sh and brings
// that database to the current schema. The app then syncs members on first use.
//
// Usage: DRIVE_TOKEN_KEY=… node --experimental-strip-types scripts/register-team.mjs status.json .team-stacks/team-b/status.json

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadTeamMigrations, migrateTeams, postgresExecutor } from "../src/lib/team-db/migrate.ts";

const central = JSON.parse(readFileSync(process.argv[2], "utf8"));
const team = JSON.parse(readFileSync(process.argv[3], "utf8"));
const sql = (query) => execFileSync("psql", [central.DB_URL, "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();

// Same format as src/lib/drive/secret-box.ts.
const encrypt = (text) => {
  const key = createHash("sha256").update(`encrypt:${process.env.DRIVE_TOKEN_KEY}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
};
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const [result] = await migrateTeams([{ team: "gamma", executor: () => postgresExecutor(team.DB_URL) }], loadTeamMigrations());
if (result.error) throw new Error(`team migrations failed: ${result.error}`);

const alice = sql("select id from public.profiles where email = 'alice@alpha.test'");
const ws = sql(`insert into public.workspaces (name, owner_id, created_by) values ('Gamma', '${alice}', '${alice}') returning id`).split("\n")[0];
sql(`insert into public.workspace_members (workspace_id, user_id, role, joined_via) values ('${ws}', '${alice}', 'owner', 'creator')`);
sql(`insert into public.team_databases (workspace_id, project_url, publishable_key, secret_key_encrypted, db_url_encrypted, status)
     values ('${ws}', ${quote(team.API_URL)}, ${quote(team.PUBLISHABLE_KEY ?? team.ANON_KEY)}, ${quote(encrypt(team.SECRET_KEY ?? team.SERVICE_ROLE_KEY))}, ${quote(encrypt(team.DB_URL))}, 'ok')`);
console.log(`Gamma ${sql(`select short_id from public.workspaces where id = '${ws}'`)} → ${team.API_URL} (${result.applied.length} migrations)`);
