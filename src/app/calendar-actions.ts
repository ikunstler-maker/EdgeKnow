"use server";

import type { ActionResult } from "@/lib/action-result";
import type { BusySlot, CalendarEvent, CalendarSettings, CancelledEvent, EventAnswer, EventDetails, EventFields } from "@/lib/calendar";
import { dataClient, writeClient } from "@/lib/team-db/data";

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

export async function loadEvent(shortId: string, eventId: string): Promise<ActionResult<EventDetails>> {
  const db = await dataClient(shortId);
  const { data, error } = await db.rpc("calendar_event_details", { target: eventId });
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
