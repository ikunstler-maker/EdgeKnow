"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dateLocale, t } from "@/i18n";
import { cancelEvent, createEvent, decideEventRequest, loadBusy, loadEvent, respondToEvent, updateEvent } from "@/app/calendar-actions";
import {
  DAY_MS,
  EVENT_VISIBILITIES,
  allDayEnd,
  allDayKeys,
  allDayStart,
  browserTimeZone,
  dayKey,
  eventSpan,
  fromZonedInput,
  isMeetingUrl,
  timeZones,
  toZonedInput,
  type BusySlot,
  type CalendarPerson,
  type EventAnswer,
  type EventDetails,
  type EventFields,
  type EventVisibility,
} from "@/lib/calendar";
import { PeoplePicker, buttonClass, inputClass, primaryClass } from "./calendar-parts";

const c = t.calendar;

export type DialogState = { mode: "details"; id: string } | { mode: "new"; start: string; allDay?: boolean } | { mode: "edit"; details: EventDetails };

const errorText = (code: string) => c.errors[code] ?? c.errors.unknown;
const LISTED = ["invited", "accepted", "tentative", "declined"];

function whenText(event: { starts_at: string; ends_at: string; all_day: boolean }) {
  const locale = dateLocale();
  const { start, end } = eventSpan(event);
  const date = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  if (event.all_day) {
    const last = new Date(end.getTime() - DAY_MS);
    return dayKey(start) === dayKey(last) ? `${date.format(start)} · ${c.allDay}` : `${date.format(start)} – ${date.format(last)}`;
  }
  return dayKey(start) === dayKey(end) ? `${date.format(start)}, ${time.format(start)} – ${time.format(end)}` : `${date.format(start)}, ${time.format(start)} – ${date.format(end)}, ${time.format(end)}`;
}

function Shell({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose} data-event-backdrop>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-xl bg-background p-4 shadow-xl sm:rounded-xl"
        data-event-dialog
      >
        {children}
      </div>
    </div>
  );
}

export function EventDialog({
  shortId,
  workspaceId,
  me,
  guest,
  people,
  defaultZone,
  state,
  onState,
  onChanged,
}: {
  shortId: string;
  workspaceId: string;
  me: string;
  guest: boolean;
  people: CalendarPerson[];
  defaultZone: string;
  state: DialogState;
  onState: (state: DialogState | null) => void;
  onChanged: () => void;
}) {
  if (state.mode === "details") {
    return <EventView shortId={shortId} me={me} guest={guest} id={state.id} onEdit={(details) => onState({ mode: "edit", details })} onClose={() => onState(null)} onChanged={onChanged} />;
  }
  return (
    <EventForm
      shortId={shortId}
      workspaceId={workspaceId}
      me={me}
      people={people}
      defaultZone={defaultZone}
      state={state}
      onClose={() => onState(state.mode === "edit" ? { mode: "details", id: state.details.event.id } : null)}
      onSaved={(id) => {
        onChanged();
        onState(state.mode === "edit" ? { mode: "details", id } : null);
      }}
    />
  );
}

function EventView({
  shortId,
  me,
  guest,
  id,
  onEdit,
  onClose,
  onChanged,
}: {
  shortId: string;
  me: string;
  guest: boolean;
  id: string;
  onEdit: (details: EventDetails) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [details, setDetails] = useState<EventDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const d = c.details;

  useEffect(() => {
    let live = true;
    loadEvent(shortId, id).then((result) => {
      if (!live) return;
      if (result.ok) setDetails(result);
      else setError(result.error === "forbidden" ? d.noAccess : errorText(result.error));
    });
    return () => {
      live = false;
    };
  }, [shortId, id, tick, d.noAccess]);

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>, close = false) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error ?? "unknown"));
    setError(null);
    onChanged();
    if (close) onClose();
    else setTick((n) => n + 1);
  };
  const answer = (value: EventAnswer) => run(() => respondToEvent(shortId, id, value));

  if (!details) {
    return (
      <Shell label={c.title} onClose={onClose}>
        <p className={error ? "text-danger" : "text-muted"}>{error ?? c.loading}</p>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className={buttonClass}>
            {c.form.close}
          </button>
        </div>
      </Shell>
    );
  }

  const { event, attendees, my_status: mine } = details;
  const organizer = attendees.find((a) => a.id === event.organizer_id);
  const iOrganize = event.organizer_id === me;
  const listed = attendees.filter((a) => LISTED.includes(a.status));
  const requests = attendees.filter((a) => a.status === "requested" && a.id !== me);
  const zone = browserTimeZone();
  const otherZone = !event.all_day && event.time_zone !== zone;
  const answers: { value: EventAnswer; label: string }[] = [
    { value: "accepted", label: d.going },
    { value: "tentative", label: d.maybe },
    { value: "declined", label: d.notGoing },
  ];

  return (
    <Shell label={event.title} onClose={onClose}>
      <div className="flex items-start gap-2">
        <h2 className={`min-w-0 flex-1 break-words text-xl font-semibold ${event.cancelled ? "text-muted line-through" : ""}`} data-event-title>
          {event.title}
        </h2>
        <button type="button" onClick={onClose} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-surface md:h-9 md:w-9" aria-label={c.form.close}>
          ✕
        </button>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs" title={c.kindHints[event.visibility]} data-event-kind={event.visibility}>
          {c.kinds[event.visibility]}
        </span>
        {event.cancelled && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs text-danger">{d.cancelled}</span>}
      </p>
      <p className="mt-3 first-letter:uppercase" data-event-when>
        🕑 {whenText(event)}
      </p>
      {otherZone && (
        <p className="text-xs text-muted">
          {d.zoneNote(toZonedInput(event.starts_at, event.time_zone).slice(11), event.time_zone)}
        </p>
      )}
      {event.location && <p className="mt-2 break-words">📍 {event.location}</p>}
      {event.meeting_url && (
        <p className="mt-2">
          <a href={event.meeting_url} target="_blank" rel="noopener noreferrer" className={primaryClass}>
            🎥 {d.joinMeeting}
          </a>
        </p>
      )}
      {event.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{event.description}</p>}

      {!event.cancelled && !iOrganize && (
        <div className="mt-4 rounded-lg border border-border p-3" data-my-answer={mine ?? "none"}>
          {mine && LISTED.includes(mine) ? (
            <>
              <p className="text-sm text-muted">{d.yourAnswer}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {answers.map((a) => (
                  <button key={a.value} type="button" disabled={busy} onClick={() => answer(a.value)} aria-pressed={mine === a.value} className={mine === a.value ? primaryClass : buttonClass} data-answer={a.value}>
                    {a.label}
                  </button>
                ))}
              </div>
            </>
          ) : mine === "requested" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 text-sm">{d.requestSent}</p>
              <button type="button" disabled={busy} onClick={() => answer("declined")} className={buttonClass}>
                {d.withdraw}
              </button>
            </div>
          ) : mine === "rejected" ? (
            <p className="text-sm text-muted">{d.requestRejected}</p>
          ) : guest ? (
            <p className="text-sm text-muted">{c.kindHints[event.visibility]}</p>
          ) : event.visibility === "open" ? (
            <button type="button" disabled={busy} onClick={() => answer("accepted")} className={primaryClass} data-join>
              {d.join}
            </button>
          ) : event.visibility === "request" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 text-sm text-muted">{c.kindHints.request}</p>
              <button type="button" disabled={busy} onClick={() => answer("accepted")} className={primaryClass} data-ask-to-join>
                {d.askToJoin}
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">{c.kindHints[event.visibility]}</p>
          )}
        </div>
      )}

      {requests.length > 0 && (
        <section className="mt-4" data-requests>
          <h3 className="text-sm font-medium">{d.requests}</h3>
          <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
            {requests.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <button type="button" disabled={busy} onClick={() => run(() => decideEventRequest(shortId, id, a.id, true))} className={primaryClass} data-approve={a.name}>
                  {d.approve}
                </button>
                <button type="button" disabled={busy} onClick={() => run(() => decideEventRequest(shortId, id, a.id, false))} className={buttonClass} data-reject={a.name}>
                  {d.reject}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-4">
        <h3 className="text-sm font-medium">
          {d.people} · {listed.length}
        </h3>
        <ul className="mt-1 text-sm" data-attendees>
          {listed.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-1" data-attendee={a.name} data-status={a.status}>
              <span className="min-w-0 flex-1 truncate">
                {a.name}
                {a.id === organizer?.id && <span className="text-muted"> · {d.organizer}</span>}
              </span>
              <span className="text-xs text-muted">{d.status[a.status]}</span>
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {details.can_cancel && !event.cancelled && (
          <button type="button" disabled={busy} onClick={() => confirm(d.cancelConfirm) && run(() => cancelEvent(shortId, id), true)} className={`${buttonClass} mr-auto text-danger`} data-cancel-event>
            {d.cancelEvent}
          </button>
        )}
        {details.can_cancel && event.cancelled && (
          <button type="button" disabled={busy} onClick={() => run(() => cancelEvent(shortId, id, true))} className={`${buttonClass} mr-auto`}>
            {c.restore}
          </button>
        )}
        {details.can_edit && !event.cancelled && (
          <button type="button" onClick={() => onEdit(details)} className={buttonClass} data-edit-event>
            {d.edit}
          </button>
        )}
        <button type="button" onClick={onClose} className={buttonClass}>
          {c.form.close}
        </button>
      </div>
    </Shell>
  );
}

function EventForm({
  shortId,
  workspaceId,
  me,
  people,
  defaultZone,
  state,
  onClose,
  onSaved,
}: {
  shortId: string;
  workspaceId: string;
  me: string;
  people: CalendarPerson[];
  defaultZone: string;
  state: Extract<DialogState, { mode: "new" | "edit" }>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const f = c.form;
  const editing = state.mode === "edit" ? state.details : null;
  const initial = useMemo(() => {
    if (editing) {
      const e = editing.event;
      const keys = allDayKeys(e);
      const zone = e.time_zone;
      return {
        title: e.title,
        description: e.description,
        location: e.location,
        link: e.meeting_url ?? "",
        allDay: e.all_day,
        zone,
        start: e.all_day ? `${keys.first}T09:00` : toZonedInput(e.starts_at, zone),
        end: e.all_day ? `${keys.first}T10:00` : toZonedInput(e.ends_at, zone),
        firstDay: e.all_day ? keys.first : toZonedInput(e.starts_at, zone).slice(0, 10),
        lastDay: e.all_day ? keys.last : toZonedInput(e.ends_at, zone).slice(0, 10),
        visibility: e.visibility,
        people: editing.attendees.filter((a) => LISTED.includes(a.status) && a.id !== e.organizer_id).map((a) => a.id),
      };
    }
    const zone = browserTimeZone() || defaultZone;
    const from = new Date(state.mode === "new" ? state.start : 0);
    const start = toZonedInput(from.toISOString(), zone);
    return {
      title: "",
      description: "",
      location: "",
      link: "",
      allDay: state.mode === "new" && !!state.allDay,
      zone,
      start,
      end: toZonedInput(new Date(from.getTime() + 3_600_000).toISOString(), zone),
      firstDay: dayKey(from),
      lastDay: dayKey(from),
      visibility: "open" as EventVisibility,
      people: [] as string[],
    };
  }, [editing, state, defaultZone]);

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [location, setLocation] = useState(initial.location);
  const [link, setLink] = useState(initial.link);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [zone, setZone] = useState(initial.zone);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [firstDay, setFirstDay] = useState(initial.firstDay);
  const [lastDay, setLastDay] = useState(initial.lastDay);
  const [visibility, setVisibility] = useState<EventVisibility>(initial.visibility);
  const [invited, setInvited] = useState<string[]>(initial.people);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<BusySlot[]>([]);
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => titleInput.current?.focus(), []);
  const zones = useMemo(() => timeZones([initial.zone, browserTimeZone(), defaultZone]), [initial.zone, defaultZone]);

  const startsAt = allDay ? (firstDay ? allDayStart(firstDay) : null) : fromZonedInput(start, zone);
  const endsAt = allDay ? (lastDay ? allDayEnd(lastDay) : null) : fromZonedInput(end, zone);
  const timeOk = !!startsAt && !!endsAt && Date.parse(endsAt) > Date.parse(startsAt) && Date.parse(endsAt) - Date.parse(startsAt) <= 31 * DAY_MS;
  const linkOk = isMeetingUrl(link.trim());

  // Moving the start keeps the length.
  const changeStart = (value: string) => {
    const before = fromZonedInput(start, zone);
    const after = fromZonedInput(value, zone);
    const until = fromZonedInput(end, zone);
    setStart(value);
    if (before && after && until) setEnd(toZonedInput(new Date(Date.parse(until) + Date.parse(after) - Date.parse(before)).toISOString(), zone));
  };

  // Who of the invited (and I) is busy then: times only, also for events hidden from me.
  const watched = useMemo(() => [me, ...invited].slice(0, 50), [me, invited]);
  useEffect(() => {
    if (!timeOk || !startsAt || !endsAt) return;
    let live = true;
    const timer = setTimeout(() => {
      loadBusy(shortId, workspaceId, watched, startsAt, endsAt).then((slots) => {
        // The event being edited is in the answer too: it is not a clash with itself.
        const own = editing ? `${Date.parse(editing.event.starts_at)}|${Date.parse(editing.event.ends_at)}` : null;
        if (live) setConflicts(slots.filter((s) => `${Date.parse(s.starts_at)}|${Date.parse(s.ends_at)}` !== own));
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [shortId, workspaceId, watched, startsAt, endsAt, timeOk, editing]);
  const shownConflicts = timeOk ? conflicts : [];

  const dirty = title !== initial.title || description !== initial.description || location !== initial.location || link !== initial.link;
  const close = () => {
    if (!dirty || confirm(f.discard)) onClose();
  };

  const submit = async () => {
    if (!title.trim()) return setError(c.errors.bad_title);
    if (!timeOk || !startsAt || !endsAt) return setError(c.errors.bad_time);
    if (!linkOk) return setError(c.errors.bad_link);
    const fields: EventFields = { title: title.trim(), description, location: location.trim(), meeting_url: link.trim(), starts_at: startsAt, ends_at: endsAt, all_day: allDay, time_zone: allDay ? "UTC" : zone, visibility };
    setSaving(true);
    if (editing) {
      const result = await updateEvent(
        shortId,
        editing.event.id,
        fields,
        invited.filter((id) => !initial.people.includes(id)),
        initial.people.filter((id) => !invited.includes(id)),
      );
      setSaving(false);
      if (!result.ok) return setError(errorText(result.error));
      return onSaved(editing.event.id);
    }
    const result = await createEvent(shortId, workspaceId, fields, invited);
    setSaving(false);
    if (!result.ok) return setError(errorText(result.error));
    onSaved(result.id);
  };

  const time = new Intl.DateTimeFormat(dateLocale(), { hour: "2-digit", minute: "2-digit" });
  const nameOf = (id: string) => (id === me ? f.you : (people.find((p) => p.id === id)?.name ?? "—"));

  return (
    <Shell label={editing ? f.editTitle : f.newTitle} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-3"
        data-event-form
      >
        <h2 className="text-lg font-semibold">{editing ? f.editTitle : f.newTitle}</h2>
        <input ref={titleInput} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={f.titlePlaceholder} aria-label={f.title} className={`${inputClass} font-medium`} data-event-field="title" />

        <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-5 w-5" data-event-field="all_day" />
          {f.allDay}
        </label>
        {allDay ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-muted">{f.firstDay}</span>
              <input
                type="date"
                value={firstDay}
                onChange={(e) => {
                  setFirstDay(e.target.value);
                  if (e.target.value > lastDay) setLastDay(e.target.value);
                }}
                className={`${inputClass} mt-1`}
                data-event-field="first_day"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">{f.lastDay}</span>
              <input type="date" value={lastDay} min={firstDay} onChange={(e) => setLastDay(e.target.value)} className={`${inputClass} mt-1`} data-event-field="last_day" />
            </label>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-muted">{f.start}</span>
                <input type="datetime-local" value={start} onChange={(e) => changeStart(e.target.value)} className={`${inputClass} mt-1`} data-event-field="start" />
              </label>
              <label className="block text-sm">
                <span className="text-muted">{f.end}</span>
                <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={`${inputClass} mt-1`} data-event-field="end" />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-muted">{f.timeZone}</span>
              <select value={zone} onChange={(e) => setZone(e.target.value)} className={`${inputClass} mt-1`} data-event-field="time_zone">
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {!timeOk && <p className="text-sm text-danger">{c.errors.bad_time}</p>}

        <label className="block text-sm">
          <span className="text-muted">{f.kind}</span>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as EventVisibility)} className={`${inputClass} mt-1`} data-event-field="visibility">
            {EVENT_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {c.kinds[v]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">{c.kindHints[visibility]}</span>
        </label>

        <PeoplePicker label={f.people} people={people.filter((p) => p.id !== me)} picked={invited} onChange={setInvited} />
        {shownConflicts.length > 0 && (
          <div className="rounded-md border border-danger/40 bg-danger/5 p-2 text-sm" data-conflicts>
            <p className="font-medium">{f.conflicts}</p>
            <ul className="mt-1 text-xs">
              {shownConflicts.slice(0, 8).map((slot, i) => (
                <li key={i}>
                  {nameOf(slot.user_id)} · {slot.all_day ? c.allDay : `${time.format(new Date(slot.starts_at))} – ${time.format(new Date(slot.ends_at))}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="block text-sm">
          <span className="text-muted">{f.location}</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} className={`${inputClass} mt-1`} data-event-field="location" />
        </label>
        <label className="block text-sm">
          <span className="text-muted">{f.link}</span>
          <input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} placeholder="https://" className={`${inputClass} mt-1`} data-event-field="link" />
          {!linkOk && <span className="mt-1 block text-xs text-danger">{c.errors.bad_link}</span>}
        </label>
        <label className="block text-sm">
          <span className="text-muted">{f.description}</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} rows={3} className={`${inputClass} mt-1 py-2`} data-event-field="description" />
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={buttonClass}>
            {f.cancel}
          </button>
          <button type="submit" disabled={saving || !title.trim() || !timeOk || !linkOk} className={primaryClass} data-save-event>
            {editing ? f.save : f.create}
          </button>
        </div>
      </form>
    </Shell>
  );
}
