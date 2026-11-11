import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { numberOfKey, parseField, parseIssue, parseStatus, parseType, parseUser, type TrackerField, type TrackerIssue, type TrackerRole, type TrackerStatus, type TrackerType, type TrackerUser } from "@/lib/tracker-convert";

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
  count(access: TrackerAccess, key: string): Promise<number>;
  lastNumber(access: TrackerAccess, key: string): Promise<number>;
  // Issues in the order of their keys; `fields`: custom field ids to bring along.
  issues(access: TrackerAccess, key: string, cursor: string | null, size: number, fields: string[]): Promise<IssuePage>;
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
const jql = (key: string, order: "ASC" | "DESC") => `project = "${key}" ORDER BY key ${order}`;

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
      roles.push({ name: name.slice(0, 120), users });
    }
    return roles;
  },
  async count(access, key) {
    return Number(obj(await call(access, "/rest/api/3/search/approximate-count", { jql: `project = "${key}"` })).count) || 0;
  },
  async lastNumber(access, key) {
    const page = obj(await call(access, "/rest/api/3/search/jql", { jql: jql(key, "DESC"), maxResults: 1, fields: ["summary"] }));
    return numberOfKey(String(obj(list(page.issues)[0]).key ?? "")) ?? 0;
  },
  async issues(access, key, cursor, size, fields) {
    const page = obj(
      await call(access, "/rest/api/3/search/jql", { jql: jql(key, "ASC"), maxResults: size, fields: [...BASE_FIELDS, ...fields], ...(cursor ? { nextPageToken: cursor } : {}) }),
    );
    return {
      issues: list(page.issues).flatMap((raw) => parseIssue(raw, access.site) ?? []),
      next: typeof page.nextPageToken === "string" && page.nextPageToken ? page.nextPageToken : null,
    };
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
      list(read(access).roles).flatMap((r) => (typeof obj(r).name === "string" ? [{ name: String(obj(r).name), users: list(obj(r).users).map(String) }] : []))
    ),
    count: async (access, key) => all(access, key).length,
    lastNumber: async (access, key) => Math.max(0, ...all(access, key).map((i) => numberOfKey(i.key) ?? 0)),
    issues: async (access, key, cursor, size) => {
      const issues = all(access, key);
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
