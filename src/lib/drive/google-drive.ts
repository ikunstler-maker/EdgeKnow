import "server-only";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// A small Google Drive client for what the wiki needs: sign-in exchange, folders,
// uploads, overwrites, downloads and deletes. The only permission asked for is
// drive.file — the wiki sees nothing on the Drive except the files it created.
//
// For automated tests DRIVE_FAKE_DIR switches to a stand-in that keeps files in a
// local folder (never on Vercel, where it is ignored).

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];
// VAULT-7: reading the whole Drive to show it in Vault, asked only when the owner agrees.
export const BROWSE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

// An entry of the Drive as Vault shows it (a Google document has no size: null).
export type DriveEntry = { id: string; name: string; mimeType: string; size: number | null; modifiedTime: string | null; folder: boolean; link: string | null };
export const GOOGLE_NATIVE = "application/vnd.google-apps.";

export type DriveApi = {
  authUrl(redirectUri: string, state: string, browse?: boolean): string;
  exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; email: string; browse: boolean }>;
  createFolder(refreshToken: string, name: string, parentId?: string): Promise<string>;
  upload(refreshToken: string, folderId: string, name: string, mimeType: string, bytes: Uint8Array): Promise<string>;
  overwrite(refreshToken: string, fileId: string, mimeType: string, bytes: Uint8Array): Promise<void>;
  download(refreshToken: string, fileId: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  remove(refreshToken: string, fileId: string): Promise<void>;
  // A large file goes up in parts: open a session, then send the parts in order (every
  // part but the last a multiple of 256 KB). The session can be continued later.
  beginUpload(refreshToken: string, folderId: string, name: string, mimeType: string, size: number): Promise<string>;
  sendPart(refreshToken: string, session: string, bytes: Uint8Array, offset: number, size: number): Promise<{ fileId: string | null }>;
  // A file as a stream (a large one never sits in memory); `range`: the request's own Range header.
  stream(refreshToken: string, fileId: string, range?: string | null): Promise<{ body: ReadableStream<Uint8Array> | null; status: number; headers: Record<string, string> }>;
  // How much the Drive holds and how much is used, in bytes (no limit: null).
  quota(refreshToken: string): Promise<{ limit: number | null; usage: number }>;
  // VAULT-2b: a file opened to one person (no notification email), its role changed, taken away.
  share(refreshToken: string, fileId: string, email: string, role: "reader" | "writer"): Promise<string>;
  updateShare(refreshToken: string, fileId: string, permissionId: string, role: "reader" | "writer"): Promise<void>;
  unshare(refreshToken: string, fileId: string, permissionId: string): Promise<void>;
  // VAULT-7 (drive.readonly): a folder's entries ("root": the top), a page at a time; one entry.
  list(refreshToken: string, folderId: string, pageToken?: string | null): Promise<{ entries: DriveEntry[]; next: string | null }>;
  entry(refreshToken: string, fileId: string): Promise<DriveEntry & { trashed: boolean }>;
  // A Google document, sheet, slides or drawing as a PDF (Google's limit: 10 MB).
  exportPdf(refreshToken: string, fileId: string): Promise<{ body: ReadableStream<Uint8Array> | null; status: number; headers: Record<string, string> }>;
};

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
  // Access revoked or the account is gone: the connection needs to be redone.
  get revoked() {
    return this.status === 400 || this.status === 401 || this.status === 403;
  }
}

// --- Google -----------------------------------------------------------------------

const accessTokens = new Map<string, { token: string; expires: number }>();

async function accessToken(refreshToken: string): Promise<string> {
  const cached = accessTokens.get(refreshToken);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!response.ok || !json.access_token) throw new DriveError("token refresh failed", response.status || 401);
  accessTokens.set(refreshToken, { token: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 });
  return json.access_token;
}

async function call(refreshToken: string, url: string, init: RequestInit = {}) {
  const token = await accessToken(refreshToken);
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new DriveError(`drive request failed: ${response.status}`, response.status);
  return response;
}

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
// Folders may live in a team's shared drive.
const ALL_DRIVES = "supportsAllDrives=true";

function multipart(metadata: object, mimeType: string, bytes: Uint8Array) {
  const boundary = `edgeknow${randomUUID()}`;
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = new Uint8Array(Buffer.concat([Buffer.from(head), Buffer.from(bytes), Buffer.from(tail)]));
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

const ENTRY_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink";
type GoogleEntry = { id: string; name?: string; mimeType?: string; size?: string; modifiedTime?: string; webViewLink?: string };
const FOLDER = "application/vnd.google-apps.folder";
const asEntry = (f: GoogleEntry): DriveEntry => ({
  id: f.id,
  name: f.name ?? "",
  mimeType: f.mimeType ?? "application/octet-stream",
  size: f.size ? Number(f.size) : null,
  modifiedTime: f.modifiedTime ?? null,
  folder: f.mimeType === FOLDER,
  // Only Google's own pages: a document opens there.
  link: f.webViewLink?.startsWith("https://docs.google.com/") || f.webViewLink?.startsWith("https://drive.google.com/") ? f.webViewLink : null,
});

const google: DriveApi = {
  authUrl(redirectUri, state, browse) {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: [...DRIVE_SCOPES, ...(browse ? [BROWSE_SCOPE] : [])].join(" "),
      access_type: "offline",
      // Always ask, so Google returns a refresh token even on a second connection.
      prompt: "consent select_account",
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async exchangeCode(code, redirectUri) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await response.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; scope?: string };
    if (!response.ok || !json.refresh_token) throw new DriveError("code exchange failed", response.status || 400);
    if (!String(json.scope ?? "").includes("drive.file")) throw new DriveError("drive permission not granted", 403);
    // The id token comes straight from Google over TLS; only the email is read from it.
    const claims = JSON.parse(Buffer.from((json.id_token ?? "..").split(".")[1] ?? "", "base64url").toString("utf8") || "{}");
    return { refreshToken: json.refresh_token, email: String(claims.email ?? ""), browse: String(json.scope ?? "").split(" ").includes(BROWSE_SCOPE) };
  },

  async createFolder(refreshToken, name, parentId) {
    const response = await call(refreshToken, `${FILES}?${ALL_DRIVES}&fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) }),
    });
    return ((await response.json()) as { id: string }).id;
  },

  async upload(refreshToken, folderId, name, mimeType, bytes) {
    const { body, contentType } = multipart({ name, parents: [folderId] }, mimeType, bytes);
    const response = await call(refreshToken, `${UPLOAD}?uploadType=multipart&${ALL_DRIVES}&fields=id`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
    return ((await response.json()) as { id: string }).id;
  },

  async overwrite(refreshToken, fileId, mimeType, bytes) {
    await call(refreshToken, `${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media&${ALL_DRIVES}`, {
      method: "PATCH",
      headers: { "Content-Type": mimeType },
      body: new Uint8Array(bytes),
    });
  },

  async download(refreshToken, fileId) {
    const response = await call(refreshToken, `${FILES}/${encodeURIComponent(fileId)}?alt=media&${ALL_DRIVES}`);
    return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get("content-type") ?? "application/octet-stream" };
  },

  async remove(refreshToken, fileId) {
    try {
      await call(refreshToken, `${FILES}/${encodeURIComponent(fileId)}?${ALL_DRIVES}`, { method: "DELETE" });
    } catch (error) {
      // Already gone is fine.
      if (!(error instanceof DriveError && error.status === 404)) throw error;
    }
  },

  async beginUpload(refreshToken, folderId, name, mimeType, size) {
    const response = await call(refreshToken, `${UPLOAD}?uploadType=resumable&${ALL_DRIVES}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mimeType, "X-Upload-Content-Length": String(size) },
      body: JSON.stringify({ name, parents: [folderId] }),
    });
    const session = response.headers.get("location");
    if (!session || !session.startsWith("https://www.googleapis.com/")) throw new DriveError("no upload session", 502);
    return session;
  },

  async sendPart(refreshToken, session, bytes, offset, size) {
    if (!session.startsWith("https://www.googleapis.com/")) throw new DriveError("bad upload session", 400);
    const token = await accessToken(refreshToken);
    const response = await fetch(session, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Length": String(bytes.length), "Content-Range": `bytes ${offset}-${offset + bytes.length - 1}/${size}` },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(60_000),
    });
    // 308: the part is in, more are expected.
    if (response.status === 308) return { fileId: null };
    if (!response.ok) throw new DriveError(`drive upload failed: ${response.status}`, response.status);
    const json = (await response.json().catch(() => ({}))) as { id?: string };
    if (!json.id) throw new DriveError("drive upload gave no file", 502);
    return { fileId: json.id };
  },

  async stream(refreshToken, fileId, range) {
    const token = await accessToken(refreshToken);
    const response = await fetch(`${FILES}/${encodeURIComponent(fileId)}?alt=media&${ALL_DRIVES}`, {
      headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) },
    });
    if (!response.ok) throw new DriveError(`drive request failed: ${response.status}`, response.status);
    const headers: Record<string, string> = {};
    for (const name of ["content-length", "content-range", "accept-ranges"]) if (response.headers.get(name)) headers[name] = response.headers.get(name)!;
    return { body: response.body, status: response.status, headers };
  },

  async share(refreshToken, fileId, email, role) {
    const response = await call(refreshToken, `${FILES}/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&${ALL_DRIVES}&fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "user", role, emailAddress: email }),
    });
    return ((await response.json()) as { id: string }).id;
  },

  async updateShare(refreshToken, fileId, permissionId, role) {
    await call(refreshToken, `${FILES}/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?${ALL_DRIVES}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
  },

  async unshare(refreshToken, fileId, permissionId) {
    try {
      await call(refreshToken, `${FILES}/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?${ALL_DRIVES}`, { method: "DELETE" });
    } catch (error) {
      // Already gone (or the file is) is fine.
      if (!(error instanceof DriveError && error.status === 404)) throw error;
    }
  },

  async list(refreshToken, folderId, pageToken) {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/[^a-zA-Z0-9_-]/g, "")}' in parents and trashed = false`,
      fields: `nextPageToken, files(${ENTRY_FIELDS})`,
      orderBy: "folder, name_natural",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await call(refreshToken, `${FILES}?${params}`);
    const json = (await response.json()) as { nextPageToken?: string; files?: GoogleEntry[] };
    return { entries: (json.files ?? []).map(asEntry), next: json.nextPageToken ?? null };
  },

  async entry(refreshToken, fileId) {
    const response = await call(refreshToken, `${FILES}/${encodeURIComponent(fileId)}?${ALL_DRIVES}&fields=${ENTRY_FIELDS},trashed`);
    const json = (await response.json()) as GoogleEntry & { trashed?: boolean };
    return { ...asEntry(json), trashed: Boolean(json.trashed) };
  },

  async exportPdf(refreshToken, fileId) {
    const response = await call(refreshToken, `${FILES}/${encodeURIComponent(fileId)}/export?mimeType=application%2Fpdf`);
    const length = response.headers.get("content-length");
    const headers: Record<string, string> = length ? { "content-length": length } : {};
    return { body: response.body, status: 200, headers };
  },

  async quota(refreshToken) {
    const response = await call(refreshToken, "https://www.googleapis.com/drive/v3/about?fields=storageQuota");
    const { storageQuota } = (await response.json()) as { storageQuota?: { limit?: string; usage?: string } };
    return { limit: storageQuota?.limit ? Number(storageQuota.limit) : null, usage: Number(storageQuota?.usage ?? 0) };
  },
};

// --- Stand-in for tests ---------------------------------------------------------------

function fake(dir: string): DriveApi {
  const file = (id: string) => path.join(dir, id.replace(/[^a-zA-Z0-9_-]/g, ""));
  const check = (refreshToken: string) => {
    if (refreshToken !== "fake-refresh-token") throw new DriveError("revoked", 401);
  };
  // Who a file is shared with, kept next to it (an address at no-google.test has no Google account).
  const perms = (id: string) => `${file(id)}.perms.json`;
  const readPerms = async (id: string): Promise<Record<string, { email: string; role: string }>> =>
    JSON.parse(await readFile(perms(id), "utf8").catch(() => "{}"));
  const writePerms = (id: string, value: Record<string, { email: string; role: string }>) => writeFile(perms(id), JSON.stringify(value));
  const fakeEntry = async (id: string): Promise<DriveEntry> => ({
    id,
    name: await readFile(`${file(id)}.name`, "utf8").catch(() => id),
    mimeType: await readFile(`${file(id)}.type`, "utf8").catch(() => "application/octet-stream"),
    size: (await stat(file(id))).size,
    modifiedTime: (await stat(file(id))).mtime.toISOString(),
    folder: false,
    link: null,
  });
  return {
    authUrl: (redirectUri, state, browse) => `${redirectUri}?code=${browse ? "fake-code-browse" : "fake-code"}&state=${encodeURIComponent(state)}`,
    async exchangeCode(code) {
      if (code !== "fake-code" && code !== "fake-code-browse") throw new DriveError("bad code", 400);
      return { refreshToken: "fake-refresh-token", email: "team-drive@fake.test", browse: code === "fake-code-browse" };
    },
    async createFolder(refreshToken) {
      check(refreshToken);
      return `folder-${randomUUID()}`;
    },
    async upload(refreshToken, _folder, name, mimeType, bytes) {
      check(refreshToken);
      await mkdir(dir, { recursive: true });
      const id = `file-${randomUUID()}`;
      await writeFile(file(id), bytes);
      await writeFile(`${file(id)}.type`, mimeType);
      await writeFile(`${file(id)}.name`, name);
      return id;
    },
    async overwrite(refreshToken, fileId, mimeType, bytes) {
      check(refreshToken);
      await writeFile(file(fileId), bytes);
      await writeFile(`${file(fileId)}.type`, mimeType);
    },
    async download(refreshToken, fileId) {
      check(refreshToken);
      try {
        return { bytes: new Uint8Array(await readFile(file(fileId))), mimeType: await readFile(`${file(fileId)}.type`, "utf8") };
      } catch {
        throw new DriveError("not found", 404);
      }
    },
    async remove(refreshToken, fileId) {
      check(refreshToken);
      await rm(file(fileId), { force: true });
      await rm(`${file(fileId)}.type`, { force: true });
    },
    async share(refreshToken, fileId, email, role) {
      check(refreshToken);
      if (email.endsWith("@no-google.test")) throw new DriveError("no Google account for this address", 400);
      const all = await readPerms(fileId);
      const id = `perm-${randomUUID()}`;
      all[id] = { email, role };
      await writePerms(fileId, all);
      return id;
    },
    async updateShare(refreshToken, fileId, permissionId, role) {
      check(refreshToken);
      const all = await readPerms(fileId);
      if (!all[permissionId]) throw new DriveError("not found", 404);
      all[permissionId].role = role;
      await writePerms(fileId, all);
    },
    async unshare(refreshToken, fileId, permissionId) {
      check(refreshToken);
      const all = await readPerms(fileId);
      delete all[permissionId];
      await writePerms(fileId, all);
    },
    async beginUpload(refreshToken, _folder, _name, mimeType) {
      check(refreshToken);
      await mkdir(dir, { recursive: true });
      const id = `file-${randomUUID()}`;
      await writeFile(file(id), new Uint8Array());
      await writeFile(`${file(id)}.type`, mimeType);
      return `https://www.googleapis.com/fake-session/${id}`;
    },
    async sendPart(refreshToken, session, bytes, offset, size) {
      check(refreshToken);
      const id = session.split("/").pop() ?? "";
      const had = (await stat(file(id)).catch(() => null))?.size;
      if (had !== offset) throw new DriveError("part out of order", 400);
      await appendFile(file(id), bytes);
      return { fileId: offset + bytes.length >= size ? id : null };
    },
    async stream(refreshToken, fileId, range) {
      check(refreshToken);
      try {
        const all = new Uint8Array(await readFile(file(fileId)));
        const match = /^bytes=(\d+)-(\d*)$/.exec(range ?? "");
        const from = match ? Number(match[1]) : 0;
        const to = match?.[2] ? Number(match[2]) + 1 : all.length;
        const part = all.slice(from, to);
        return {
          body: new Blob([part]).stream() as ReadableStream<Uint8Array>,
          status: match ? 206 : 200,
          headers: { "content-length": String(part.length), "accept-ranges": "bytes", ...(match ? { "content-range": `bytes ${from}-${to - 1}/${all.length}` } : {}) },
        };
      } catch {
        throw new DriveError("not found", 404);
      }
    },
    // The stand-in has no folders: every file is at the top ("root").
    async list(refreshToken, folderId) {
      check(refreshToken);
      if (folderId !== "root") return { entries: [], next: null };
      const entries: DriveEntry[] = [];
      for (const name of (await readdir(dir).catch(() => [] as string[])).sort()) {
        if (name.startsWith("file-") && !name.includes(".")) entries.push(await fakeEntry(name));
      }
      return { entries, next: null };
    },
    async entry(refreshToken, fileId) {
      check(refreshToken);
      if (!(await stat(file(fileId)).catch(() => null))) throw new DriveError("not found", 404);
      return { ...(await fakeEntry(fileId)), trashed: false };
    },
    async exportPdf(refreshToken) {
      check(refreshToken);
      throw new DriveError("the stand-in has no Google documents", 404);
    },
    async quota(refreshToken) {
      check(refreshToken);
      let usage = 0;
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        if (!name.endsWith(".type") && !name.endsWith(".name")) usage += (await stat(path.join(dir, name))).size;
      }
      return { limit: 15 * 1024 ** 3, usage };
    },
  };
}

export function driveApi(): DriveApi {
  const fakeDir = process.env.DRIVE_FAKE_DIR;
  if (fakeDir && !process.env.VERCEL) return fake(fakeDir);
  return google;
}

export function driveConfigured(): boolean {
  if (process.env.DRIVE_FAKE_DIR && !process.env.VERCEL) return Boolean(process.env.DRIVE_TOKEN_KEY && process.env.SUPABASE_SECRET_KEY);
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.DRIVE_TOKEN_KEY && process.env.SUPABASE_SECRET_KEY);
}
