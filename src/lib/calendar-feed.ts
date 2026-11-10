// Doba, phase 3a: a person's calendar feed in the common calendar-file format, so any
// calendar app can subscribe to it. Pure text building: no access decisions here.

export type FeedEvent = {
  id: string;
  title: string;
  location: string;
  meeting_url: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  updated_at: string;
  occurrence: string | null;
  status: string;
};
export type FeedLeave = { id: string; name: string; start_date: string; end_date: string; updated_at: string };
export type FeedData = { events: FeedEvent[]; leave: FeedLeave[] };

export const FEED_PATH = "/api/calendar-feed";
export const isFeedToken = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);

const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lines are at most 75 bytes; a longer one continues on the next line after a space.
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const dateOnly = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export function buildFeed(data: FeedData, options: { name: string; host: string; now?: Date }): string {
  const now = stamp((options.now ?? new Date()).toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EdgeKnow//Doba//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of data.events) {
    lines.push("BEGIN:VEVENT", `UID:${event.id}${event.occurrence ? `-${event.occurrence}` : ""}@${options.host}`, `DTSTAMP:${now}`, `LAST-MODIFIED:${stamp(event.updated_at)}`);
    if (event.all_day) lines.push(`DTSTART;VALUE=DATE:${dateOnly(event.starts_at)}`, `DTEND;VALUE=DATE:${dateOnly(event.ends_at)}`);
    else lines.push(`DTSTART:${stamp(event.starts_at)}`, `DTEND:${stamp(event.ends_at)}`);
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.meeting_url) lines.push(`URL:${event.meeting_url}`, `DESCRIPTION:${escapeText(event.meeting_url)}`);
    lines.push(`STATUS:${event.status === "accepted" ? "CONFIRMED" : "TENTATIVE"}`, "END:VEVENT");
  }
  for (const leave of data.leave) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:leave-${leave.id}@${options.host}`,
      `DTSTAMP:${now}`,
      `LAST-MODIFIED:${stamp(leave.updated_at)}`,
      `DTSTART;VALUE=DATE:${dateOnly(leave.start_date)}`,
      `DTEND;VALUE=DATE:${dateOnly(nextDay(leave.end_date))}`,
      `SUMMARY:${escapeText(leave.name)}`,
      "TRANSP:OPAQUE",
      "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
