"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dateLocale, t } from "@/i18n";
import {
  cancelEvent,
  cancelOccurrence,
  changeOccurrence,
  createEvent,
  decideEventRequest,
  endSeries,
  inviteUnit,
  loadBusy,
  loadEvent,
  loadEventUnits,
  refreshEventUnits,
  respondToEvent,
  splitEvent,
  updateEvent,
} from "@/app/calendar-actions";
import {
  DAY_MS,
  EVENT_VISIBILITIES,
  REMINDERS,
  REPEAT_FREQS,
  allDayEnd,
  allDayKeys,
  allDayStart,
  browserTimeZone,
  dayKey,
  eventSpan,
  fromDayKey,
  fromZonedInput,
  isMeetingUrl,
  timeZones,
  toZonedInput,
  weekdayOf,
  type BusySlot,
  type CalendarPerson,
  type CalendarUnit,
  type EventAnswer,
  type EventDetails,
  type EventFields,
  type EventVisibility,
  type RepeatFreq,
  type RepeatRule,
  type SeriesScope,
} from "@/lib/calendar";
import { PeoplePicker, buttonClass, inputClass, primaryClass } from "./calendar-parts";
import { Icon } from "@/components/ui/icon";

const c = t.calendar;

export type DialogState =
  | { mode: "details"; id: string; occurrence?: string | null }
  // `end`: what a drag on the grid picked (for whole days — the last day).
  | { mode: "new"; start: string; end?: string; allDay?: boolean }
  // For a series: which of its days the change is for.
  | { mode: "edit"; details: EventDetails; scope: SeriesScope };

const errorText = (code: string) => c.errors[code] ?? c.errors.unknown;
const LISTED = ["invited", "accepted", "tentative", "declined"];
const SCOPES: SeriesScope[] = ["one", "following", "all"];

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

// "Every 2 weeks on Mon, Wed until 23 Jan 2030".
export function repeatText(rule: RepeatRule & { last_day?: string | null }) {
  const r = c.repeat;
  const days = rule.freq === "weekly" && rule.days.length ? ` ${r.onDays([...rule.days].sort().map((d) => t.calendar.settings.days[d - 1]).join(", "))}` : "";
  const last = rule.until ?? rule.last_day ?? null;
  const end = rule.count ? ` · ${r.times(rule.count)}` : last ? ` · ${r.untilDay(new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(fromDayKey(last)))}` : "";
  return `${r.every(rule.freq, rule.interval)}${days}${end}`;
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

// "Only this event / this and the following / all": asked before changing or cancelling a day of a series.
function ScopeChoice({ title, labels, firstDay, onPick, onBack }: { title: string; labels: Record<string, string>; firstDay: boolean; onPick: (scope: SeriesScope) => void; onBack: () => void }) {
  return (
    <div className="mt-4 rounded-lg border border-border p-3" data-series-scope>
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-2 flex flex-col gap-2">
        {/* From the first day on, "this and the following" is the whole series. */}
        {SCOPES.filter((scope) => !(firstDay && scope === "following")).map((scope) => (
          <button key={scope} type="button" onClick={() => onPick(scope)} className={`${buttonClass} justify-start`} data-scope={scope}>
            {labels[scope]}
          </button>
        ))}
        <button type="button" onClick={onBack} className="min-h-11 text-left text-sm text-muted hover:text-foreground md:min-h-9">
          {c.form.cancel}
        </button>
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
  units,
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
  units: CalendarUnit[];
  defaultZone: string;
  state: DialogState;
  onState: (state: DialogState | null) => void;
  onChanged: () => void;
}) {
  if (state.mode === "details") {
    return (
      <EventView
        shortId={shortId}
        me={me}
        guest={guest}
        id={state.id}
        occurrence={state.occurrence ?? null}
        units={units}
        onEdit={(details, scope) => onState({ mode: "edit", details, scope })}
        onClose={() => onState(null)}
        onChanged={onChanged}
      />
    );
  }
  return (
    <EventForm
      shortId={shortId}
      workspaceId={workspaceId}
      me={me}
      people={people}
      units={units}
      defaultZone={defaultZone}
      state={state}
      onClose={() => onState(state.mode === "edit" ? { mode: "details", id: state.details.event.id, occurrence: state.details.series?.occurrence ?? null } : null)}
      onSaved={() => {
        onChanged();
        // The days of a series may have moved or split: back to the calendar.
        onState(null);
      }}
    />
  );
}

function EventView({
  shortId,
  me,
  guest,
  id,
  occurrence,
  units,
  onEdit,
  onClose,
  onChanged,
}: {
  shortId: string;
  me: string;
  guest: boolean;
  id: string;
  occurrence: string | null;
  units: CalendarUnit[];
  onEdit: (details: EventDetails, scope: SeriesScope) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [details, setDetails] = useState<EventDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [asking, setAsking] = useState<"edit" | "cancel" | null>(null);
  // Units invited as a whole (the organizer sees them and can bring in who joined since).
  const [invitedUnits, setInvitedUnits] = useState<string[]>([]);
  const [unitNote, setUnitNote] = useState<string | null>(null);
  const d = c.details;

  useEffect(() => {
    let live = true;
    loadEvent(shortId, id, occurrence).then((result) => {
      if (!live) return;
      if (result.ok && result.can_edit) loadEventUnits(shortId, id).then((list) => live && setInvitedUnits(list));
      if (result.ok) setDetails(result);
      else setError(result.error === "forbidden" || result.error === "not_found" ? d.noAccess : errorText(result.error));
    });
    return () => {
      live = false;
    };
  }, [shortId, id, occurrence, tick, d.noAccess]);

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
  const series = details.series ?? null;
  // A day of a series the calendar opened; without one (a link from a notification) changes are for the whole series.
  const day = series?.occurrence ?? null;
  const firstDay = !!series && !!day && day <= toZonedInput(series.starts_at, event.time_zone).slice(0, 10);
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
  const cancel = (scope: SeriesScope) => {
    if (scope === "one" && day) return run(() => cancelOccurrence(shortId, id, day), true);
    if (scope === "following" && day) return run(() => endSeries(shortId, id, day), true);
    return run(() => cancelEvent(shortId, id), true);
  };

  return (
    <Shell label={event.title} onClose={onClose}>
      <div className="flex items-start gap-2">
        <h2 className={`min-w-0 flex-1 break-words text-xl font-semibold ${event.cancelled ? "text-muted line-through" : ""}`} data-event-title>
          {event.title}
        </h2>
        <button type="button" onClick={onClose} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-surface md:h-9 md:w-9" aria-label={c.form.close}>
          <Icon name="close" />
        </button>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs" title={c.kindHints[event.visibility]} data-event-kind={event.visibility}>
          {c.kinds[event.visibility]}
        </span>
        {event.cancelled && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs text-danger">{d.cancelled}</span>}
        {series?.changed && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{c.repeat.dayChanged}</span>}
      </p>
      <p className="mt-3 first-letter:uppercase" data-event-when>
        <Icon name="clock" className="mr-1 inline" />
        {whenText(event)}
      </p>
      {otherZone && <p className="text-xs text-muted">{d.zoneNote(toZonedInput(event.starts_at, event.time_zone).slice(11), event.time_zone)}</p>}
      {series && (
        <p className="mt-1 text-sm text-muted" data-event-repeat>
          <Icon name="refresh" className="mr-1 inline" />
          {repeatText(series)}
        </p>
      )}
      {event.reminder_minutes ? <p className="mt-1 text-sm text-muted"><Icon name="bell" className="mr-1.5 inline" />{c.reminder.options[String(event.reminder_minutes)]}</p> : null}
      {event.location && <p className="mt-2 break-words">
              <Icon name="pin" className="mr-1 inline text-muted" />
              {event.location}
            </p>}
      {event.meeting_url && (
        <p className="mt-2">
          <a href={event.meeting_url} target="_blank" rel="noopener noreferrer" className={primaryClass}>
            <Icon name="play" className="mr-1 inline" />
            {d.joinMeeting}
          </a>
        </p>
      )}
      {event.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{event.description}</p>}

      {!event.cancelled && !iOrganize && (
        <div className="mt-4 rounded-lg border border-border p-3" data-my-answer={mine ?? "none"}>
          {mine && LISTED.includes(mine) ? (
            <>
              <p className="text-sm text-muted">{series ? d.yourAnswerSeries : d.yourAnswer}</p>
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

      {details.can_edit && !event.cancelled && invitedUnits.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" data-event-units>
          <p className="min-w-0 flex-1 text-muted">
            {d.units}:{" "}
            {invitedUnits
              .map((unit) => units.find((u) => u.id === unit)?.name)
              .filter(Boolean)
              .join("; ")}
            {unitNote ? ` · ${unitNote}` : ""}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const result = await refreshEventUnits(shortId, id);
              setBusy(false);
              if (!result.ok) return setError(errorText(result.error));
              setUnitNote(d.unitsAdded(result.added));
              onChanged();
              setTick((n) => n + 1);
            }}
            className={buttonClass}
            data-refresh-units
          >
            {d.refreshUnits}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {asking === "edit" && <ScopeChoice title={c.repeat.changeWhat} labels={c.repeat.scopes} firstDay={firstDay} onPick={(scope) => onEdit(details, scope)} onBack={() => setAsking(null)} />}
      {asking === "cancel" && (
        <ScopeChoice
          title={c.repeat.cancelWhat}
          labels={c.repeat.scopes}
          firstDay={firstDay}
          onPick={(scope) => {
            setAsking(null);
            cancel(scope);
          }}
          onBack={() => setAsking(null)}
        />
      )}
      {!asking && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {details.can_cancel && !event.cancelled && (
            <button
              type="button"
              disabled={busy}
              onClick={() => (series && day ? setAsking("cancel") : confirm(series ? d.cancelSeriesConfirm : d.cancelConfirm) && cancel("all"))}
              className={`${buttonClass} mr-auto text-danger`}
              data-cancel-event
            >
              {d.cancelEvent}
            </button>
          )}
          {details.can_cancel && series?.day_cancelled && day && (
            <button type="button" disabled={busy} onClick={() => run(() => cancelOccurrence(shortId, id, day, true))} className={`${buttonClass} mr-auto`} data-restore-day>
              {c.restore}
            </button>
          )}
          {details.can_cancel && event.cancelled && !series?.day_cancelled && (
            <button type="button" disabled={busy} onClick={() => run(() => cancelEvent(shortId, id, true))} className={`${buttonClass} mr-auto`}>
              {c.restore}
            </button>
          )}
          {details.can_edit && !event.cancelled && (
            <button type="button" onClick={() => (series && day ? setAsking("edit") : onEdit(details, "all"))} className={buttonClass} data-edit-event>
              {d.edit}
            </button>
          )}
          <button type="button" onClick={onClose} className={buttonClass}>
            {c.form.close}
          </button>
        </div>
      )}
    </Shell>
  );
}

type EndKind = "never" | "until" | "count";

function EventForm({
  shortId,
  workspaceId,
  me,
  people,
  units,
  defaultZone,
  state,
  onClose,
  onSaved,
}: {
  shortId: string;
  workspaceId: string;
  me: string;
  people: CalendarPerson[];
  units: CalendarUnit[];
  defaultZone: string;
  state: Extract<DialogState, { mode: "new" | "edit" }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const f = c.form;
  const r = c.repeat;
  const editing = state.mode === "edit" ? state.details : null;
  const series = editing?.series ?? null;
  // One day of a series: only its own time and texts change.
  const scope: SeriesScope = state.mode === "edit" && series ? state.scope : "all";
  const oneDay = scope === "one";
  const initial = useMemo(() => {
    if (editing) {
      // "All": the series as it is kept (its first day and own texts); otherwise the opened day.
      const whole = scope === "all" && series;
      const e = whole ? { ...editing.event, starts_at: series.starts_at, ends_at: series.ends_at, title: series.title, description: series.description, location: series.location, meeting_url: series.meeting_url } : editing.event;
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
        freq: (series?.freq ?? "") as "" | RepeatFreq,
        interval: series?.interval ?? 1,
        days: series?.days ?? [],
        endKind: (series?.count ? "count" : series?.until ? "until" : "never") as EndKind,
        until: series?.until ?? "",
        count: series?.count ?? 10,
        reminder: editing.event.reminder_minutes ?? 0,
      };
    }
    const zone = browserTimeZone() || defaultZone;
    const from = new Date(state.mode === "new" ? state.start : 0);
    const picked = state.mode === "new" && state.end ? new Date(state.end) : null;
    const wholeDay = state.mode === "new" && !!state.allDay;
    const start = toZonedInput(from.toISOString(), zone);
    return {
      title: "",
      description: "",
      location: "",
      link: "",
      allDay: state.mode === "new" && !!state.allDay,
      zone,
      start,
      end: toZonedInput((picked && !wholeDay ? picked : new Date(from.getTime() + 3_600_000)).toISOString(), zone),
      firstDay: dayKey(from),
      lastDay: dayKey(picked && wholeDay ? picked : from),
      visibility: "open" as EventVisibility,
      people: [] as string[],
      freq: "" as "" | RepeatFreq,
      interval: 1,
      days: [] as number[],
      endKind: "never" as EndKind,
      until: "",
      count: 10,
      reminder: 10,
    };
  }, [editing, series, scope, state, defaultZone]);

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
  // Whole units to invite when the event is saved.
  const [addUnits, setAddUnits] = useState<string[]>([]);
  const [freq, setFreq] = useState<"" | RepeatFreq>(initial.freq);
  const [interval, setIntervalCount] = useState(initial.interval);
  const [days, setDays] = useState<number[]>(initial.days);
  const [endKind, setEndKind] = useState<EndKind>(initial.endKind);
  const [until, setUntil] = useState(initial.until);
  const [count, setCount] = useState(initial.count);
  const [reminder, setReminder] = useState(initial.reminder);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<BusySlot[]>([]);
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => titleInput.current?.focus(), []);
  const zones = useMemo(() => timeZones([initial.zone, browserTimeZone(), defaultZone]), [initial.zone, defaultZone]);

  const startsAt = allDay ? (firstDay ? allDayStart(firstDay) : null) : fromZonedInput(start, zone);
  const endsAt = allDay ? (lastDay ? allDayEnd(lastDay) : null) : fromZonedInput(end, zone);
  const length = startsAt && endsAt ? Date.parse(endsAt) - Date.parse(startsAt) : 0;
  const timeOk = !!startsAt && !!endsAt && length > 0 && length <= 31 * DAY_MS;
  const linkOk = isMeetingUrl(link.trim());
  // The day the series starts on, in its own zone.
  const startDay = allDay ? firstDay : start.slice(0, 10);
  const repeatOk = !freq || oneDay || (length <= 7 * DAY_MS && (endKind !== "until" || (!!until && until >= startDay)) && (endKind !== "count" || (count >= 1 && count <= 730)));
  const rule: RepeatRule | null =
    freq && !oneDay
      ? { freq, interval: Math.min(Math.max(interval || 1, 1), 99), days: freq === "weekly" ? days : [], until: endKind === "until" ? until : null, count: endKind === "count" ? count : null }
      : null;

  // Moving the start keeps the length.
  const changeStart = (value: string) => {
    const before = fromZonedInput(start, zone);
    const after = fromZonedInput(value, zone);
    const untilNow = fromZonedInput(end, zone);
    setStart(value);
    if (before && after && untilNow) setEnd(toZonedInput(new Date(Date.parse(untilNow) + Date.parse(after) - Date.parse(before)).toISOString(), zone));
  };
  const changeFreq = (value: "" | RepeatFreq) => {
    setFreq(value);
    // A weekly series starts with the day it begins on.
    if (value === "weekly" && days.length === 0 && startDay) setDays([weekdayOf(fromDayKey(startDay))]);
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
    if (!repeatOk) return setError(c.errors.bad_repeat);
    const fields: EventFields = {
      title: title.trim(),
      description,
      location: location.trim(),
      meeting_url: link.trim(),
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: allDay,
      time_zone: allDay ? "UTC" : zone,
      visibility,
      repeat: rule,
      reminder_minutes: reminder || null,
    };
    const invite = invited.filter((id) => !initial.people.includes(id));
    const remove = initial.people.filter((id) => !invited.includes(id));
    const day = series?.occurrence ?? null;
    setSaving(true);
    const result = !editing
      ? await createEvent(shortId, workspaceId, fields, invited)
      : scope === "one" && day
        ? await changeOccurrence(shortId, editing.event.id, day, fields)
        : scope === "following" && day
          ? await splitEvent(shortId, editing.event.id, day, fields, invite, remove)
          : await updateEvent(shortId, editing.event.id, fields, invite, remove);
    if (!result.ok) {
      setSaving(false);
      return setError(errorText(result.error));
    }
    // The units go to the event that was made (a new one, or the new part of a split series).
    const target = "id" in result && typeof result.id === "string" ? result.id : editing?.event.id;
    if (target && !oneDay) {
      for (const unit of addUnits) {
        const added = await inviteUnit(shortId, target, unit);
        if (!added.ok) {
          setSaving(false);
          return setError(errorText(added.error));
        }
      }
    }
    setSaving(false);
    onSaved();
  };

  const time = new Intl.DateTimeFormat(dateLocale(), { hour: "2-digit", minute: "2-digit" });
  const nameOf = (id: string) => (id === me ? f.you : (people.find((p) => p.id === id)?.name ?? "—"));
  const heading = !editing ? f.newTitle : series ? `${f.editTitle} · ${r.scopes[scope]}` : f.editTitle;

  return (
    <Shell label={heading} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-3"
        data-event-form
        data-event-scope={scope}
      >
        <h2 className="text-lg font-semibold">{heading}</h2>
        <input ref={titleInput} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={f.titlePlaceholder} aria-label={f.title} className={`${inputClass} font-medium`} data-event-field="title" />

        {!oneDay && (
          <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-5 w-5" data-event-field="all_day" />
            {f.allDay}
          </label>
        )}
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
            {!oneDay && (
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
            )}
          </>
        )}
        {!timeOk && <p className="text-sm text-danger">{c.errors.bad_time}</p>}

        {!oneDay && (
          <fieldset className="rounded-lg border border-border p-3" data-repeat>
            <legend className="px-1 text-sm text-muted">{r.title}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="sr-only">{r.title}</span>
                <select value={freq} onChange={(e) => changeFreq(e.target.value as "" | RepeatFreq)} className={inputClass} data-event-field="repeat">
                  <option value="">{r.none}</option>
                  {REPEAT_FREQS.map((value) => (
                    <option key={value} value={value}>
                      {r.freqs[value]}
                    </option>
                  ))}
                </select>
              </label>
              {freq && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted">{r.everyLabel}</span>
                  <input type="number" min={1} max={99} value={interval} onChange={(e) => setIntervalCount(Number(e.target.value))} className={`${inputClass} w-20`} data-event-field="repeat_interval" />
                  <span className="text-muted">{r.units[freq]}</span>
                </label>
              )}
            </div>
            {freq === "weekly" && (
              <div className="mt-2 flex flex-wrap gap-1" data-repeat-days>
                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                  <label key={day} className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border px-2 text-sm ${days.includes(day) ? "border-accent bg-accent text-white" : "border-border"}`}>
                    <input type="checkbox" className="sr-only" checked={days.includes(day)} onChange={(e) => setDays(e.target.checked ? [...days, day] : days.filter((x) => x !== day))} data-repeat-day={day} />
                    {t.calendar.settings.days[day - 1]}
                  </label>
                ))}
              </div>
            )}
            {freq && (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-muted">{r.ends}</span>
                  <select value={endKind} onChange={(e) => {
                      setEndKind(e.target.value as EndKind);
                      // A sensible last day to start from: four weeks on.
                      if (e.target.value === "until" && !until && startDay) setUntil(dayKey(new Date(fromDayKey(startDay).getTime() + 28 * DAY_MS)));
                    }} className={`${inputClass} mt-1`} data-event-field="repeat_end">
                    <option value="never">{r.never}</option>
                    <option value="until">{r.onDate}</option>
                    <option value="count">{r.afterTimes}</option>
                  </select>
                </label>
                {endKind === "until" && (
                  <label className="block text-sm">
                    <span className="text-muted">{r.lastDay}</span>
                    <input type="date" value={until} min={startDay} onChange={(e) => setUntil(e.target.value)} className={`${inputClass} mt-1`} data-event-field="repeat_until" />
                  </label>
                )}
                {endKind === "count" && (
                  <label className="block text-sm">
                    <span className="text-muted">{r.howMany}</span>
                    <input type="number" min={1} max={730} value={count} onChange={(e) => setCount(Number(e.target.value))} className={`${inputClass} mt-1`} data-event-field="repeat_count" />
                  </label>
                )}
              </div>
            )}
            {freq && !repeatOk && <p className="mt-2 text-sm text-danger">{c.errors.bad_repeat}</p>}
            {scope === "all" && series && <p className="mt-2 text-xs text-muted">{r.allHint}</p>}
            {scope === "following" && <p className="mt-2 text-xs text-muted">{r.followingHint}</p>}
          </fieldset>
        )}
        {oneDay && <p className="text-xs text-muted">{r.oneHint}</p>}

        {!oneDay && (
          <>
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
            {units.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" data-unit-picker>
                <span className="text-sm text-muted">{f.units}:</span>
                {addUnits.map((unit) => (
                  <span key={unit} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-surface pl-2 text-sm" data-picked-unit>
                    {units.find((u) => u.id === unit)?.name}
                    <button type="button" onClick={() => setAddUnits(addUnits.filter((u) => u !== unit))} className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-background" aria-label={f.removePerson(units.find((u) => u.id === unit)?.name ?? "")}>
                      <Icon name="close" />
                    </button>
                  </span>
                ))}
                <select
                  value=""
                  onChange={(e) => e.target.value && !addUnits.includes(e.target.value) && setAddUnits([...addUnits, e.target.value])}
                  className="min-h-11 max-w-full rounded-md border border-border bg-background px-2 text-base md:min-h-8 md:text-sm"
                  aria-label={f.addUnit}
                  data-event-field="unit"
                >
                  <option value="">{f.addUnit}</option>
                  {units
                    .filter((u) => !addUnits.includes(u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
                {addUnits.length > 0 && <p className="basis-full text-xs text-muted">{f.unitsHint}</p>}
              </div>
            )}
          </>
        )}
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
        {!oneDay && (
          <label className="block text-sm">
            <span className="text-muted">{c.reminder.title}</span>
            <select value={reminder} onChange={(e) => setReminder(Number(e.target.value))} className={`${inputClass} mt-1`} data-event-field="reminder">
              <option value={0}>{c.reminder.none}</option>
              {REMINDERS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {c.reminder.options[String(minutes)]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">{c.reminder.hint}</span>
          </label>
        )}
        <label className="block text-sm">
          <span className="text-muted">{f.description}</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} rows={3} className={`${inputClass} mt-1 py-2`} data-event-field="description" />
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={buttonClass}>
            {f.cancel}
          </button>
          <button type="submit" disabled={saving || !title.trim() || !timeOk || !linkOk || !repeatOk} className={primaryClass} data-save-event>
            {editing ? f.save : f.create}
          </button>
        </div>
      </form>
    </Shell>
  );
}
