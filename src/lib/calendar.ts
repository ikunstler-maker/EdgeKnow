// Doba (company calendar): shapes shared by the server actions and the screens, and
// the date arithmetic of the grid. Times are kept in UTC; the grid shows them in the
// viewer's own time zone, a whole-day event as plain dates (UTC midnights).

export const EVENT_VISIBILITIES = ["open", "request", "invite", "private"] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];
export type AttendeeStatus = "invited" | "requested" | "accepted" | "tentative" | "declined" | "rejected";
export type EventAnswer = "accepted" | "tentative" | "declined";

export type CalendarEvent = {
  id: string;
  title: string;
  location: string;
  meeting_url: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  time_zone: string;
  visibility: EventVisibility;
  organizer_id: string | null;
  organizer: string | null;
  my_status: AttendeeStatus | null;
  going: number;
  requests: number;
  // A day of a series: its date by the rule, and whether that day was changed on its own.
  recurring?: boolean;
  occurrence?: string | null;
  changed?: boolean;
};

export const REPEAT_FREQS = ["daily", "weekly", "monthly", "yearly"] as const;
export type RepeatFreq = (typeof REPEAT_FREQS)[number];
// "After N times" (count) or "until a date" (until), or neither: no end.
export type RepeatRule = { freq: RepeatFreq; interval: number; days: number[]; until: string | null; count: number | null };
export const REMINDERS = [10, 60, 1440] as const;
// What to change of a series: one day, that day and all after it, or every day.
export type SeriesScope = "one" | "following" | "all";
export type EventSeries = RepeatRule & {
  last_day: string | null;
  // The series' own first day and texts (a day may differ).
  starts_at: string;
  ends_at: string;
  title: string;
  description: string;
  location: string;
  meeting_url: string | null;
  occurrence: string | null;
  changed: boolean;
  day_cancelled: boolean;
};

export type EventAttendee = { id: string; name: string; status: AttendeeStatus };
export type EventDetails = {
  event: Omit<CalendarEvent, "organizer" | "my_status" | "going" | "requests" | "recurring" | "occurrence" | "changed"> & { description: string; cancelled: boolean; reminder_minutes?: number | null };
  series?: EventSeries | null;
  can_edit: boolean;
  can_cancel: boolean;
  my_status: AttendeeStatus | null;
  attendees: EventAttendee[];
};

export type EventFields = {
  title: string;
  description: string;
  location: string;
  meeting_url: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  time_zone: string;
  visibility: EventVisibility;
  repeat?: RepeatRule | null;
  reminder_minutes?: number | null;
};

export type BusySlot = { user_id: string; starts_at: string; ends_at: string; all_day: boolean };
export type CalendarSettings = { work_days: number[]; time_zone: string };
export type CalendarPerson = { id: string; name: string; guest: boolean };
export type CancelledEvent = { id: string; title: string; starts_at: string; all_day: boolean; deleted_at: string; organizer_id: string | null; visibility: EventVisibility };

// A Rukh task with a due date, as the calendar shows it (read-only here).
export type CalendarTask = { id: string; key: string; project: string; number: number; title: string; due_date: string; done: boolean; priority: string; mine: boolean };
// Which tasks the calendar shows: none, mine (assignee or taking part), or all I can read.
export const TASK_MODES = ["off", "mine", "all"] as const;
export type TaskMode = (typeof TASK_MODES)[number];
export const TASK_MODE_KEY = "ek-calendar-tasks";
// At most this many task cards in a day's row; the rest is a "+N" counter.
export const TASKS_PER_DAY = 3;
export type CalendarUnit = { id: string; name: string };
export type EventHit = { id: string; title: string; location: string; all_day: boolean; recurring: boolean; starts_at: string };
export type EventChip = { id: string; title: string; starts_at: string; all_day: boolean; recurring: boolean; cancelled: boolean };

export const DEFAULT_SETTINGS: CalendarSettings = { work_days: [1, 2, 3, 4, 5], time_zone: "UTC" };
export const CALENDAR_VIEWS = ["month", "week", "list"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

// "2030-01-10" of a local date.
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromDayKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const isDayKey = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(fromDayKey(value).getTime());
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
// 1 = Monday … 7 = Sunday.
export const weekdayOf = (d: Date) => ((d.getDay() + 6) % 7) + 1;
export const startOfWeek = (d: Date) => addDays(startOfDay(d), 1 - weekdayOf(d));

// The 42 days of a month's grid (weeks start on Monday).
export function monthGrid(anchor: Date): Date[] {
  const first = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

// When an event starts and ends for the viewer. A whole-day event is the same dates
// everywhere: its UTC midnights are read as local ones.
export function eventSpan(event: { starts_at: string; ends_at: string; all_day: boolean }): { start: Date; end: Date } {
  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at);
  if (!event.all_day) return { start, end };
  return {
    start: new Date(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
    end: new Date(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  };
}

// Does the event touch this local day?
export function onDay(event: { starts_at: string; ends_at: string; all_day: boolean }, day: Date) {
  const { start, end } = eventSpan(event);
  const from = startOfDay(day).getTime();
  return start.getTime() < from + DAY_MS && end.getTime() > from;
}

// Events of one day side by side: each gets a column among those it overlaps.
export type Placed<T> = { item: T; top: number; height: number; column: number; columns: number };
export function placeDay<T extends { starts_at: string; ends_at: string }>(items: T[], day: Date): Placed<T>[] {
  const from = startOfDay(day).getTime();
  const spans = items
    .map((item) => ({
      item,
      start: Math.max(new Date(item.starts_at).getTime(), from),
      end: Math.min(new Date(item.ends_at).getTime(), from + DAY_MS),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: (Placed<T> & { end: number; group: number })[] = [];
  let group = 0;
  let groupEnd = -Infinity;
  const columnEnds: number[] = [];
  for (const span of spans) {
    if (span.start >= groupEnd) {
      group += 1;
      columnEnds.length = 0;
    }
    let column = columnEnds.findIndex((end) => end <= span.start);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = span.end;
    groupEnd = Math.max(groupEnd, span.end);
    // At least a quarter of an hour tall, so a short event can be read and tapped.
    const minutes = Math.max((span.end - span.start) / 60000, 15);
    placed.push({ item: span.item, top: (span.start - from) / 60000, height: minutes, column, columns: 1, end: span.end, group });
  }
  for (const p of placed) p.columns = Math.max(...placed.filter((o) => o.group === p.group).map((o) => o.column)) + 1;
  return placed.map(({ item, top, height, column, columns }) => ({ item, top, height, column, columns }));
}

// --- Time zones -------------------------------------------------------------

export const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export function timeZones(extra: string[] = []): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    // An old browser: only the zones at hand.
  }
  return [...new Set([...extra.filter(Boolean), "UTC", ...all])];
}

// The wall clock of a moment in a zone, as "YYYY-MM-DDTHH:mm".
export function toZonedInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// The moment of a wall clock ("YYYY-MM-DDTHH:mm") in a zone. Two passes settle the
// offset around a clock change.
export function fromZonedInput(input: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(input);
  if (!match) return null;
  const [y, mo, d, h, mi] = match.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms: number) => {
    const shown = toZonedInput(new Date(ms).toISOString(), timeZone);
    const [sy, smo, sd, sh, smi] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(shown)!.slice(1).map(Number);
    return Date.UTC(sy, smo - 1, sd, sh, smi) - ms;
  };
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  return Number.isNaN(guess) ? null : new Date(guess).toISOString();
}

// Whole-day events: dates only, kept as UTC midnights; the end is the day after the last one.
export const allDayStart = (key: string) => `${key}T00:00:00.000Z`;
export const allDayEnd = (lastKey: string) => new Date(Date.parse(`${lastKey}T00:00:00.000Z`) + DAY_MS).toISOString();
export const allDayKeys = (event: { starts_at: string; ends_at: string }) => ({
  first: event.starts_at.slice(0, 10),
  last: new Date(Date.parse(event.ends_at) - DAY_MS).toISOString().slice(0, 10),
});

export const isMeetingUrl = (value: string) => value === "" || (/^https:\/\/\S+$/.test(value) && value.length <= 500);
