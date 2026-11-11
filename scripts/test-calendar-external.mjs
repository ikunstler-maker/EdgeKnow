// Doba 3b: busy time out of an outside calendar's file — no titles, free and cancelled
// events skipped, series and their changed days, zones, whole days only when "busy".
// Run: node --experimental-strip-types --no-warnings scripts/test-calendar-external.mjs
import assert from "node:assert/strict";
import { busyFromCalendar, normalizeCalendarUrl } from "../src/lib/calendar-external-parse.ts";

const file = (...events) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...events.flat(), "END:VCALENDAR"].join("\r\n");
const event = (uid, lines) => ["BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20300101T000000Z", "SUMMARY:Secret title", "LOCATION:Secret place", ...lines, "END:VEVENT"];
const from = new Date("2030-03-01T00:00:00Z");
const to = new Date("2030-05-30T00:00:00Z");
const busy = (...events) => busyFromCalendar(file(...events), from, to);
const span = (s) => `${s.starts_at.slice(0, 16)}/${s.ends_at.slice(0, 16)}${s.all_day ? " day" : ""}`;

// A plain meeting, and nothing of its texts.
let slots = busy(event("a", ["DTSTART:20300310T090000Z", "DTEND:20300310T100000Z"]));
assert.deepEqual(slots.map(span), ["2030-03-10T09:00/2030-03-10T10:00"]);
assert.deepEqual(Object.keys(slots[0]).sort(), ["all_day", "ends_at", "starts_at"]);
assert.ok(!JSON.stringify(slots).includes("Secret"));

// Free, cancelled and out-of-range ones are not busy time.
slots = busy(
  event("free", ["DTSTART:20300311T090000Z", "DTEND:20300311T100000Z", "TRANSP:TRANSPARENT"]),
  event("free2", ["DTSTART:20300311T110000Z", "DTEND:20300311T120000Z", "X-MICROSOFT-CDO-BUSYSTATUS:FREE"]),
  event("gone", ["DTSTART:20300311T130000Z", "DTEND:20300311T140000Z", "STATUS:CANCELLED"]),
  event("old", ["DTSTART:20290311T130000Z", "DTEND:20290311T140000Z"]),
  event("late", ["DTSTART:20310311T130000Z", "DTEND:20310311T140000Z"]),
);
assert.deepEqual(slots, []);

// Overlapping and touching meetings are one slot.
slots = busy(
  event("m1", ["DTSTART:20300312T090000Z", "DTEND:20300312T100000Z"]),
  event("m2", ["DTSTART:20300312T093000Z", "DTEND:20300312T110000Z"]),
  event("m3", ["DTSTART:20300312T110000Z", "DTEND:20300312T113000Z"]),
);
assert.deepEqual(slots.map(span), ["2030-03-12T09:00/2030-03-12T11:30"]);

// A whole day counts only when marked busy.
slots = busy(
  event("birthday", ["DTSTART;VALUE=DATE:20300315", "DTEND;VALUE=DATE:20300316"]),
  event("holiday", ["DTSTART;VALUE=DATE:20300316", "DTEND;VALUE=DATE:20300317", "TRANSP:TRANSPARENT"]),
  event("leave", ["DTSTART;VALUE=DATE:20300318", "DTEND;VALUE=DATE:20300320", "TRANSP:OPAQUE"]),
  event("away", ["DTSTART;VALUE=DATE:20300322", "X-MICROSOFT-CDO-BUSYSTATUS:OOF"]),
);
assert.deepEqual(slots.map(span), ["2030-03-18T00:00/2030-03-20T00:00 day", "2030-03-22T00:00/2030-03-23T00:00 day"]);

// A weekly series in a named zone keeps its wall clock across the clock change
// (Kyiv: UTC+2 until 31 March 2030, UTC+3 after); one day is cancelled, one moved.
slots = busy(
  event("weekly", ["DTSTART;TZID=Europe/Kyiv:20300318T100000", "DTEND;TZID=Europe/Kyiv:20300318T110000", "RRULE:FREQ=WEEKLY;COUNT=5", "EXDATE;TZID=Europe/Kyiv:20300325T100000"]),
  event("weekly", ["RECURRENCE-ID;TZID=Europe/Kyiv:20300408T100000", "DTSTART;TZID=Europe/Kyiv:20300409T150000", "DTEND;TZID=Europe/Kyiv:20300409T160000"]),
);
assert.deepEqual(slots.map(span), ["2030-03-18T08:00/2030-03-18T09:00", "2030-04-01T07:00/2030-04-01T08:00", "2030-04-09T12:00/2030-04-09T13:00", "2030-04-15T07:00/2030-04-15T08:00"]);

// A zone the file describes itself (the way desktop mail programs write it).
const zone = [
  "BEGIN:VTIMEZONE", "TZID:Custom Plus Five", "BEGIN:STANDARD", "DTSTART:16010101T000000", "TZOFFSETFROM:+0500", "TZOFFSETTO:+0500", "END:STANDARD", "END:VTIMEZONE",
];
slots = busy(zone, event("z", ["DTSTART;TZID=Custom Plus Five:20300320T100000", "DTEND;TZID=Custom Plus Five:20300320T113000"]));
assert.deepEqual(slots.map(span), ["2030-03-20T05:00/2030-03-20T06:30"]);
// …and it doesn't stay behind for the next file.
slots = busy(event("z2", ["DTSTART;TZID=Custom Plus Five:20300320T100000", "DTEND;TZID=Custom Plus Five:20300320T113000"]));
assert.deepEqual(slots.map(span), ["2030-03-20T10:00/2030-03-20T11:30"]);

// An old daily series is found in the period; a slot is cut at the period's edges.
slots = busy(event("daily", ["DTSTART:20200101T230000Z", "DTEND:20200102T010000Z", "RRULE:FREQ=DAILY"]));
assert.equal(slots.length, 91);
assert.equal(span(slots[0]), "2030-03-01T00:00/2030-03-01T01:00");
assert.equal(span(slots[90]), "2030-05-29T23:00/2030-05-30T00:00");

// Not a calendar at all.
assert.throws(() => busyFromCalendar("<html>Sign in</html>", from, to));

assert.equal(normalizeCalendarUrl(" webcal://example.com/a.ics "), "https://example.com/a.ics");
assert.equal(normalizeCalendarUrl("https://example.com/a.ics"), "https://example.com/a.ics");
console.log("calendar-external: ok");
