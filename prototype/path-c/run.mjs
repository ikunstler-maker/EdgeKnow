// Path C prototype checks. The "central service" here is this script: it keeps the
// teams' connection details encrypted, migrates each team database, mints tokens
// with each team's key and checks what the team APIs accept.
//
// Usage (after setup.sh): node run.mjs

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { SignJWT, exportJWK, generateKeyPair, importJWK } from "jose";

const here = new URL(".", import.meta.url).pathname;
// A crash shows up as an annotation with the last step that passed.
const crash = (error) => {
  const message = String(error?.stack ?? error).split("\n").slice(0, 4).join(" ").slice(0, 800);
  console.log(`::error title=Prototype crashed::${message} — after: ${results.at(-1)?.name ?? "start"}`);
  process.exit(1);
};
process.on("unhandledRejection", crash);
process.on("uncaughtException", crash);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (name, detail) => {
  results.push({ name, ok: null, detail });
  console.log(`NOTE ${name} — ${detail}`);
};

// --- Central registry: connection details stored encrypted --------------------------------

const registryKey = randomBytes(32);
const seal = (value) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", registryKey, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
};
const open = (sealed) => {
  const raw = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", registryKey, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
};

const registry = new Map();
for (const team of ["team-a", "team-b"]) {
  const status = JSON.parse(readFileSync(`${here}work/${team}/status.json`, "utf8"));
  const [key] = JSON.parse(readFileSync(`${here}work/${team}/supabase/signing_keys.json`, "utf8"));
  registry.set(team, {
    apiUrl: status.API_URL,
    publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    sealed: seal({ dbUrl: status.DB_URL, secretKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, signingKey: key }),
  });
}
check("connection details stored only encrypted", [...registry.values()].every((t) => !t.sealed.includes("postgres") && !t.sealed.includes("sb_secret")));
const keyA = open(registry.get("team-a").sealed).signingKey;
const keyB = open(registry.get("team-b").sealed).signingKey;
check("each team has its own signing key", keyA.kid !== keyB.kid && keyA.d !== keyB.d);

// --- Migrations: every team database gets the same schema, once ---------------------------

const migrations = readdirSync(`${here}team-schema`).filter((f) => f.endsWith(".sql")).sort();
const psql = (dbUrl, args, input) =>
  execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-Atq", ...args], { encoding: "utf8", input, timeout: 20000 }).trim();

function migrate(dbUrl) {
  psql(dbUrl, ["-c", "create table if not exists public.edgeknow_migrations (name text primary key, applied_at timestamptz not null default now())"]);
  psql(dbUrl, ["-c", "revoke all on public.edgeknow_migrations from anon, authenticated"]);
  const done = new Set(psql(dbUrl, ["-c", "select name from public.edgeknow_migrations"]).split("\n").filter(Boolean));
  let applied = 0;
  for (const name of migrations) {
    if (done.has(name)) continue;
    // One transaction per migration: a failed one leaves the database as it was.
    const sql = readFileSync(`${here}team-schema/${name}`, "utf8");
    psql(dbUrl, ["-1", "-f", "-"], `${sql}\ninsert into public.edgeknow_migrations (name) values ('${name}');\n`);
    applied += 1;
  }
  return applied;
}

const migrationTargets = [
  ...[...registry].map(([team, t]) => [team, open(t.sealed).dbUrl]),
  ["broken-team", "postgresql://postgres:postgres@127.0.0.1:59999/postgres"],
];
const firstRun = migrationTargets.map(([team, dbUrl]) => {
  try {
    return [team, migrate(dbUrl)];
  } catch (error) {
    return [team, `error: ${String(error.message).split("\n")[0].slice(0, 120)}`];
  }
});
check("schema applied to every reachable team", firstRun[0][1] === migrations.length && firstRun[1][1] === migrations.length, JSON.stringify(firstRun));
check("an unreachable team is reported, the others still updated", String(firstRun[2][1]).startsWith("error"), String(firstRun[2][1]));
const secondRun = [...registry].map(([, t]) => migrate(open(t.sealed).dbUrl));
check("running again changes nothing", secondRun.every((n) => n === 0), JSON.stringify(secondRun));

// --- Tokens: minted centrally, checked by the team's own API ------------------------------

const alice = randomUUID();
const bob = randomUUID();
async function token(jwk, sub, { role = "authenticated", expiresIn = 600 } = {}) {
  const { key_ops: _ops, use: _use, ...signing } = jwk;
  const key = await importJWK(signing, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role, aal: "aal1", session_id: randomUUID() })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "JWT" })
    .setSubject(sub)
    .setAudience("authenticated")
    .setIssuer("https://central.edgeknow.test/auth")
    .setIssuedAt(now)
    .setExpirationTime(now + expiresIn)
    .sign(key);
}

async function rest(team, path, { bearer, method = "GET", body } = {}) {
  const t = registry.get(team);
  const response = await fetch(`${t.apiUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: t.publishableKey,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

const aliceA = await token(keyA, alice);
const bobA = await token(keyA, bob);
const write = await rest("team-a", "notes", { bearer: aliceA, method: "POST", body: { body: "Alice's note", title: "A" } });
check("team API accepts a token minted centrally with the team's key", write.status === 201, `${write.status} ${JSON.stringify(write.json).slice(0, 200)}`);
check("the database sees who wrote it (auth.uid() from the token)", write.json?.[0]?.owner === alice, JSON.stringify(write.json).slice(0, 200));
await rest("team-a", "notes", { bearer: bobA, method: "POST", body: { body: "Bob's note" } });
const aliceReads = await rest("team-a", "notes?select=owner,body", { bearer: aliceA });
check("RLS: each person reads only what the rules allow", aliceReads.status === 200 && aliceReads.json.length === 1 && aliceReads.json[0].owner === alice, JSON.stringify(aliceReads.json).slice(0, 200));
const forged = await rest("team-a", "notes", { bearer: aliceA, method: "POST", body: { body: "as Bob", owner: bob } });
check("RLS: writing in someone else's name is refused", forged.status >= 400, String(forged.status));

const aliceOnB = await rest("team-b", "notes", { bearer: aliceA });
check("team A's token is useless at team B", aliceOnB.status === 401, String(aliceOnB.status));
const { privateKey: strangerKey } = await generateKeyPair("ES256", { extractable: true });
const strangerJwk = { ...(await exportJWK(strangerKey)), kid: keyA.kid };
const forgedKey = await rest("team-a", "notes", { bearer: await token(strangerJwk, alice) });
check("a token signed with any other key is refused", forgedKey.status === 401, String(forgedKey.status));
const expired = await rest("team-a", "notes", { bearer: await token(keyA, alice, { expiresIn: -60 }) });
check("an expired token is refused", expired.status === 401, String(expired.status));
const anonymous = await rest("team-a", "notes");
check("without a token nothing is readable", anonymous.status >= 400 || (Array.isArray(anonymous.json) && anonymous.json.length === 0), `${anonymous.status} ${JSON.stringify(anonymous.json).slice(0, 120)}`);

// What holding the key means: the central service could mint an all-powerful token.
const godToken = await token(keyA, randomUUID(), { role: "service_role" });
const godRead = await rest("team-a", "notes?select=owner", { bearer: godToken });
note(
  "holding a team's signing key = full access to its database",
  `service_role token minted with the key: HTTP ${godRead.status}, ${Array.isArray(godRead.json) ? godRead.json.length : "?"} notes visible (RLS bypassed). The key must be guarded like the team's secret key.`,
);

// Option b for comparison: everything through the central server with the secret key.
const secretA = open(registry.get("team-a").sealed).secretKey;
const viaServer = await fetch(`${registry.get("team-a").apiUrl}/rest/v1/notes?select=owner`, {
  headers: { apikey: secretA, ...(secretA.startsWith("sb_") ? {} : { Authorization: `Bearer ${secretA}` }) },
});
const serverRows = await viaServer.json().catch(() => null);
note(
  "option b (all traffic through the central server)",
  `works (HTTP ${viaServer.status}, ${Array.isArray(serverRows) ? serverRows.length : "?"} notes) but sees everything: permissions would live only in our code, and every read goes through our hosting.`,
);

// --- Health: a team database that went away ------------------------------------------------

execFileSync("supabase", ["stop", "--no-backup"], { cwd: `${here}work/team-b`, stdio: "ignore" });
let health;
try {
  const response = await fetch(`${registry.get("team-b").apiUrl}/rest/v1/`, { signal: AbortSignal.timeout(3000) });
  health = `HTTP ${response.status}`;
} catch (error) {
  health = `unreachable (${error.name})`;
}
check("a stopped team database is detected quickly", health.startsWith("unreachable") || health.startsWith("HTTP 5"), health);
const stillA = await rest("team-a", "notes?select=body", { bearer: aliceA });
check("other teams keep working", stillA.status === 200, String(stillA.status));

// --- Report ----------------------------------------------------------------------------------

const failed = results.filter((r) => r.ok === false);
const lines = [
  "## Path C prototype",
  "",
  "| | Check | Detail |",
  "|---|---|---|",
  ...results.map((r) => `| ${r.ok === null ? "ℹ️" : r.ok ? "✅" : "❌"} | ${r.name} | ${String(r.detail).replace(/\|/g, "\\|")} |`),
  "",
  `${results.filter((r) => r.ok).length}/${results.filter((r) => r.ok !== null).length} checks passed`,
];
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
for (const f of failed) console.log(`::error title=Path C prototype::${f.name} — ${f.detail}`);
console.log(`::notice title=Path C prototype::${results.filter((r) => r.ok).length}/${results.filter((r) => r.ok !== null).length} checks passed`);
process.exit(failed.length ? 1 : 0);
