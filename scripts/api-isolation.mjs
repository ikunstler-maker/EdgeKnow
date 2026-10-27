// Proves workspace isolation with real HTTP requests against a local Supabase
// (`supabase start`): the same Auth, PostgREST and RLS as production.
//
// Usage: supabase status -o json > status.json && node scripts/api-isolation.mjs status.json
// Needs `psql` on PATH (to flip the registration switch like the platform admin would).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const status = JSON.parse(readFileSync(process.argv[2] ?? "status.json", "utf8"));
const API = status.API_URL;
const ANON = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const SERVICE = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
const DB_URL = status.DB_URL;
if (!API || !ANON || !SERVICE || !DB_URL) throw new Error(`Unexpected status keys: ${Object.keys(status)}`);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const sql = (query) => execFileSync("psql", [DB_URL, "-Atc", query], { encoding: "utf8" }).trim();

async function http(method, path, { token, body, key = ANON } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

const rest = (token, path) => http("GET", `/rest/v1/${path}`, { token });
const rpc = (token, fn, body = {}) => http("POST", `/rest/v1/rpc/${fn}`, { token, body });

async function createUser(email) {
  const res = await http("POST", "/auth/v1/admin/users", {
    key: SERVICE,
    body: { email, password: "Test-password-1!", email_confirm: true },
  });
  return res;
}

async function signIn(email) {
  const res = await http("POST", "/auth/v1/token?grant_type=password", {
    body: { email, password: "Test-password-1!" },
  });
  if (!res.json?.access_token) throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(res.json)}`);
  return res.json.access_token;
}

const isEmptyOrDenied = (res) => (res.status === 200 && Array.isArray(res.json) && res.json.length === 0) || res.status >= 400;
const denied = (res) => res.status === 200 && res.json?.ok === false && res.json?.error === "forbidden";

// --- Setup: two people, two workspaces ------------------------------------

// With registration closed the Before User Created hook refuses unknown accounts
// on the public sign-up path (the one Google sign-in uses to create accounts).
const refused = await http("POST", "/auth/v1/signup", {
  body: { email: "outsider@nowhere.test", password: "Test-password-1!" },
});
check(
  "closed registration: account for unknown domain refused by the hook",
  refused.status >= 400 && JSON.stringify(refused.json).includes("domain_not_allowed"),
  `HTTP ${refused.status} ${JSON.stringify(refused.json).slice(0, 120)}`,
);

sql("update public.platform_settings set open_registration = true");
for (const email of ["alice@alpha.test", "bob@beta.test", "stranger@gamma.test"]) {
  const res = await createUser(email);
  if (res.status >= 400) throw new Error(`Could not create ${email}: ${JSON.stringify(res.json)}`);
}
const alice = await signIn("alice@alpha.test");
const bob = await signIn("bob@beta.test");

const alphaRes = await rpc(alice, "create_workspace", { new_name: "Alpha" });
const alpha = alphaRes.json;
const beta = (await rpc(bob, "create_workspace", { new_name: "Beta" })).json;
await rpc(alice, "add_workspace_domain", { ws: alpha.id, new_domain: "alpha.test" });
const page = (await rpc(alice, "create_page", { ws: alpha.id, parent: null, new_title: "Alpha secret" })).json;
await rpc(alice, "invite_member", { ws: alpha.id, invitee_email: "friend@else.test", invitee_role: "member" });
sql("update public.platform_settings set open_registration = false");
const domainSignup = await http("POST", "/auth/v1/signup", {
  body: { email: "colleague@alpha.test", password: "Test-password-1!" },
});
check(
  "closed registration: account on an active workspace domain is allowed",
  domainSignup.status < 400,
  `HTTP ${domainSignup.status} ${JSON.stringify(domainSignup.json).slice(0, 120)}`,
);
check("setup: workspaces and page created", Boolean(alpha?.id && beta?.id && page?.id), JSON.stringify(alphaRes.json));

const stranger = await signIn("stranger@gamma.test");

// --- Positive control: Alice sees her own data ------------------------------

const alicePages = await rest(alice, "pages?select=id,title");
check("alice sees her page", alicePages.json?.length === 1 && alicePages.json[0].title === "Alpha secret");

// The exact queries the app makes (embedded profiles/workspaces) must work.
const appQueries = {
  "page with author": `pages?id=eq.${page.id}&select=id,workspace_id,title,icon,created_at,updated_at,deleted_at,trashed_with,my_role,author:profiles!pages_created_by_fkey(name,email)`,
  "sidebar tree": `pages?workspace_id=eq.${alpha.id}&deleted_at=is.null&select=id,parent_id,title,icon,position,owner_id,my_role,shared_with_workspace&order=position`,
  "members with profiles": `workspace_members?workspace_id=eq.${alpha.id}&status=eq.active&select=user_id,role,joined_via,profile:profiles!workspace_members_user_id_fkey(name,email)`,
  "audit log with actor": `audit_log?workspace_id=eq.${alpha.id}&select=id,action,details,created_at,actor:profiles(email)`,
  "legacy link lookup": `pages?id=eq.${page.id}&select=id,workspace:workspaces(short_id)`,
  "pending invitations": `invitations?workspace_id=eq.${alpha.id}&accepted_at=is.null&revoked_at=is.null&select=id,email,role,expires_at`,
};
for (const [name, path] of Object.entries(appQueries)) {
  const res = await rest(alice, path);
  check(`app query works: ${name}`, res.status === 200 && Array.isArray(res.json) && res.json.length > 0, `HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 160)}`);
}
const author = (await rest(alice, appQueries["page with author"])).json?.[0]?.author?.email;
check("page author recorded", author === "alice@alpha.test", String(author));

// --- Isolation: Bob (Beta) sees nothing of Alpha ----------------------------

const bobWorkspaces = await rest(bob, "workspaces?select=name");
check("bob lists only his workspace", JSON.stringify(bobWorkspaces.json) === JSON.stringify([{ name: "Beta" }]), JSON.stringify(bobWorkspaces.json));
const bobReads = {
  "all pages": "pages?select=id,title",
  "alpha page by id": `pages?id=eq.${page.id}&select=id,title`,
  "alpha workspace by id": `workspaces?id=eq.${alpha.id}&select=id`,
  "alpha members": `workspace_members?workspace_id=eq.${alpha.id}&select=user_id`,
  "alpha domains": `workspace_domains?workspace_id=eq.${alpha.id}&select=domain`,
  "alpha invitations": `invitations?workspace_id=eq.${alpha.id}&select=email`,
  "alpha audit log": `audit_log?workspace_id=eq.${alpha.id}&select=action`,
  "alice profile": "profiles?email=eq.alice@alpha.test&select=email",
};
for (const [name, path] of Object.entries(bobReads)) {
  const res = await rest(bob, path);
  check(`bob cannot read: ${name}`, isEmptyOrDenied(res), `HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 120)}`);
}

const bobActions = {
  "rename alpha page": ["rename_page", { target_page: page.id, new_title: "hacked" }],
  "create page in alpha": ["create_page", { ws: alpha.id, parent: null, new_title: "x" }],
  "invite himself to alpha": ["invite_member", { ws: alpha.id, invitee_email: "bob@beta.test", invitee_role: "admin" }],
  "add domain to alpha": ["add_workspace_domain", { ws: alpha.id, new_domain: "beta.test" }],
  "trash alpha page": ["trash_page", { target_page: page.id }],
  "delete alpha": ["delete_workspace", { ws: alpha.id, confirm_name: "Alpha" }],
  "rename alpha": ["rename_workspace", { ws: alpha.id, new_name: "Mine" }],
};
for (const [name, [fn, body]] of Object.entries(bobActions)) {
  const res = await rpc(bob, fn, body);
  check(`bob is refused: ${name}`, denied(res), `HTTP ${res.status} ${JSON.stringify(res.json)}`);
}
const role = await rpc(bob, "effective_role", { target_page: page.id });
check("bob has no role on alpha page", role.json === null, JSON.stringify(role.json));
const stats = await rpc(bob, "platform_workspaces");
check("bob (not platform admin) gets no statistics", Array.isArray(stats.json) && stats.json.length === 0, JSON.stringify(stats.json));

// Direct table writes, bypassing the functions.
const writes = [
  ["PATCH", `/rest/v1/pages?id=eq.${page.id}`, { title: "hacked" }],
  ["DELETE", `/rest/v1/pages?id=eq.${page.id}`, undefined],
  ["POST", "/rest/v1/workspace_members", { workspace_id: alpha.id, user_id: "00000000-0000-0000-0000-000000000000", joined_via: "invite" }],
  ["POST", "/rest/v1/pages", { workspace_id: alpha.id, owner_id: "00000000-0000-0000-0000-000000000000", title: "x" }],
  ["PATCH", "/rest/v1/platform_settings?id=eq.true", { open_registration: true }],
];
for (const [method, path, body] of writes) {
  const res = await http(method, path, { token: bob, body });
  check(`bob direct ${method} ${path.split("?")[0]} blocked`, res.status >= 400 || (Array.isArray(res.json) && res.json.length === 0), `HTTP ${res.status}`);
}
const titleAfter = (await rest(alice, `pages?id=eq.${page.id}&select=title`)).json?.[0]?.title;
check("alpha page unchanged after bob's attempts", titleAfter === "Alpha secret", String(titleAfter));
const logged = sql(`select count(*) from public.audit_log where workspace_id = '${alpha.id}' and action = 'access_denied'`);
// Workspace management attempts (invite, add domain, delete, rename) are logged; page actions are not.
check("bob's attempts are in alpha's audit log", Number(logged) === 4, `${logged} entries`);

// --- Page access inside a workspace (stage 5) --------------------------------

const colleague = await signIn("colleague@alpha.test");
await rpc(colleague, "join_workspaces");
const colleagueId = (await rest(colleague, "profiles?email=eq.colleague@alpha.test&select=id")).json?.[0]?.id;
const before = await rest(colleague, `pages?id=eq.${page.id}&select=id`);
check("colleague doesn't see a private page", isEmptyOrDenied(before), JSON.stringify(before.json));
const shareCommenter = await rpc(alice, "set_page_member_role", { target_page: page.id, member: colleagueId, new_role: "commenter" });
check("alice shares the page with a colleague as commenter", shareCommenter.json?.ok === true, JSON.stringify(shareCommenter.json));
const sharedRow = (await rest(colleague, `pages?id=eq.${page.id}&select=id,my_role`)).json?.[0];
check("colleague now reads the page as commenter", sharedRow?.my_role === "commenter", JSON.stringify(sharedRow));
const commenterSave = await rpc(colleague, "save_page_content", { target_page: page.id, new_content: [], base_version: 1, force: true });
check("commenter cannot save the text", denied(commenterSave), JSON.stringify(commenterSave.json));
const commenterRename = await rpc(colleague, "rename_page", { target_page: page.id, new_title: "edited" });
check("commenter cannot rename", denied(commenterRename), JSON.stringify(commenterRename.json));
const commenterShare = await rpc(colleague, "set_page_member_role", { target_page: page.id, member: colleagueId, new_role: "editor" });
check("commenter cannot raise their own role", denied(commenterShare), JSON.stringify(commenterShare.json));
for (const [method, path, body] of [
  ["PATCH", `/rest/v1/pages?id=eq.${page.id}`, { content: [] }],
  ["POST", "/rest/v1/page_access", { workspace_id: alpha.id, page_id: page.id, user_id: colleagueId, role: "editor" }],
  ["PATCH", `/rest/v1/page_access?page_id=eq.${page.id}`, { role: "editor" }],
]) {
  const res = await http(method, path, { token: colleague, body });
  check(`commenter direct ${method} ${path.split("?")[0]} blocked`, res.status >= 400 || (Array.isArray(res.json) && res.json.length === 0), `HTTP ${res.status}`);
}
const stillCommenter = (await rest(colleague, `pages?id=eq.${page.id}&select=my_role`)).json?.[0]?.my_role;
check("colleague is still only a commenter", stillCommenter === "commenter", String(stillCommenter));
const bobId = sql("select id from auth.users where email = 'bob@beta.test'");
const crossShare = await rpc(alice, "set_page_member_role", { target_page: page.id, member: bobId, new_role: "viewer" });
check("sharing with someone from another workspace is refused", crossShare.json?.error === "not_a_member", JSON.stringify(crossShare.json));
const bobGrants = await rest(bob, "page_access?select=page_id");
check("bob cannot read alpha's grants", isEmptyOrDenied(bobGrants), JSON.stringify(bobGrants.json));
const bobSharing = await rpc(bob, "page_sharing", { target_page: page.id });
check("bob gets no sharing info for alpha's page", denied(bobSharing), JSON.stringify(bobSharing.json));

// --- Comments (stage 6) -------------------------------------------------------

const thread = (await rpc(alice, "create_comment_thread", { target_page: page.id, quoted: "Alpha", body: "Secret remark", mention_ids: [] })).json;
check("alice starts a comment thread", thread?.ok === true, JSON.stringify(thread));
const colleagueThreads = await rest(colleague, `comment_threads?page_id=eq.${page.id}&select=id,comments(body)`);
check("colleague with access reads the thread", colleagueThreads.json?.[0]?.comments?.[0]?.body === "Secret remark", JSON.stringify(colleagueThreads.json));
for (const path of ["comment_threads?select=id,quoted_text", "comments?select=id,body"]) {
  const res = await rest(bob, path);
  check(`bob cannot read alpha ${path.split("?")[0]}`, isEmptyOrDenied(res), JSON.stringify(res.json));
}
const bobReply = await rpc(bob, "reply_to_thread", { target_thread: thread.id, body: "hi", mention_ids: [] });
check("bob cannot reply in alpha", denied(bobReply), JSON.stringify(bobReply.json));
const bobResolve = await rpc(bob, "set_thread_resolved", { target_thread: thread.id, resolved: true });
check("bob cannot resolve alpha's thread", denied(bobResolve), JSON.stringify(bobResolve.json));
for (const [method, path, body] of [
  ["POST", "/rest/v1/comments", { workspace_id: alpha.id, thread_id: thread.id, author_id: colleagueId, body: "forged" }],
  ["PATCH", `/rest/v1/comments?thread_id=eq.${thread.id}`, { body: "edited" }],
  ["PATCH", `/rest/v1/comment_threads?id=eq.${thread.id}`, { status: "resolved" }],
]) {
  const res = await http(method, path, { token: colleague, body });
  check(`colleague direct ${method} ${path.split("?")[0]} blocked`, res.status >= 400 || (Array.isArray(res.json) && res.json.length === 0), `HTTP ${res.status}`);
}
const bodyAfter = sql(`select string_agg(body, ',') from public.comments where thread_id = '${thread.id}'`);
check("alpha comment unchanged", bodyAfter === "Secret remark", bodyAfter);

// --- No workspace / no account ----------------------------------------------

const strangerAccess = await rpc(stranger, "has_platform_access");
check("stranger without workspace has no access", strangerAccess.json === false, JSON.stringify(strangerAccess.json));
const strangerPages = await rest(stranger, "pages?select=id");
check("stranger sees no pages", isEmptyOrDenied(strangerPages), `HTTP ${strangerPages.status}`);
const strangerCreate = await rpc(stranger, "create_workspace", { new_name: "Mine" });
check("stranger cannot create a workspace while registration is closed", denied(strangerCreate), JSON.stringify(strangerCreate.json));

for (const path of ["pages?select=id", "workspaces?select=id", "profiles?select=email", "workspace_members?select=user_id", "page_access?select=id", "comments?select=id"]) {
  const res = await http("GET", `/rest/v1/${path}`);
  check(`anonymous cannot read ${path.split("?")[0]}`, isEmptyOrDenied(res), `HTTP ${res.status}`);
}

// --- Summary ------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`::error title=API isolation::${f.name} — ${f.detail}`);
console.log(`::notice title=API isolation::${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
