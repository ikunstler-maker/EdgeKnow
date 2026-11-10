// Doba, phase 3b: the busy time of an outside calendar, from its file. Only starts and
// ends leave this module — titles, places and people are never read out of the file.
import ICAL from "ical.js";

// No imports from the app here: the unit script loads this file on its own.
const DAY_MS = 24 * 60 * 60 * 1000;

export type BusySlotInput = { starts_at: string; ends_at: string; all_day: boolean };
export const MAX_SLOTS = 2000;
// A series is walked from its first day; this many steps reach decades of daily meetings.
const MAX_STEPS = 20000;

type Vevent = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;

const text = (component: Vevent, name: string) => String(component.getFirstPropertyValue(name) ?? "").toUpperCase();
const tzidOf = (component: Vevent, name: string) => {
  const value = component.getFirstProperty(name)?.getParameter("tzid");
  return typeof value === "string" ? value : null;
};

// The moment of a wall clock in a named zone (two passes settle a clock change); throws
// for a name the runtime doesn't know.
function zonedMoment(wall: number, timeZone: string): number {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const offsetAt = (ms: number) => {
    const part = Object.fromEntries(format.formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]));
    return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second) - ms;
  };
  return wall - offsetAt(wall - offsetAt(wall));
}

// Does this event take the person's time? A cancelled or "free" one doesn't; a whole-day
// one only when the calendar says "busy" outright (a birthday or a holiday is not).
function counts(component: Vevent, wholeDay: boolean) {
  if (text(component, "status") === "CANCELLED") return false;
  const transp = text(component, "transp");
  const shown = text(component, "x-microsoft-cdo-busystatus");
  if (transp === "TRANSPARENT" || shown === "FREE" || shown === "WORKINGELSEWHERE") return false;
  if (!wholeDay) return true;
  return transp === "OPAQUE" || shown === "BUSY" || shown === "OOF";
}

// The moment of a time from the file. A zone the file describes is the library's work; a
// zone only named (a common zone name without its description) is worked out here; a
// time with no zone at all is read as UTC.
function moment(time: Time, tzid: string | null): number {
  if (time.isDate) return Date.UTC(time.year, time.month - 1, time.day);
  const zone = time.zone?.tzid;
  if (zone && zone !== "floating") return time.toJSDate().getTime();
  const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  if (tzid) {
    try {
      return zonedMoment(wall, tzid);
    } catch {
      // An unknown zone name: as UTC below.
    }
  }
  return wall;
}

// Overlapping and touching slots become one: fewer rows, and less to guess from.
function merge(slots: { start: number; end: number }[]) {
  const sorted = [...slots].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const slot of sorted) {
    const last = merged[merged.length - 1];
    if (last && slot.start <= last.end) last.end = Math.max(last.end, slot.end);
    else merged.push({ ...slot });
  }
  return merged;
}

export function busyFromCalendar(source: string, from: Date, to: Date): BusySlotInput[] {
  const lo = from.getTime();
  const hi = to.getTime();
  const timed: { start: number; end: number }[] = [];
  const days: { start: number; end: number }[] = [];
  const add = (component: Vevent, start: Time, end: Time, tzid: string | null) => {
    const wholeDay = start.isDate;
    if (!counts(component, wholeDay)) return;
    const s = moment(start, tzid);
    let e = moment(end, wholeDay ? null : (tzidOf(component, "dtend") ?? tzid));
    if (wholeDay && e <= s) e = s + DAY_MS;
    if (!(e > s) || e - s > 100 * DAY_MS) return;
    if (wholeDay) {
      // Whole days are plain dates: a day counts while it isn't over anywhere yet.
      if (e > lo - DAY_MS && s < hi) days.push({ start: s, end: e });
    } else if (e > lo && s < hi) timed.push({ start: Math.max(s, lo), end: Math.min(e, hi) });
  };

  try {
    const calendar = new ICAL.Component(ICAL.parse(source));
    for (const zone of calendar.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(new ICAL.Timezone(zone));
    const masters: Vevent[] = [];
    const changed = new Map<string, Vevent[]>();
    for (const component of calendar.getAllSubcomponents("vevent")) {
      if (!component.hasProperty("dtstart")) continue;
      if (component.hasProperty("recurrence-id")) {
        const uid = String(component.getFirstPropertyValue("uid") ?? "");
        changed.set(uid, [...(changed.get(uid) ?? []), component]);
      } else masters.push(component);
    }
    const seen = new Set<string>();
    for (const component of masters) {
      const event = new ICAL.Event(component);
      const tzid = tzidOf(component, "dtstart");
      seen.add(event.uid);
      if (!event.isRecurring()) {
        add(component, event.startDate, event.endDate, tzid);
        continue;
      }
      for (const exception of changed.get(event.uid) ?? []) event.relateException(exception);
      const iterator = event.iterator();
      for (let step = 0; step < MAX_STEPS; step++) {
        const next = iterator.next();
        if (!next) break;
        if (moment(next, tzid) >= hi + DAY_MS) break;
        const day = event.getOccurrenceDetails(next);
        // A day changed on its own carries its own times, zone and "free / busy".
        const item = day.item.component as Vevent;
        add(item, day.startDate, day.endDate, item === component ? tzid : tzidOf(item, "dtstart"));
      }
    }
    // Changed days whose series is not in the file stand on their own.
    for (const [uid, list] of changed) {
      if (seen.has(uid)) continue;
      for (const component of list) {
        const event = new ICAL.Event(component);
        add(component, event.startDate, event.endDate, tzidOf(component, "dtstart"));
      }
    }
  } finally {
    // The zones of one person's file must not leak into the next one.
    ICAL.TimezoneService.reset();
  }

  const iso = (ms: number) => new Date(ms).toISOString();
  return [
    ...merge(timed).map((s) => ({ starts_at: iso(s.start), ends_at: iso(s.end), all_day: false })),
    ...merge(days).map((s) => ({ starts_at: iso(s.start), ends_at: iso(s.end), all_day: true })),
  ]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, MAX_SLOTS);
}

// What a person may paste: an https address; "webcal:" is the same thing by another name.
export const normalizeCalendarUrl = (raw: string) => raw.trim().replace(/^webcals?:\/\//i, "https://");
