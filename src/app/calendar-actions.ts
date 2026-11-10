"use server";

import type { ActionResult } from "@/lib/action-result";
import type { BusySlot, CalendarEvent, CalendarSettings, CalendarTask, CancelledEvent, EventAnswer, EventChip, EventDetails, EventFields, EventHit } from "@/lib/calendar";

const isDay = (value: string | null | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
import { dataClient, workspaceData, writeClient } from "@/lib/team-db/data";

// Doba: who sees and changes what is decided by the database functions; these only
// forward to wherever the workspace keeps its data. No page re-render: the calendar
// reloads its own period after a change.

async function call<T extends object = object>(shortId: string, fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<T>;
}

const isIso = (value: string) => !Number.isNaN(Date.parse(value));

// The events of a period the person may see, and (for the organizer) the cancelled ones.
export async function loadCalendar(shortId: string, workspaceId: string, from: string, to: string): Promise<{ events: CalendarEvent[]; cancelled: CancelledEvent[] } | null> {
  if (!isIso(from) || !isIso(to)) return null;
  const db = await dataClient(shortId);
  const [{ data, error }, { data: cancelled }] = await Promise.all([
    db.rpc("calendar_events_in", { ws: workspaceId, range_from: from, range_to: to }),
    db
      .from("calendar_events")
      .select("id, title, starts_at, all_day, deleted_at, organizer_id, visibility")
      .eq("workspace_id", workspaceId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(30),
  ]);
  if (error) return null;
  return { events: (data ?? []) as CalendarEvent[], cancelled: (cancelled ?? []) as CancelledEvent[] };
}

// One event; for a series, the given day of it as it really is (moved, renamed, cancelled).
export async function loadEvent(shortId: string, eventId: string, occurrence: string | null = null): Promise<ActionResult<EventDetails>> {
  const db = await dataClient(shortId);
  let { data, error } = await db.rpc("calendar_event_details", isDay(occurrence) ? { target: eventId, occurrence } : { target: eventId });
  // A database a step behind the site doesn't know days of a series yet: the event itself.
  if (error && isDay(occurrence)) ({ data, error } = await db.rpc("calendar_event_details", { target: eventId }));
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<EventDetails>;
}

// When these people are busy: starts and ends only.
export async function loadBusy(shortId: string, workspaceId: string, people: string[], from: string, to: string): Promise<BusySlot[]> {
  if (!people.length || !isIso(from) || !isIso(to)) return [];
  const db = await dataClient(shortId);
  const { data } = await db.rpc("calendar_busy", { ws: workspaceId, people: people.slice(0, 50), range_from: from, range_to: to });
  return (data ?? []) as BusySlot[];
}

export async function createEvent(shortId: string, workspaceId: string, fields: EventFields, people: string[]) {
  return call<{ id: string }>(shortId, "create_calendar_event", { ws: workspaceId, fields, people });
}

export async function updateEvent(shortId: string, eventId: string, fields: EventFields, invite: string[], remove: string[]) {
  const saved = await call(shortId, "update_calendar_event", { target: eventId, fields });
  if (!saved.ok) return saved;
  for (const person of remove) {
    const removed = await call(shortId, "remove_calendar_event_attendee", { target: eventId, person });
    if (!removed.ok) return removed;
  }
  return invite.length ? call(shortId, "invite_to_calendar_event", { target: eventId, people: invite }) : saved;
}

// "Only this event": one day of a series gets its own time and texts.
export async function changeOccurrence(shortId: string, eventId: string, occurrence: string, fields: EventFields) {
  if (!isDay(occurrence)) return { ok: false as const, error: "invalid" };
  return call(shortId, "change_calendar_occurrence", { target: eventId, occurrence, fields });
}

// "This and the following": the old series ends the day before; a new one starts here.
export async function splitEvent(shortId: string, eventId: string, occurrence: string, fields: EventFields, invite: string[], remove: string[]) {
  if (!isDay(occurrence)) return { ok: false as const, error: "invalid" };
  const made = await call<{ id: string }>(shortId, "split_calendar_event", { target: eventId, occurrence, fields });
  if (!made.ok) return made;
  for (const person of remove) {
    const removed = await call(shortId, "remove_calendar_event_attendee", { target: made.id, person });
    if (!removed.ok) return removed;
  }
  if (invite.length) {
    const invited = await call(shortId, "invite_to_calendar_event", { target: made.id, people: invite });
    if (!invited.ok) return invited;
  }
  return made;
}

export async function cancelOccurrence(shortId: string, eventId: string, occurrence: string, restore = false) {
  if (!isDay(occurrence)) return { ok: false as const, error: "invalid" };
  return call(shortId, "cancel_calendar_occurrence", { target: eventId, occurrence, restore });
}

// The series ends before this day (the day and all after it are gone).
export async function endSeries(shortId: string, eventId: string, occurrence: string) {
  if (!isDay(occurrence)) return { ok: false as const, error: "invalid" };
  return call(shortId, "end_calendar_series", { target: eventId, occurrence });
}

// Rukh tasks with a due date in a period — exactly those the person may read in Rukh.
export async function loadCalendarTasks(shortId: string, workspaceId: string, from: string, to: string, onlyMine: boolean): Promise<CalendarTask[]> {
  if (!isDay(from) || !isDay(to)) return [];
  const db = await dataClient(shortId);
  const { data } = await db.rpc("calendar_tasks", { ws: workspaceId, first_day: from, last_day: to, only_mine: onlyMine });
  return (data ?? []) as CalendarTask[];
}

// A whole unit is invited: its people and those of the units under it.
export async function inviteUnit(shortId: string, eventId: string, unit: string) {
  return call<{ added: number }>(shortId, "invite_unit_to_calendar_event", { target: eventId, unit });
}

// Whoever joined the invited units since is invited too.
export async function refreshEventUnits(shortId: string, eventId: string) {
  return call<{ added: number }>(shortId, "refresh_calendar_event_units", { target: eventId });
}

// The units invited to an event (the organizer's own view; others get an empty list).
export async function loadEventUnits(shortId: string, eventId: string): Promise<string[]> {
  const db = await dataClient(shortId);
  const { data } = await db.from("calendar_events").select("invited_group_ids").eq("id", eventId).maybeSingle();
  return ((data?.invited_group_ids as string[] | undefined) ?? []);
}

// Search and chips: only events the person sees.
export async function searchEvents(shortId: string, query: string): Promise<EventHit[]> {
  const workspace = await workspaceData(shortId);
  if (!workspace) return [];
  const { data } = await workspace.client.rpc("search_calendar_events", { ws: workspace.workspaceId, query: query.trim().slice(0, 200) });
  return (data ?? []) as EventHit[];
}

export async function eventChips(shortId: string, ids: string[]): Promise<EventChip[]> {
  const wanted = ids.filter((id) => /^[0-9a-f-]{36}$/.test(id)).slice(0, 200);
  if (!wanted.length) return [];
  const db = await dataClient(shortId);
  const { data } = await db.rpc("calendar_event_chips", { ids: wanted });
  return (data ?? []) as EventChip[];
}

export async function respondToEvent(shortId: string, eventId: string, answer: EventAnswer) {
  return call<{ status: string | null }>(shortId, "respond_to_calendar_event", { target: eventId, answer });
}

export async function decideEventRequest(shortId: string, eventId: string, person: string, approve: boolean) {
  return call(shortId, "decide_calendar_event_request", { target: eventId, person, approve });
}

export async function cancelEvent(shortId: string, eventId: string, restore = false) {
  return call(shortId, "cancel_calendar_event", { target: eventId, restore });
}

export async function saveCalendarSettings(shortId: string, workspaceId: string, settings: CalendarSettings) {
  return call(shortId, "set_calendar_settings", { ws: workspaceId, new_work_days: settings.work_days, new_time_zone: settings.time_zone });
}
