import "server-only";

// DOBA-1: a small client for the provider's calendar and video meetings — only what
// Doba needs (decision 2027-02-01, widened 2026-11-13). Permissions asked for:
// - calendar.events.owned.readonly: the events of calendars the person owns (we read the
//   primary one only: title, time, busy or free; no descriptions, places or people);
// - calendar.app.created: the app's own "Doba" calendar and its events, nothing else;
// - meetings.space.created: video meeting rooms the app creates.
// The provider's name appears in the interface on its buttons only.

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.owned.readonly",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/meetings.space.created",
  "openid",
  "email",
];

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
  // The access was taken back or the account is gone: the connection needs to be redone.
  get revoked() {
    return this.status === 400 || this.status === 401 || this.status === 403;
  }
  // The thing asked for is not there (any more).
  get gone() {
    return this.status === 404 || this.status === 410;
  }
}

export const googleCalendarConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function authUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so a refresh token comes back on a second connection too.
    prompt: "consent select_account",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// The code from the consent screen → a long-lived access. Every calendar permission must
// have been granted (the person may untick some): otherwise nothing is kept.
export async function exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; email: string }> {
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
  const json = (await response.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; id_token?: string; scope?: string };
  if (!response.ok || !json.refresh_token) throw new GoogleCalendarError("code exchange failed", response.status || 400);
  const granted = String(json.scope ?? "").split(" ");
  const missing = CALENDAR_SCOPES.filter((s) => s.startsWith("https://") && !granted.includes(s));
  // Nothing is kept. The access is not taken back here: the same account may keep a
  // workspace's files, and taking it back could cut that off too.
  if (missing.length) throw new GoogleCalendarError("permissions not granted", 412);
  // The id token comes straight from the provider over TLS; only the email is read from it.
  const claims = JSON.parse(Buffer.from((json.id_token ?? "..").split(".")[1] ?? "", "base64url").toString("utf8") || "{}");
  return { refreshToken: json.refresh_token, email: String(claims.email ?? "") };
}

// Takes the access back at the provider (whatever happens on our side).
export async function revoke(refreshToken: string): Promise<void> {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
    signal: AbortSignal.timeout(10_000),
  });
  // Already invalid counts as revoked.
  if (!response.ok && response.status !== 400) throw new GoogleCalendarError("revoke failed", response.status);
  accessTokens.delete(refreshToken);
}

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
  if (!response.ok || !json.access_token) throw new GoogleCalendarError("token refresh failed", response.status || 401);
  accessTokens.set(refreshToken, { token: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 });
  return json.access_token;
}

async function call<T>(refreshToken: string, url: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(refreshToken);
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new GoogleCalendarError(`calendar request failed: ${response.status}`, response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json().catch(() => ({}))) as T;
}

const CALENDARS = "https://www.googleapis.com/calendar/v3/calendars";
const enc = encodeURIComponent;

// --- The person's own events (read only) -----------------------------------------

export type OwnEvent = { starts_at: string; ends_at: string; all_day: boolean; title: string; busy: boolean };

type RawTime = { date?: string; dateTime?: string };
type RawEvent = {
  status?: string;
  summary?: string;
  start?: RawTime;
  end?: RawTime;
  transparency?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
};

// A whole day keeps its dates as UTC midnights, like a whole-day event in Doba.
const timeOf = (t: RawTime | undefined): { iso: string; day: boolean } | null => {
  if (t?.dateTime && !Number.isNaN(Date.parse(t.dateTime))) return { iso: new Date(t.dateTime).toISOString(), day: false };
  if (t?.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) return { iso: `${t.date}T00:00:00.000Z`, day: true };
  return null;
};

export function ownEventOf(raw: RawEvent): OwnEvent | null {
  if (raw.status === "cancelled") return null;
  if (raw.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;
  const start = timeOf(raw.start);
  const end = timeOf(raw.end);
  if (!start || !end || Date.parse(end.iso) <= Date.parse(start.iso)) return null;
  return {
    starts_at: start.iso,
    ends_at: end.iso,
    all_day: start.day,
    title: (raw.summary ?? "").trim().slice(0, 300),
    busy: raw.transparency !== "transparent",
  };
}

// The primary calendar's events of a period, each day of a series on its own.
export async function listOwnEvents(refreshToken: string, from: Date, to: Date): Promise<OwnEvent[]> {
  const out: OwnEvent[] = [];
  let page: string | undefined;
  for (let i = 0; i < 4; i += 1) {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      maxResults: "500",
      fields: "nextPageToken,items(status,summary,start,end,transparency,attendees(self,responseStatus))",
      ...(page ? { pageToken: page } : {}),
    });
    const json = await call<{ items?: RawEvent[]; nextPageToken?: string }>(refreshToken, `${CALENDARS}/primary/events?${params}`);
    for (const raw of json.items ?? []) {
      const one = ownEventOf(raw);
      if (one) out.push(one);
    }
    page = json.nextPageToken;
    if (!page) break;
  }
  return out.slice(0, 2000);
}

// --- The app's own "Doba" calendar ------------------------------------------------

export async function createCalendar(refreshToken: string, name: string, timeZone: string): Promise<string> {
  const json = await call<{ id?: string }>(refreshToken, CALENDARS, { method: "POST", body: JSON.stringify({ summary: name, timeZone }) });
  if (!json.id) throw new GoogleCalendarError("no calendar id", 500);
  return json.id;
}

export async function deleteCalendar(refreshToken: string, calendarId: string): Promise<void> {
  try {
    await call(refreshToken, `${CALENDARS}/${enc(calendarId)}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof GoogleCalendarError && error.gone)) throw error;
  }
}

// What a copy of a Doba event holds: title, time, place and the meeting link. No
// description, no people.
export type CopyBody = {
  summary: string;
  location?: string;
  description?: string;
  start: RawTime;
  end: RawTime;
  status: "confirmed" | "tentative";
  transparency: "opaque";
  extendedProperties: { private: { doba: string } };
};

export async function insertCopy(refreshToken: string, calendarId: string, body: CopyBody): Promise<string> {
  const json = await call<{ id?: string }>(refreshToken, `${CALENDARS}/${enc(calendarId)}/events`, { method: "POST", body: JSON.stringify(body) });
  if (!json.id) throw new GoogleCalendarError("no event id", 500);
  return json.id;
}

export async function updateCopy(refreshToken: string, calendarId: string, eventId: string, body: CopyBody): Promise<void> {
  await call(refreshToken, `${CALENDARS}/${enc(calendarId)}/events/${enc(eventId)}`, { method: "PUT", body: JSON.stringify(body) });
}

export async function deleteCopy(refreshToken: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await call(refreshToken, `${CALENDARS}/${enc(calendarId)}/events/${enc(eventId)}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof GoogleCalendarError && error.gone)) throw error;
  }
}

// --- Video meetings ---------------------------------------------------------------

// A new meeting room; its address is what the event's meeting link becomes.
export async function createMeeting(refreshToken: string): Promise<string> {
  const json = await call<{ meetingUri?: string }>(refreshToken, "https://meet.googleapis.com/v2/spaces", { method: "POST", body: "{}" });
  const uri = String(json.meetingUri ?? "");
  if (!/^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test(uri)) throw new GoogleCalendarError("no meeting address", 500);
  return uri;
}
