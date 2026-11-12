import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { numberOfKey, parseComments, parseField, parseFiles, parseGrant, parseIssue, parseMoves, parseWorklogs, parseStatus, parseType, parseUser, type TrackerActivity, type TrackerField, type TrackerFile, type TrackerGroup, type TrackerIssue, type TrackerRole, type TrackerScheme, type TrackerStatus, type TrackerType, type TrackerUser } from "@/lib/tracker-convert";

// Reading another tracker (Rukh Р-3а): the cloud tracker's own API, called only from
// the server with the person's access key. Nothing is ever written to the tracker.
export type TrackerAccess = { site: string; account: string; token: string };
export type TrackerProject = { key: string; name: string; types: TrackerType[] };
export type IssuePage = { issues: TrackerIssue[]; next: string | null };

// What went wrong, in words the wizard can show.
export class TrackerError extends Error {
  constructor(public code: "auth" | "not_found" | "rate_limited" | "unreachable" | "bad_answer") {
    super(code);
  }
}

export interface TrackerApi {
  me(access: TrackerAccess): Promise<TrackerUser>;
  project(access: TrackerAccess, key: string): Promise<TrackerProject>;
  statuses(access: TrackerAccess, key: string): Promise<TrackerStatus[]>;
  priorities(access: TrackerAccess): Promise<string[]>;
  fields(access: TrackerAccess): Promise<TrackerField[]>;
  users(access: TrackerAccess, key: string): Promise<TrackerUser[]>;
  // The project's roles with the people who hold each directly (members of a group that
  // holds a role are not listed by the tracker here).
  roles(access: TrackerAccess, key: string): Promise<TrackerRole[]>;
  // The project's permission scheme with the groups it names (and those its roles hold).
  scheme(access: TrackerAccess, key: string, roles: TrackerRole[]): Promise<TrackerScheme>;
  count(access: TrackerAccess, key: string, since?: string | null): Promise<number>;
  lastNumber(access: TrackerAccess, key: string): Promise<number>;
  // Issues in the order of their keys; `fields`: custom field ids to bring along.
  issues(access: TrackerAccess, key: string, cursor: string | null, size: number, fields: string[], since?: string | null): Promise<IssuePage>;
  // The files attached to the same tasks, and one file's bytes from `offset` on
  // (`ranged` false: the tracker sent the whole file, the caller skips what it has).
  files(access: TrackerAccess, key: string, cursor: string | null, size: number, since?: string | null): Promise<{ items: { key: string; files: TrackerFile[] }[]; next: string | null }>;
  fileStream(access: TrackerAccess, id: string, offset: number): Promise<{ body: ReadableStream<Uint8Array>; ranged: boolean }>;
  // The same tasks, page by page, with their comments and status changes.
  activity(access: TrackerAccess, key: string, cursor: string | null, size: number, since?: string | null): Promise<{ items: TrackerActivity[]; next: string | null }>;
}

const BASE_FIELDS = ["summary", "description", "status", "issuetype", "priority", "assignee", "reporter", "creator", "security", "labels", "duedate", "timeoriginalestimate", "created", "updated", "resolutiondate", "parent", "issuelinks"];

async function call(access: TrackerAccess, path: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${access.site}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${access.account}:${access.token}`).toString("base64")}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // The key never follows a redirect to another address.
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new TrackerError("unreachable");
  }
  if (response.status === 401 || response.status === 403) throw new TrackerError("auth");
  if (response.status === 404) throw new TrackerError("not_found");
  if (response.status === 429) throw new TrackerError("rate_limited");
  if (!response.ok) throw new TrackerError("unreachable");
  try {
    return await response.json();
  } catch {
    throw new TrackerError("bad_answer");
  }
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
// `since`: only what changed in the tracker from the day before that moment on (the
// tracker compares dates in the asker's own time zone; a day's margin costs nothing, as a
// task that comes twice is changed, not doubled).
const dayBefore = (since: string) => new Date(Date.parse(since) - 86_400_000).toISOString().slice(0, 10);
const jql = (key: string, order: "ASC" | "DESC", since?: string | null) =>
  `project = "${key}"${since && !Number.isNaN(Date.parse(since)) ? ` AND updated >= "${dayBefore(since)}"` : ""} ORDER BY key ${order}`;

const cloud: TrackerApi = {
  async me(access) {
    const user = parseUser(await call(access, "/rest/api/3/myself"));
    if (!user) throw new TrackerError("bad_answer");
    return user;
  },
  async project(access, key) {
    const project = obj(await call(access, `/rest/api/3/project/${encodeURIComponent(key)}`));
    if (typeof project.key !== "string") throw new TrackerError("bad_answer");
    return { key: project.key, name: String(project.name ?? project.key), types: list(project.issueTypes).flatMap((t) => parseType(t) ?? []) };
  },
  async statuses(access, key) {
    const seen = new Map<string, TrackerStatus>();
    for (const type of list(await call(access, `/rest/api/3/project/${encodeURIComponent(key)}/statuses`))) {
      for (const raw of list(obj(type).statuses)) {
        const status = parseStatus(raw);
        if (status && !seen.has(status.id)) seen.set(status.id, status);
      }
    }
    // Columns in the order of work: to do, in progress, done.
    const rank = { todo: 0, doing: 1, review: 2, done: 3 };
    return [...seen.values()].sort((a, b) => rank[a.category] - rank[b.category]);
  },
  async priorities(access) {
    return list(await call(access, "/rest/api/3/priority")).flatMap((p) => (typeof obj(p).name === "string" ? [String(obj(p).name)] : []));
  },
  async fields(access) {
    return list(await call(access, "/rest/api/3/field")).flatMap((f) => parseField(f) ?? []);
  },
  async users(access, key) {
    const users = new Map<string, TrackerUser>();
    for (let at = 0; at < 1000; at += 200) {
      const page = list(await call(access, `/rest/api/3/user/assignable/search?project=${encodeURIComponent(key)}&startAt=${at}&maxResults=200`));
      for (const raw of page) {
        const user = parseUser(raw);
        if (user) users.set(user.id, user);
      }
      if (page.length < 200) break;
    }
    return [...users.values()].sort((a, b) => a.name.localeCompare(b.name));
  },
  async roles(access, key) {
    const index = obj(await call(access, `/rest/api/3/project/${encodeURIComponent(key)}/role`));
    const roles: TrackerRole[] = [];
    for (const [name, link] of Object.entries(index).slice(0, 30)) {
      const id = /\/role\/(\d+)$/.exec(String(link))?.[1];
      if (!id) continue;
      const role = obj(await call(access, `/rest/api/3/project/${encodeURIComponent(key)}/role/${id}`));
      const users = list(role.actors).flatMap((actor) => {
        const account = obj(obj(actor).actorUser).accountId;
        return typeof account === "string" && account ? [account] : [];
      });
      const groups = list(role.actors).flatMap((actor) => {
        const group = obj(obj(actor).actorGroup).groupId;
        return typeof group === "string" && group ? [group] : [];
      });
      roles.push({ name: name.slice(0, 120), users, groups });
    }
    return roles;
  },
  async scheme(access, key, roles) {
    const raw = obj(await call(access, `/rest/api/3/project/${encodeURIComponent(key)}/permissionscheme?expand=permissions,group,projectRole,user`));
    const grants = list(raw.permissions).flatMap((g) => parseGrant(g) ?? []).slice(0, 2000);
    const named = new Map<string, string>();
    for (const grant of grants) if (grant.holder.type === "group") named.set(grant.holder.id, grant.holder.name);
    for (const role of roles) for (const id of role.groups ?? []) if (!named.has(id)) named.set(id, id);
    const groups: TrackerGroup[] = [];
    for (const [id, name] of [...named].slice(0, 30)) {
      const group: TrackerGroup = { id, name, users: [] };
      try {
        for (let at = 0; at < 500; at += 50) {
          const page = obj(await call(access, `/rest/api/3/group/member?groupId=${encodeURIComponent(id)}&startAt=${at}&maxResults=50`));
          for (const raw of list(page.values)) {
            const user = parseUser(raw);
            if (user) group.users.push(user.id);
          }
          if (page.isLast !== false || list(page.values).length === 0) break;
        }
        // A group known only by its id (held through a role): its name comes with a search.
        if (name === id) {
          const found = list(obj(await call(access, `/rest/api/3/group/bulk?groupId=${encodeURIComponent(id)}`)).values)[0];
          if (typeof obj(found).name === "string") group.name = String(obj(found).name).slice(0, 120);
        }
      } catch (error) {
        // The key may read the scheme yet not the site's groups: the group stays, without people.
        if (error instanceof TrackerError && error.code === "rate_limited") throw error;
        group.unread = true;
      }
      groups.push(group);
    }
    return { name: String(raw.name ?? "").slice(0, 120), grants, groups };
  },
  async count(access, key, since) {
    return Number(obj(await call(access, "/rest/api/3/search/approximate-count", { jql: jql(key, "ASC", since).replace(/ ORDER BY.*$/, "") })).count) || 0;
  },
  async lastNumber(access, key) {
    const page = obj(await call(access, "/rest/api/3/search/jql", { jql: jql(key, "DESC"), maxResults: 1, fields: ["summary"] }));
    return numberOfKey(String(obj(list(page.issues)[0]).key ?? "")) ?? 0;
  },
  async issues(access, key, cursor, size, fields, since) {
    const page = obj(
      await call(access, "/rest/api/3/search/jql", { jql: jql(key, "ASC", since), maxResults: size, fields: [...BASE_FIELDS, ...fields], ...(cursor ? { nextPageToken: cursor } : {}) }),
    );
    return {
      issues: list(page.issues).flatMap((raw) => parseIssue(raw, access.site) ?? []),
      next: typeof page.nextPageToken === "string" && page.nextPageToken ? page.nextPageToken : null,
    };
  },
  async files(access, key, cursor, size, since) {
    const page = obj(await call(access, "/rest/api/3/search/jql", { jql: jql(key, "ASC", since), maxResults: size, fields: ["attachment"], ...(cursor ? { nextPageToken: cursor } : {}) }));
    return {
      items: list(page.issues).flatMap((raw) => {
        const files = parseFiles(obj(obj(raw).fields).attachment);
        return files.length && typeof obj(raw).key === "string" ? [{ key: String(obj(raw).key), files }] : [];
      }),
      next: typeof page.nextPageToken === "string" && page.nextPageToken ? page.nextPageToken : null,
    };
  },
  async fileStream(access, id, offset) {
    const range: Record<string, string> = offset > 0 ? { Range: `bytes=${offset}-` } : {};
    let response: Response;
    try {
      // The tracker answers with the file or sends us on to where it is kept. The key
      // goes only to the tracker itself, never along to that other address.
      response = await fetch(`${access.site}/rest/api/3/attachment/content/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${access.account}:${access.token}`).toString("base64")}`, ...range },
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      if (response.status >= 300 && response.status < 400) {
        const next = new URL(response.headers.get("location") ?? "", access.site);
        if (next.protocol !== "https:" || /^(localhost|[\d.]+|\[.*\])$/.test(next.hostname)) throw new TrackerError("bad_answer");
        response = await fetch(next, { headers: range, redirect: "follow", cache: "no-store" });
      }
    } catch (error) {
      throw error instanceof TrackerError ? error : new TrackerError("unreachable");
    }
    if (response.status === 401 || response.status === 403) throw new TrackerError("auth");
    if (response.status === 404) throw new TrackerError("not_found");
    if (!response.ok || !response.body) throw new TrackerError("unreachable");
    return { body: response.body, ranged: response.status === 206 };
  },
  async activity(access, key, cursor, size, since) {
    const page = obj(await call(access, "/rest/api/3/search/jql", { jql: jql(key, "ASC", since), maxResults: size, fields: ["comment", "worklog"], expand: "changelog", ...(cursor ? { nextPageToken: cursor } : {}) }));
    const items: TrackerActivity[] = [];
    for (const raw of list(page.issues)) {
      const issue = obj(raw);
      const issueKey = String(issue.key ?? "");
      if (!issueKey) continue;
      // The search gives the first comments and history entries; long ones are read in full.
      const rest = async (kind: "comment" | "changelog" | "worklog", listKey: "comments" | "values" | "worklogs") => {
        const all: unknown[] = [];
        for (let at = 0; at < 1000; at += 100) {
          const part = obj(await call(access, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/${kind}?startAt=${at}&maxResults=100`));
          const got = list(part[listKey]);
          all.push(...got);
          if (got.length < 100) break;
        }
        return all;
      };
      const comment = obj(obj(issue.fields).comment);
      const changelog = obj(issue.changelog);
      const comments = Number(comment.total ?? 0) > list(comment.comments).length ? await rest("comment", "comments") : list(comment.comments);
      const histories = !Array.isArray(changelog.histories) || Number(changelog.total ?? 0) > list(changelog.histories).length ? await rest("changelog", "values") : list(changelog.histories);
      const worklog = obj(obj(issue.fields).worklog);
      const worklogs = Number(worklog.total ?? 0) > list(worklog.worklogs).length ? await rest("worklog", "worklogs") : list(worklog.worklogs);
      items.push({ key: issueKey, comments: parseComments(comments), moves: parseMoves(histories), worklogs: parseWorklogs(worklogs) });
    }
    return { items, next: typeof page.nextPageToken === "string" && page.nextPageToken ? page.nextPageToken : null };
  },
};

// For the automatic tests: a tracker read from a file (never on the live site).
function fake(dir: string): TrackerApi {
  const read = (access: TrackerAccess) => {
    const data = JSON.parse(readFileSync(join(dir, "tracker.json"), "utf8")) as Record<string, unknown>;
    if (access.token !== data.token) throw new TrackerError("auth");
    return data;
  };
  const project = (access: TrackerAccess, key: string) => {
    const found = obj(read(access).project);
    if (found.key !== key) throw new TrackerError("not_found");
    return found;
  };
  // What changed since a moment (the stand-in compares exactly, without the day's margin).
  const changed = (raw: unknown[], since?: string | null) => (since ? raw.filter((value) => Date.parse(String(obj(obj(value).fields).updated ?? "")) >= Date.parse(since)) : raw);
  const all = (access: TrackerAccess, key: string) => {
    project(access, key);
    return list(read(access).issues).flatMap((raw) => parseIssue(raw, access.site) ?? []);
  };
  return {
    me: async (access) => parseUser(read(access).me)!,
    project: async (access, key) => {
      const found = project(access, key);
      return { key, name: String(found.name), types: list(found.issueTypes).flatMap((t) => parseType(t) ?? []) };
    },
    statuses: async (access, key) => (project(access, key), list(read(access).statuses).flatMap((s) => parseStatus(s) ?? [])),
    priorities: async (access) => list(read(access).priorities).map(String),
    fields: async (access) => list(read(access).fields).flatMap((f) => parseField(f) ?? []),
    users: async (access, key) => (project(access, key), list(read(access).users).flatMap((u) => parseUser(u) ?? [])),
    roles: async (access, key) => (
      project(access, key),
      list(read(access).roles).flatMap((r) => (typeof obj(r).name === "string" ? [{ name: String(obj(r).name), users: list(obj(r).users).map(String), groups: list(obj(r).groups).map(String) }] : []))
    ),
    // The stand-in keeps the scheme as the tracker gives it, and the groups with their people.
    scheme: async (access, key) => {
      project(access, key);
      const raw = read(access).scheme;
      if (!raw) throw new TrackerError("not_found");
      return {
        name: String(obj(raw).name ?? ""),
        grants: list(obj(raw).permissions).flatMap((g) => parseGrant(g) ?? []),
        groups: list(read(access).groups).map((g) => ({ id: String(obj(g).id), name: String(obj(g).name), users: list(obj(g).users).map(String), ...(obj(g).unread ? { unread: true } : {}) })),
      };
    },
    count: async (access, key, since) => (project(access, key), changed(list(read(access).issues), since).length),
    lastNumber: async (access, key) => Math.max(0, ...all(access, key).map((i) => numberOfKey(i.key) ?? 0)),
    files: async (access, key, cursor, size, since) => {
      project(access, key);
      const raw = changed(list(read(access).issues), since);
      const from = Number(cursor ?? 0);
      return {
        items: raw.slice(from, from + size).flatMap((value) => {
          const files = parseFiles(obj(obj(value).fields).attachment);
          return files.length ? [{ key: String(obj(value).key), files }] : [];
        }),
        next: from + size < raw.length ? String(from + size) : null,
      };
    },
    // The file's bytes lie next to tracker.json under files/<id>; a missing one is "not found".
    fileStream: async (access, id, offset) => {
      read(access);
      let bytes: Buffer;
      try {
        bytes = readFileSync(join(dir, "files", id.replace(/[^0-9A-Za-z_-]/g, "")));
      } catch {
        throw new TrackerError("not_found");
      }
      return { body: new Blob([new Uint8Array(bytes.subarray(offset))]).stream() as ReadableStream<Uint8Array>, ranged: true };
    },
    activity: async (access, key, cursor, size, since) => {
      project(access, key);
      const raw = changed(list(read(access).issues), since);
      const from = Number(cursor ?? 0);
      return {
        items: raw.slice(from, from + size).map((value) => {
          const issue = obj(value);
          return { key: String(issue.key), comments: parseComments(obj(obj(issue.fields).comment).comments), moves: parseMoves(obj(issue.changelog).histories), worklogs: parseWorklogs(obj(obj(issue.fields).worklog).worklogs) };
        }),
        next: from + size < raw.length ? String(from + size) : null,
      };
    },
    issues: async (access, key, cursor, size, _fields, since) => {
      project(access, key);
      const issues = changed(list(read(access).issues), since).flatMap((raw) => parseIssue(raw, access.site) ?? []);
      const from = Number(cursor ?? 0);
      return { issues: issues.slice(from, from + size), next: from + size < issues.length ? String(from + size) : null };
    },
  };
}

export function trackerApi(): TrackerApi {
  const fakeDir = process.env.TRACKER_FAKE_DIR;
  if (fakeDir && !process.env.VERCEL) return fake(fakeDir);
  return cloud;
}
