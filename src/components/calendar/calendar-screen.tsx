"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dateLocale, t } from "@/i18n";
import { cancelEvent, loadBusy, loadCalendar } from "@/app/calendar-actions";
import {
  DAY_MS,
  addDays,
  addMonths,
  dayKey,
  eventSpan,
  fromDayKey,
  monthGrid,
  onDay,
  placeDay,
  startOfDay,
  startOfWeek,
  weekdayOf,
  type BusySlot,
  type CalendarEvent,
  type CalendarPerson,
  type CalendarSettings,
  type CalendarView,
  type CancelledEvent,
} from "@/lib/calendar";
import { loadAbsences } from "@/app/time-off-actions";
import { workspacePath } from "@/lib/paths";
import type { Absence } from "@/lib/time-off";
import { EventDialog, type DialogState } from "./event-dialog";
import { DobaNav } from "./time-off-screen";
import { CalendarSettingsDialog, PeoplePicker } from "./calendar-parts";

const c = t.calendar;
const HOUR_PX = 48;
// The part of a day column events take while colleagues' busy time is shown beside them.
const EVENTS_SHARE = 66;
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";

const timeOf = (d: Date) => new Intl.DateTimeFormat(dateLocale(), { hour: "2-digit", minute: "2-digit" }).format(d);
const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

// How an event looks by what it is to me: mine and accepted — filled; waiting for my
// answer — outlined; the rest — quiet.
function chipClass(event: CalendarEvent) {
  if (event.my_status === "accepted") return "border-accent bg-accent text-white";
  if (event.my_status === "invited" || event.my_status === "tentative" || event.my_status === "requested") return "border-accent bg-accent/10 text-foreground border-dashed";
  if (event.my_status === "declined") return "border-border bg-surface text-muted line-through";
  return "border-accent/40 bg-accent/5 text-foreground";
}

export function CalendarScreen({
  shortId,
  workspaceId,
  me,
  guest,
  admin,
  people,
  settings: initialSettings,
  initialView,
  initialDay,
  initialEvent,
}: {
  shortId: string;
  workspaceId: string;
  me: string;
  guest: boolean;
  admin: boolean;
  people: CalendarPerson[];
  settings: CalendarSettings;
  initialView: CalendarView | null;
  initialDay: string | null;
  initialEvent: string | null;
}) {
  const [view, setView] = useState<CalendarView>(initialView ?? "week");
  const [anchor, setAnchor] = useState<Date>(() => (initialDay ? fromDayKey(initialDay) : startOfDay(new Date())));
  const [settings, setSettings] = useState(initialSettings);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [cancelled, setCancelled] = useState<CancelledEvent[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(initialEvent ? { mode: "details", id: initialEvent } : null);
  const [watched, setWatched] = useState<string[]>([]);
  const [busy, setBusy] = useState<BusySlot[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  // How many days the week view shows: the whole week on a wide screen, three on a
  // tablet, one on a phone — so the page never scrolls sideways.
  const [days, setDays] = useState(7);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setDays(el.clientWidth < 520 ? 1 : el.clientWidth < 860 ? 3 : 7);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const today = startOfDay(new Date());
  const range = useMemo(() => {
    if (view === "month") {
      const grid = monthGrid(anchor);
      return { from: grid[0], to: addDays(grid[41], 1) };
    }
    if (view === "week") {
      const from = days === 7 ? startOfWeek(anchor) : startOfDay(anchor);
      return { from, to: addDays(from, days) };
    }
    return { from: startOfDay(anchor), to: addDays(anchor, 60) };
  }, [view, anchor, days]);
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const request = useRef(0);
  useEffect(() => {
    const mine = ++request.current;
    // Whole-day events are kept as UTC dates: a day wider on both sides catches them in any zone.
    loadCalendar(shortId, workspaceId, new Date(Date.parse(fromIso) - DAY_MS).toISOString(), new Date(Date.parse(toIso) + DAY_MS).toISOString()).then((loaded) => {
      if (mine !== request.current) return;
      if (!loaded) return setState("failed");
      setEvents(loaded.events);
      // Only what this person may bring back: their own, and for admins whatever isn't private.
      setCancelled(loaded.cancelled.filter((e) => e.organizer_id === me || (admin && e.visibility !== "private")));
      setState("ready");
    });
  }, [shortId, workspaceId, fromIso, toIso, tick, me, admin]);

  useEffect(() => {
    let live = true;
    if (!watched.length) return;
    loadBusy(shortId, workspaceId, watched, new Date(Date.parse(fromIso) - DAY_MS).toISOString(), new Date(Date.parse(toIso) + DAY_MS).toISOString()).then((slots) => {
      if (live) setBusy(slots);
    });
    return () => {
      live = false;
    };
  }, [shortId, workspaceId, watched, fromIso, toIso, tick]);
  const shownBusy = watched.length ? busy : [];

  // Approved absences of the shown days (members only; guests get none).
  const firstDay = dayKey(range.from);
  const lastDay = dayKey(addDays(range.to, -1));
  useEffect(() => {
    if (guest) return;
    let live = true;
    loadAbsences(shortId, workspaceId, firstDay, lastDay).then((list) => {
      if (live) setAbsences(list);
    });
    return () => {
      live = false;
    };
  }, [shortId, workspaceId, guest, firstDay, lastDay, tick]);
  const timeOffHref = workspacePath(shortId, "/calendar/time-off?tab=team");

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const step = (direction: 1 | -1) => {
    if (view === "month") setAnchor(addMonths(anchor, direction));
    else if (view === "week") setAnchor(addDays(days === 7 ? startOfWeek(anchor) : anchor, direction * days));
    else setAnchor(addDays(anchor, direction * 30));
  };

  const heading = useMemo(() => {
    const locale = dateLocale();
    if (view === "month") return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(anchor);
    const last = addDays(range.to, -1);
    if (sameDay(range.from, last)) return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "long", year: "numeric" }).format(range.from);
    const short = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
    return `${short.format(range.from)} – ${short.format(last)} ${last.getFullYear()}`;
  }, [view, anchor, range]);

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "";
  // Without a clicked slot: the next full hour.
  const openNew = (start?: Date, allDay = false) => {
    if (!guest) setDialog({ mode: "new", start: (start ?? new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000)).toISOString(), allDay });
  };
  const restore = async (id: string) => {
    const result = await cancelEvent(shortId, id, true);
    if (result.ok) reload();
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col px-3 py-4 md:px-6" data-calendar>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">📅 {c.title}</h1>
        {!guest && <DobaNav shortId={shortId} current="events" />}
        {!guest && (
          <button type="button" onClick={() => openNew()} className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:opacity-90 md:min-h-9" data-new-event>
            ＋ {c.newEvent}
          </button>
        )}
        {admin && (
          <button type="button" onClick={() => setShowSettings(true)} className={buttonClass} aria-label={c.settings.title} title={c.settings.title}>
            ⚙️
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAnchor(today)} className={buttonClass}>
          {c.today}
        </button>
        <button type="button" onClick={() => step(-1)} className={`${buttonClass} w-11 px-0 md:w-9`} aria-label={c.prev}>
          ‹
        </button>
        <button type="button" onClick={() => step(1)} className={`${buttonClass} w-11 px-0 md:w-9`} aria-label={c.next}>
          ›
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-medium first-letter:uppercase" data-calendar-heading>
          {heading}
        </h2>
        <div className="flex rounded-md border border-border" role="tablist" aria-label={c.viewLabel}>
          {(["month", "week", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`min-h-11 px-3 text-sm first:rounded-l-md last:rounded-r-md md:min-h-9 ${view === v ? "bg-accent text-white" : "hover:bg-surface"}`}
              data-calendar-view={v}
            >
              {c.views[v]}
            </button>
          ))}
        </div>
      </div>

      {!guest && view === "week" && (
        <div className="mt-2">
          <PeoplePicker label={c.availability} hint={c.availabilityHint} people={people.filter((p) => p.id !== me)} picked={watched} onChange={setWatched} max={10} />
        </div>
      )}

      <div ref={frame} className="mt-3 min-w-0 flex-1">
        {state === "failed" ? (
          <p className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm">
            {c.loadFailed}{" "}
            <button type="button" className="underline" onClick={reload}>
              {c.retry}
            </button>
          </p>
        ) : view === "month" ? (
          <MonthView
            anchor={anchor}
            today={today}
            events={events}
            absences={absences}
            timeOffHref={timeOffHref}
            workDays={settings.work_days}
            onPickDay={(day) => {
              setAnchor(day);
              setView("week");
            }}
            onEvent={(id) => setDialog({ mode: "details", id })}
          />
        ) : view === "week" ? (
          <WeekView
            from={range.from}
            days={days}
            today={today}
            events={events}
            busy={shownBusy}
            absences={absences}
            timeOffHref={timeOffHref}
            nameOf={nameOf}
            workDays={settings.work_days}
            onSlot={openNew}
            onEvent={(id) => setDialog({ mode: "details", id })}
          />
        ) : (
          <ListView from={range.from} events={events} absences={absences} timeOffHref={timeOffHref} cancelled={cancelled} loading={state === "loading"} onEvent={(id) => setDialog({ mode: "details", id })} onRestore={restore} />
        )}
      </div>

      {dialog && (
        <EventDialog
          key={dialog.mode === "details" ? dialog.id : dialog.mode}
          shortId={shortId}
          workspaceId={workspaceId}
          me={me}
          guest={guest}
          people={people}
          defaultZone={settings.time_zone}
          state={dialog}
          onState={setDialog}
          onChanged={reload}
        />
      )}
      {showSettings && (
        <CalendarSettingsDialog
          shortId={shortId}
          workspaceId={workspaceId}
          settings={settings}
          onSaved={(next) => {
            setSettings(next);
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </main>
  );
}

function EventChip({ event, onOpen, withTime = true }: { event: CalendarEvent; onOpen: (id: string) => void; withTime?: boolean }) {
  const { start } = eventSpan(event);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(event.id);
      }}
      className={`block w-full truncate rounded border px-1 text-left text-xs leading-5 ${chipClass(event)}`}
      title={event.title}
      data-event={event.title}
    >
      {withTime && !event.all_day && <span className="mr-1 opacity-80">{timeOf(start)}</span>}
      {event.title}
    </button>
  );
}

const offOn = (absences: Absence[], day: Date) => {
  const key = dayKey(day);
  return absences.filter((a) => a.start_date <= key && a.end_date >= key);
};
const absenceTitle = (a: Absence) => [a.person, a.label ?? (a.remote ? t.timeOff.team.remote : t.timeOff.team.absent), a.deputy ? t.timeOff.deputy(a.deputy) : null].filter(Boolean).join(" · ");

function AbsenceChip({ absence, href }: { absence: Absence; href: string }) {
  return (
    <Link href={href} onClick={(e) => e.stopPropagation()} className="block truncate rounded border border-border bg-surface px-1 text-xs leading-5 text-muted hover:text-foreground" title={absenceTitle(absence)} data-absence={absence.person}>
      <span aria-hidden="true">{absence.remote ? "🏠" : "🌴"}</span> {absence.person}
    </Link>
  );
}

function MonthView({
  anchor,
  today,
  events,
  absences,
  timeOffHref,
  workDays,
  onPickDay,
  onEvent,
}: {
  anchor: Date;
  today: Date;
  events: CalendarEvent[];
  absences: Absence[];
  timeOffHref: string;
  workDays: number[];
  onPickDay: (day: Date) => void;
  onEvent: (id: string) => void;
}) {
  const grid = monthGrid(anchor);
  const weekday = new Intl.DateTimeFormat(dateLocale(), { weekday: "short" });
  return (
    <div className="overflow-hidden rounded-lg border border-border" data-month>
      <div className="grid grid-cols-7 border-b border-border bg-surface text-center text-xs text-muted">
        {grid.slice(0, 7).map((d) => (
          <div key={d.getDay()} className="py-1 first-letter:uppercase">
            {weekday.format(d)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {grid.map((day, i) => {
          const dayEvents = events.filter((e) => onDay(e, day)).sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.starts_at.localeCompare(b.starts_at));
          const off = offOn(absences, day);
          const outside = day.getMonth() !== anchor.getMonth();
          const isToday = dayKey(day) === dayKey(today);
          return (
            <div
              key={dayKey(day)}
              className={`min-h-20 min-w-0 border-border p-1 md:min-h-28 ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${workDays.includes(weekdayOf(day)) ? "" : "bg-surface/60"}`}
              data-day={dayKey(day)}
            >
              <button
                type="button"
                onClick={() => onPickDay(day)}
                className={`flex min-h-11 w-full items-start justify-center rounded-md text-sm hover:bg-surface sm:min-h-7 sm:justify-start ${outside ? "text-muted" : ""}`}
                aria-label={new Intl.DateTimeFormat(dateLocale(), { dateStyle: "full" }).format(day)}
              >
                <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 ${isToday ? "bg-accent font-semibold text-white" : ""}`}>{day.getDate()}</span>
                {/* On a phone a cell has no room for titles: dots, and a tap opens the day. */}
                {dayEvents.length > 0 && <span className="ml-0.5 mt-2.5 h-1.5 w-1.5 rounded-full bg-accent sm:hidden" aria-hidden="true" />}
              </button>
              <div className="hidden space-y-0.5 sm:block">
                {off.length > 0 && (
                  <Link href={timeOffHref} className="block truncate rounded border border-border bg-surface px-1 text-xs leading-5 text-muted hover:text-foreground" title={off.map(absenceTitle).join("\n")} data-absences={off.length}>
                    <span aria-hidden="true">🌴</span> {off.length === 1 ? off[0].person : c.offCount(off.length)}
                  </Link>
                )}
                {dayEvents.slice(0, 3).map((event) => (
                  <EventChip key={event.id} event={event} onOpen={onEvent} />
                ))}
                {dayEvents.length > 3 && (
                  <button type="button" onClick={() => onPickDay(day)} className="block w-full rounded px-1 text-left text-xs text-muted hover:bg-surface">
                    {c.more(dayEvents.length - 3)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  from,
  days,
  today,
  events,
  busy,
  absences,
  timeOffHref,
  nameOf,
  workDays,
  onSlot,
  onEvent,
}: {
  from: Date;
  days: number;
  today: Date;
  events: CalendarEvent[];
  busy: BusySlot[];
  absences: Absence[];
  timeOffHref: string;
  nameOf: (id: string) => string;
  workDays: number[];
  onSlot: (start: Date, allDay?: boolean) => void;
  onEvent: (id: string) => void;
}) {
  const columns = Array.from({ length: days }, (_, i) => addDays(from, i));
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Start at the working morning rather than at midnight.
    if (scroller.current) scroller.current.scrollTop = 7.5 * HOUR_PX;
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const head = new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "numeric" });
  const template = { gridTemplateColumns: `3rem repeat(${days}, minmax(0, 1fr))` };
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="flex h-full min-h-96 flex-col overflow-hidden rounded-lg border border-border" data-week data-week-days={days}>
      <div className="grid border-b border-border bg-surface text-sm" style={template}>
        <div />
        {columns.map((day) => (
          <div key={dayKey(day)} className={`border-l border-border px-1 py-1 text-center first-letter:uppercase ${dayKey(day) === dayKey(today) ? "font-semibold text-accent" : ""}`}>
            {head.format(day)}
          </div>
        ))}
      </div>
      {/* Whole-day events. */}
      <div className="grid border-b border-border" style={template}>
        <div className="px-1 py-1 text-right text-[10px] leading-4 text-muted">{c.allDayShort}</div>
        {columns.map((day) => {
          const whole = events.filter((e) => e.all_day && onDay(e, day));
          const wholeBusy = busy.filter((b) => b.all_day && onDay(b, day));
          return (
            <div key={dayKey(day)} className="min-h-7 min-w-0 space-y-0.5 border-l border-border p-0.5" onClick={() => onSlot(day, true)} data-all-day={dayKey(day)}>
              {whole.map((event) => (
                <EventChip key={event.id} event={event} onOpen={onEvent} withTime={false} />
              ))}
              {offOn(absences, day).map((absence) => (
                <AbsenceChip key={absence.id} absence={absence} href={timeOffHref} />
              ))}
              {wholeBusy.map((slot, i) => (
                <div key={i} className="truncate rounded border border-border bg-surface px-1 text-xs leading-5 text-muted" data-busy>
                  {c.busyOf(nameOf(slot.user_id))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: "calc(100dvh - 17rem)" }}>
        <div className="relative grid" style={{ ...template, height: 24 * HOUR_PX }}>
          <div className="relative">
            {hours.slice(1).map((h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] text-muted" style={{ top: h * HOUR_PX }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {columns.map((day) => {
            const timed = placeDay(
              events.filter((e) => !e.all_day),
              day,
            );
            const slots = placeDay(
              busy.filter((b) => !b.all_day),
              day,
            );
            const isToday = dayKey(day) === dayKey(today);
            const share = busy.length ? EVENTS_SHARE : 100;
            return (
              <div
                key={dayKey(day)}
                className={`relative border-l border-border ${workDays.includes(weekdayOf(day)) ? "" : "bg-surface/60"}`}
                style={{ backgroundImage: "linear-gradient(to bottom, var(--border) 1px, transparent 1px)", backgroundSize: `100% ${HOUR_PX}px` }}
                onClick={(e) => {
                  // A click on the empty grid: a new event at that half hour.
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  const minutes = Math.max(0, Math.min(23.5 * 60, Math.floor((y / HOUR_PX) * 2) * 30));
                  onSlot(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes));
                }}
                data-day-column={dayKey(day)}
              >
                {slots.map((p, i) => (
                  <div
                    key={`busy-${i}`}
                    className="pointer-events-none absolute overflow-hidden whitespace-nowrap border-l-2 border-muted px-1 text-[10px] leading-4 text-muted"
                    style={{
                      top: (p.top / 60) * HOUR_PX,
                      height: (p.height / 60) * HOUR_PX,
                      // Others' busy time keeps the right third of the day, so it never hides under an event.
                      left: `${EVENTS_SHARE + (p.column / p.columns) * (100 - EVENTS_SHARE)}%`,
                      width: `${(100 - EVENTS_SHARE) / p.columns}%`,
                      backgroundImage: "repeating-linear-gradient(135deg, color-mix(in srgb, var(--muted) 22%, transparent) 0 6px, transparent 6px 12px)",
                    }}
                    data-busy
                  >
                    {c.busyOf(nameOf(p.item.user_id))}
                  </div>
                ))}
                {timed.map((p) => (
                  <button
                    key={p.item.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEvent(p.item.id);
                    }}
                    className={`absolute overflow-hidden rounded border px-1 text-left text-xs leading-4 ${chipClass(p.item)}`}
                    style={{
                      top: (p.top / 60) * HOUR_PX,
                      height: Math.max((p.height / 60) * HOUR_PX - 1, 20),
                      left: `calc(${(p.column / p.columns) * share}% + 1px)`,
                      width: `calc(${share / p.columns}% - 3px)`,
                    }}
                    title={p.item.title}
                    data-event={p.item.title}
                  >
                    <span className="block truncate font-medium">{p.item.title}</span>
                    {p.height >= 40 && <span className="block truncate opacity-80">{timeOf(new Date(p.item.starts_at))}</span>}
                  </button>
                ))}
                {isToday && <div className="pointer-events-none absolute inset-x-0 border-t-2 border-danger" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ListView({
  from,
  events,
  absences,
  timeOffHref,
  cancelled,
  loading,
  onEvent,
  onRestore,
}: {
  from: Date;
  events: CalendarEvent[];
  absences: Absence[];
  timeOffHref: string;
  cancelled: CancelledEvent[];
  loading: boolean;
  onEvent: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const locale = dateLocale();
  const dayFormat = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  const sorted = events
    .map((event) => ({ event, span: eventSpan(event) }))
    .filter(({ span }) => span.end.getTime() > from.getTime())
    .sort((a, b) => a.span.start.getTime() - b.span.start.getTime());
  const groups = new Map<string, typeof sorted>();
  for (const row of sorted) {
    const key = dayKey(row.span.start.getTime() < from.getTime() ? from : row.span.start);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return (
    <div className="mx-auto max-w-3xl" data-list>
      {groups.size === 0 && <p className="text-muted">{loading ? c.loading : c.noEvents}</p>}
      {[...groups].map(([key, rows]) => (
        <section key={key} className="mb-4">
          <h3 className="mb-1 text-sm font-medium text-muted first-letter:uppercase">{dayFormat.format(fromDayKey(key))}</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map(({ event, span }) => (
              <li key={event.id}>
                <button type="button" onClick={() => onEvent(event.id)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface" data-event={event.title}>
                  <span className="w-24 shrink-0 text-sm text-muted">{event.all_day ? c.allDay : `${timeOf(span.start)} – ${timeOf(span.end)}`}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-medium ${event.my_status === "declined" ? "text-muted line-through" : ""}`}>{event.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {[c.kinds[event.visibility], event.location, event.my_status ? c.details.status[event.my_status] : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {event.requests > 0 && <span className="rounded-full bg-accent px-2 text-xs text-white">{c.details.requestsCount(event.requests)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {absences.length > 0 && (
        <section className="mt-6" data-list-absences>
          <h3 className="mb-1 text-sm font-medium text-muted">{t.timeOff.title}</h3>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {absences.slice(0, 30).map((absence) => (
              <li key={absence.id}>
                <Link href={timeOffHref} className="flex min-h-11 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-surface" title={absenceTitle(absence)}>
                  <span aria-hidden="true">{absence.remote ? "🏠" : "🌴"}</span>
                  <span className="min-w-0 flex-1 truncate">{absence.person}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(fromDayKey(absence.start_date))}
                    {absence.end_date !== absence.start_date ? ` – ${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(fromDayKey(absence.end_date))}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {cancelled.length > 0 && (
        <section className="mt-8" data-cancelled>
          <h3 className="mb-1 text-sm font-medium text-muted">{c.cancelledTitle}</h3>
          <p className="mb-2 text-xs text-muted">{c.cancelledHint}</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {cancelled.map((event) => (
              <li key={event.id} className="flex min-h-14 flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-muted line-through">{event.title}</span>
                <span className="text-xs text-muted">{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(eventSpan({ ...event, ends_at: event.starts_at }).start)}</span>
                <button type="button" onClick={() => onRestore(event.id)} className={buttonClass}>
                  {c.restore}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
