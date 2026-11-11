// Path C against two real local Supabase stacks (scripts/team-stacks.sh): the team
// schema reaches each database exactly once, the central copy of members works,
// and with one EdgeKnow key trusted by every team, people still see only their
// own team's pages.
//
// Usage: node --experimental-strip-types scripts/team-isolation.mjs [.team-stacks]

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { SignJWT, importJWK } from "jose";
import { loadTeamMigrations, migrateTeams, postgresExecutor } from "../src/lib/team-db/migrate.ts";

const work = process.argv[2] ?? ".team-stacks";
const ISSUER = "https://wiki.test/oidc";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
process.on("unhandledRejection", (error) => {
  console.log(`::error title=Team isolation crashed::${String(error?.stack ?? error).split("\n").slice(0, 3).join(" ")} — after: ${results.at(-1)?.name ?? "start"}`);
  process.exit(1);
});

const team = (name) => {
  const status = JSON.parse(readFileSync(`${work}/${name}/status.json`, "utf8"));
  const [key] = JSON.parse(readFileSync(`${work}/${name}/supabase/signing_keys.json`, "utf8"));
  return { name, api: status.API_URL, db: status.DB_URL, publishable: status.PUBLISHABLE_KEY ?? status.ANON_KEY, secret: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, key };
};
const A = team("team-a");
const B = team("team-b");

// --- Schema: every team, exactly once -----------------------------------------------------

const migrations = loadTeamMigrations();
const targets = [
  { team: "a", executor: () => postgresExecutor(A.db) },
  { team: "b", executor: () => postgresExecutor(B.db) },
  { team: "unreachable", executor: () => postgresExecutor("postgresql://postgres:postgres@127.0.0.1:59999/postgres") },
];
const first = await migrateTeams(targets, migrations);
check("team schema applied to both teams", first[0].applied.length === migrations.length && first[1].applied.length === migrations.length, JSON.stringify(first.slice(0, 2)));
check("an unreachable team is reported, the others still updated", Boolean(first[2].error), first[2].error ?? "");
const second = await migrateTeams(targets.slice(0, 2), migrations);
check("running again applies nothing", second.every((r) => r.applied.length === 0 && !r.error), JSON.stringify(second));

// --- Tokens the way the central service mints them ----------------------------------------

// In the cloud every team trusts the same EdgeKnow key; here team A's key plays it.
// Like the real ones, each token is for one workspace (ek_workspace); null: none at all.
async function token(t, sub, email, role = "authenticated", workspace = t === A ? wsA : wsB) {
  const { kty, crv, x, y, d, kid } = t.key;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role, email, ...(workspace ? { ek_workspace: workspace } : {}) })
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setIssuer(ISSUER)
    .setSubject(sub)
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .sign(await importJWK({ kty, crv, x, y, d }, "ES256"));
}

async function rpc(t, fn, body, bearer, apikey = t.publishable) {
  const response = await fetch(`${t.api}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}
async function select(t, path, bearer) {
  const response = await fetch(`${t.api}/rest/v1/${path}`, {
    headers: { apikey: t.publishable, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

// --- Members copied from the central service ----------------------------------------------

const alice = { id: randomUUID(), email: "alice@a.test", name: "Alice" };
const bob = { id: randomUUID(), email: "bob@a.test", name: "Bob" };
const eve = { id: randomUUID(), email: "eve@b.test", name: "Eve" };
const wsA = randomUUID();
const wsB = randomUUID();
const payload = (ws, shortId, owner, people) => ({
  payload: {
    workspace: { id: ws, short_id: shortId, name: shortId, owner_id: owner.id },
    settings: { issuer: ISSUER, files_on_drive: false },
    profiles: people,
    members: people.map((p) => ({ user_id: p.id, role: p === owner ? "owner" : "member", joined_via: p === owner ? "creator" : "domain" })),
  },
});

// The API reloads its schema in the background after migrations; wait for it.
for (const t of [A, B]) {
  for (let i = 0; i < 40; i++) {
    const probe = await rpc(t, "team_sync", { payload: {} }, t.secret, t.secret);
    if (probe.status !== 404) break;
    await new Promise((r) => setTimeout(r, 500));
  }
}
const anonSync = await rpc(A, "team_sync", payload(wsA, "teama001", alice, [alice, bob]));
check("only the secret key may sync members", anonSync.status === 401 || anonSync.status === 403 || anonSync.status === 404, String(anonSync.status));
const syncA = await rpc(A, "team_sync", payload(wsA, "teama001", alice, [alice, bob]), A.secret, A.secret);
const syncB = await rpc(B, "team_sync", payload(wsB, "teamb001", eve, [eve]), B.secret, B.secret);
check("members synced into each team", syncA.json?.ok === true && syncB.json?.ok === true, `${syncA.status} ${JSON.stringify(syncA.json)} / ${syncB.status} ${JSON.stringify(syncB.json)}`);

// --- Pages and access ---------------------------------------------------------------------

const aliceA = await token(A, alice.id, alice.email);
const created = await rpc(A, "create_page", { ws: wsA, parent: null, new_title: "Team A handbook" }, aliceA);
check("a member creates a page in their team database", created.json?.ok === true, JSON.stringify(created.json));
const pageId = created.json?.id;
const shared = await rpc(A, "set_page_workspace_role", { target_page: pageId, new_role: "viewer" }, aliceA);
const bobA = await token(A, bob.id, bob.email);
const bobReadsDraft = await select(A, "pages?select=title", bobA);
check("a new page is a draft: a colleague doesn't see it yet", shared.json?.ok === true && bobReadsDraft.json?.length === 0, JSON.stringify(bobReadsDraft.json));
const bobPublishes = await rpc(A, "publish_page", { target_page: pageId, with_children: true }, bobA);
check("…nor can publish it", bobPublishes.json?.error === "forbidden", JSON.stringify(bobPublishes.json));
const published = await rpc(A, "publish_page", { target_page: pageId, with_children: true }, aliceA);
const bobReads = await select(A, "pages?select=title", bobA);
check("a colleague reads the shared page once it is published", published.json?.ok === true && bobReads.json?.length === 1, JSON.stringify(bobReads.json));

// Eve's token is genuine (same EdgeKnow key) but she isn't in team A.
const eveWithOurKey = await token(A, eve.id, eve.email);
const eveReads = await select(A, "pages?select=title", eveWithOurKey);
const eveCreates = await rpc(A, "create_page", { ws: wsA, parent: null, new_title: "Intruder" }, eveWithOurKey);
check("a genuine token of someone outside the team sees nothing", eveReads.status === 200 && eveReads.json?.length === 0, JSON.stringify(eveReads.json));
check("…and can't create anything", eveCreates.json?.ok === false, JSON.stringify(eveCreates.json));
const eveMembers = await select(A, "workspace_members?select=user_id", eveWithOurKey);
check("…nor list the team's members", eveMembers.json?.length === 0, JSON.stringify(eveMembers.json));

const crossKey = await select(B, "pages?select=title", aliceA);
check("a token signed with a key team B doesn't trust is refused", crossKey.status === 401, String(crossKey.status));
const anonymous = await select(A, "pages?select=title");
check("without a token nothing is readable", anonymous.status >= 400 || anonymous.json?.length === 0, `${anonymous.status} ${JSON.stringify(anonymous.json)}`);
const settings = await select(A, "team_settings?select=issuer", aliceA);
check("team settings aren't readable by people", settings.status >= 400, String(settings.status));

// The guard: even with our key, a token can't act as an admin role.
const adminToken = await token(A, alice.id, alice.email, "service_role");
const asAdmin = await select(A, "pages?select=title", adminToken);
check("an admin-role token from EdgeKnow is refused", asAdmin.status === 403, `${asAdmin.status} ${JSON.stringify(asAdmin.json)}`);

// --- Removed centrally → gone here ---------------------------------------------------------

const resync = await rpc(A, "team_sync", payload(wsA, "teama001", alice, [alice]), A.secret, A.secret);
const bobAfter = await select(A, "pages?select=title", bobA);
check("someone removed centrally loses access at the next sync", resync.json?.ok === true && bobAfter.json?.length === 0, JSON.stringify(bobAfter.json));
const otherWorkspace = await rpc(A, "team_sync", payload(wsB, "teamb001", eve, [eve]), A.secret, A.secret);
check("a team database refuses a second workspace", otherWorkspace.json?.error === "other_workspace", JSON.stringify(otherWorkspace.json));

// --- A token works only in the database of its own workspace -------------------------------
// Bob is in both teams. A token given for team A, seen by team A's owner, is sent to team B's
// database — signed with the key team B trusts, as in the cloud where every team trusts EdgeKnow.
const bothB = await rpc(B, "team_sync", payload(wsB, "teamb001", eve, [eve, bob]), B.secret, B.secret);
const forB = await select(B, "workspace_members?select=user_id", await token(B, bob.id, bob.email, "authenticated", wsB));
check("someone in both teams uses team B with a token for team B", bothB.json?.ok === true && forB.status === 200 && forB.json?.length > 0, `${forB.status} ${JSON.stringify(forB.json)}`);
const replayed = await select(B, "workspace_members?select=user_id", await token(B, bob.id, bob.email, "authenticated", wsA));
check("…but a token given for team A is refused in team B's database", replayed.status === 403, `${replayed.status} ${JSON.stringify(replayed.json)}`);
const unbound = await select(B, "workspace_members?select=user_id", await token(B, bob.id, bob.email, "authenticated", null));
check("…and so is a token for no workspace at all", unbound.status === 403, `${unbound.status} ${JSON.stringify(unbound.json)}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`::error title=Team isolation::${f.name} — ${f.detail}`);
console.log(`::notice title=Team isolation::${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
