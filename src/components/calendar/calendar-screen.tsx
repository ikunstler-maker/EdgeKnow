"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { dateLocale, t } from "@/i18n";
import { cancelEvent, loadBirthdays, loadBusy, loadCalendar, loadCalendarTasks } from "@/app/calendar-actions";
import {
  DAY_MS,
  TASKS_PER_DAY,
  TASK_MODES,
  TASK_MODE_KEY,
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
  type Birthday,
  type BusySlot,
  type CalendarEvent,
  type CalendarPerson,
  type CalendarSettings,
  type CalendarTask,
  type CalendarUnit,
  type TaskMode,
  type CalendarView,
  type CancelledEvent,
} from "@/lib/calendar";
import { loadMyOutsideBusy } from "@/app/calendar-external-actions";
import { loadAbsences, loadHolidays, loadMyLeave } from "@/app/time-off-actions";
import { workspacePath } from "@/lib/paths";
import type { Absence, Holiday, MyLeave, MyLeaveRequest } from "@/lib/time-off";
import { EventDialog, type DialogState } from "./event-dialog";
import { DobaNav, MyAbsenceDialog, RequestDialog } from "./time-off-screen";
import { useDayDrag } from "./use-day-drag";
import { CalendarSettingsDialog, FeedDialog, PeoplePicker } from "./calendar-parts";
import { Icon } from "@/components/ui/icon";
import { Hint } from "@/components/ui/hint";
import { MenuItem, Popover } from "@/components/ui/popover";
import { buttonClass as uiButton, iconButtonClass } from "@/components/ui/button";
import { ServiceIcon } from "@/components/services/service-icon";

const c = t.calendar;
const HOUR_PX = 48;
// The part of a day column events take while colleagues' busy time is shown beside them.
const EVENTS_SHARE = 66;
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";

// Which tasks to show is kept on this device (the server draws the default, "mine").
const taskModeListeners = new Set<() => void>();
const watchTaskMode = (listener: () => void) => {
  taskModeListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    taskModeListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};
function readTaskMode(): TaskMode {
  try {
    const saved = window.localStorage.getItem(TASK_MODE_KEY) as TaskMode | null;
    return saved && TASK_MODES.includes(saved) ? saved : "mine";
  } catch {
    return "mine";
  }
}

// What a click or a drag on the grid picked: a stretch of time, or whole days.
type GridPick = { kind: "time"; start: Date; end: Date } | { kind: "days"; first: string; last: string };
// What the grid makes: an event, or a request for time off on the picked days.
type CreateMode = "event" | "absence";
// Dragging down the hours sticks to the nearest quarter of an hour.
const SNAP_MINUTES = 15;

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
  units,
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
  units: CalendarUnit[];
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
  // One's own busy time from an outside calendar: shown to oneself, marked as such.
  const [outside, setOutside] = useState<BusySlot[]>([]);
  const [outsideTick, setOutsideTick] = useState(0);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  // Rukh tasks with a due date: mine by default; the choice is kept on this device.
  const taskMode = useSyncExternalStore(watchTaskMode, readTaskMode, () => "mine" as TaskMode);
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const chooseTaskMode = (mode: TaskMode) => {
    try {
      window.localStorage.setItem(TASK_MODE_KEY, mode);
    } catch {
      // Not remembered, that's all.
    }
    for (const listener of taskModeListeners) listener();
  };
  const [showSettings, setShowSettings] = useState(false);
  const [showFeed, setShowFeed] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("event");
  // My own time off (balances, policies, requests) — for the request window and "withdraw".
  const [myLeave, setMyLeave] = useState<MyLeave | null>(null);
  const [leaveAsk, setLeaveAsk] = useState<{ from: string; to: string } | null>(null);
  // The id of one's own absence to show; the request itself comes once own time off is loaded.
  const [myAbsenceId, setMyAbsence] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
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
  useEffect(() => {
    let live = true;
    if (guest) return;
    loadMyOutsideBusy(shortId, new Date(Date.parse(fromIso) - DAY_MS).toISOString(), new Date(Date.parse(toIso) + DAY_MS).toISOString()).then((slots) => {
      if (live) setOutside(slots.map((slot) => ({ ...slot, outside: true })));
    });
    return () => {
      live = false;
    };
  }, [shortId, guest, fromIso, toIso, tick, outsideTick]);
  const shownBusy = useMemo(() => {
    const mine = new Set(outside.map((slot) => `${slot.starts_at}|${slot.ends_at}`));
    // Watching oneself brings the same slots once more, unmarked: the marked ones stay.
    const others = (watched.length ? busy : []).filter((slot) => slot.user_id !== me || !mine.has(`${slot.starts_at}|${slot.ends_at}`));
    return [...others, ...outside];
  }, [busy, outside, watched, me]);

  // Approved absences of the shown days (members only; guests get none).
  const firstDay = dayKey(range.from);
  const lastDay = dayKey(addDays(range.to, -1));
  useEffect(() => {
    if (guest) return;
    let live = true;
    loadAbsences(shortId, workspaceId, firstDay, lastDay).then((list) => {
      if (live) setAbsences(list);
    });
    loadHolidays(shortId, workspaceId, firstDay, lastDay).then((list) => {
      if (live) setHolidays(list);
    });
    loadBirthdays(shortId, workspaceId, firstDay, lastDay).then((list) => {
      if (live) setBirthdays(list);
    });
    return () => {
      live = false;
    };
  }, [shortId, workspaceId, guest, firstDay, lastDay, tick]);
  const timeOffHref = workspacePath(shortId, "/calendar/time-off?tab=team");
  // The shown days may lie in two years (a week around the New Year): my requests of both.
  const [firstYear, lastYear] = [Number(firstDay.slice(0, 4)), Number(lastDay.slice(0, 4))];
  useEffect(() => {
    if (guest) return;
    let live = true;
    Promise.all([loadMyLeave(shortId, workspaceId, firstYear), firstYear === lastYear ? null : loadMyLeave(shortId, workspaceId, lastYear)]).then(([first, second]) => {
      if (!live || !first.ok) return;
      setMyLeave(second?.ok ? { ...first, requests: [...first.requests, ...second.requests] } : first);
    });
    return () => {
      live = false;
    };
  }, [shortId, workspaceId, guest, firstYear, lastYear, tick]);
  // My requests that wait or are on: shown on my calendar, and can be withdrawn from it.
  const myRequests = useMemo(() => (myLeave?.requests ?? []).filter((r) => r.status === "pending" || r.status === "approved"), [myLeave]);
  const policyName = (id: string) => myLeave?.policies.find((p) => p.id === id)?.name ?? t.timeOff.title;
  useEffect(() => {
    if (taskMode === "off") return;
    let live = true;
    loadCalendarTasks(shortId, workspaceId, firstDay, lastDay, taskMode === "mine").then((list) => {
      if (live) setTasks(list);
    });
    return () => {
      live = false;
    };
  }, [shortId, workspaceId, taskMode, firstDay, lastDay, tick]);
  const shownTasks = taskMode === "off" ? [] : tasks;
  const taskHref = (task: CalendarTask) => workspacePath(shortId, `/tasks/${task.project}/${task.number}`);

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

  // A day of a series opens as that day.
  const openEvent = (event: CalendarEvent) => setDialog({ mode: "details", id: event.id, occurrence: event.occurrence ?? null });
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "";
  // What was picked on the grid becomes an event or, in the "absence" mode, a request for those days.
  const pick = (picked: GridPick) => {
    if (guest) return;
    setNote(null);
    if (createMode === "absence") {
      setLeaveAsk(picked.kind === "days" ? { from: picked.first, to: picked.last } : { from: dayKey(picked.start), to: dayKey(new Date(picked.end.getTime() - 1)) });
    } else if (picked.kind === "days") {
      setDialog({ mode: "new", start: fromDayKey(picked.first).toISOString(), end: fromDayKey(picked.last).toISOString(), allDay: true });
    } else {
      setDialog({ mode: "new", start: picked.start.toISOString(), end: picked.end.toISOString() });
    }
  };
  // The button: an event at the next full hour, or a request for today.
  const openNew = (mode: "event" | "absence" = createMode) => {
    if (guest) return;
    if (mode === "absence") return pick({ kind: "days", first: dayKey(new Date()), last: dayKey(new Date()) });
    const start = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000);
    pick({ kind: "time", start, end: new Date(start.getTime() + 3_600_000) });
  };
  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null);
  const openMyAbsence = (id: string) => setMyAbsence(id);
  const myAbsence = myAbsenceId ? (myRequests.find((r) => r.id === myAbsenceId) ?? null) : null;
  const restore = async (id: string) => {
    const result = await cancelEvent(shortId, id, true);
    if (result.ok) reload();
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col px-3 py-4 md:px-6" data-calendar>
      {/* One header row: the section, its two screens, the range, and one way to create. */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto flex items-center gap-2 text-xl font-semibold tracking-tight">
          <ServiceIcon serviceId="calendar" size={24} />
          {c.title}
        </h1>
        {!guest && <DobaNav shortId={shortId} current="events" />}
        <div className="inline-flex rounded-lg border border-border bg-hover p-0.5" role="tablist" aria-label={c.viewLabel}>
          {(["month", "week", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`min-h-10 rounded-md px-3 text-[13px] font-medium md:h-7 md:min-h-0 ${view === v ? "bg-background text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
              data-calendar-view={v}
            >
              {c.views[v]}
            </button>
          ))}
        </div>
        {!guest && (
          <button type="button" onClick={(e) => setCreateAnchor(createAnchor ? null : e.currentTarget)} aria-expanded={createAnchor !== null} className={uiButton("primary")} data-new-event>
            <Icon name="plus" />
            {c.create.button}
            <Icon name="chevron-down" size={14} />
          </button>
        )}
        <button type="button" onClick={() => setShowFeed(true)} className={iconButtonClass("ghost")} aria-label={c.feed.open} title={c.feed.open} data-open-feed>
          <Icon name="link" size={18} />
        </button>
        {admin && (
          <button type="button" onClick={() => setShowSettings(true)} className={iconButtonClass("ghost")} aria-label={c.settings.title} title={c.settings.title}>
            <Icon name="settings" size={18} />
          </button>
        )}
      </div>
      {createAnchor && (
        <Popover anchor={createAnchor} onClose={() => setCreateAnchor(null)} width={280}>
          <div data-create-menu>
            {(["event", "absence"] as const).map((mode) => (
              <MenuItem
                key={mode}
                onSelect={() => {
                  setCreateAnchor(null);
                  setCreateMode(mode);
                  openNew(mode);
                }}
              >
                <span className="flex flex-1 items-center gap-2" data-create-now={mode}>
                  <Icon name={mode === "event" ? "calendar" : "sun"} className="text-muted" />
                  {c.create.modes[mode]}
                </span>
              </MenuItem>
            ))}
            <div className="mt-1 border-t border-border px-2.5 pb-1.5 pt-2">
              <p className="flex items-center gap-1 text-xs text-muted">
                {c.create.label}
                <Hint label={c.create.label} text={createMode === "absence" ? c.create.absenceHint : c.create.eventHint} />
              </p>
              <div className="mt-1 inline-flex rounded-lg border border-border bg-hover p-0.5" role="group" aria-label={c.create.label}>
                {(["event", "absence"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={createMode === mode}
                    onClick={() => setCreateMode(mode)}
                    className={`min-h-10 rounded-md px-3 text-[13px] font-medium md:h-7 md:min-h-0 ${createMode === mode ? "bg-background text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
                    data-create-mode={mode}
                  >
                    {c.create.modes[mode]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Popover>
      )}

      {/* One compact bar: where we are in time, whose time is shown, and the tasks. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAnchor(today)} className={uiButton("subtle")}>
          {c.today}
        </button>
        <button type="button" onClick={() => step(-1)} className={iconButtonClass("ghost")} aria-label={c.prev}>
          <Icon name="chevron-left" size={18} />
        </button>
        <button type="button" onClick={() => step(1)} className={iconButtonClass("ghost")} aria-label={c.next}>
          <Icon name="chevron-right" size={18} />
        </button>
        <h2 className="min-w-0 truncate text-sm font-medium first-letter:uppercase" data-calendar-heading>
          {heading}
        </h2>
        {!guest && view === "week" && (
          <div className="flex min-w-0 items-center gap-1">
            <PeoplePicker label={c.availability} people={people.filter((p) => p.id !== me)} picked={watched} onChange={setWatched} max={10} />
            <Hint label={c.availability} text={c.availabilityHint} />
          </div>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-sm">
          <Icon name="task" className="text-muted" />
          <span className="sr-only">{c.tasks.label}</span>
          <select value={taskMode} onChange={(e) => chooseTaskMode(e.target.value as TaskMode)} className="min-h-11 rounded-lg border border-border bg-background px-2 text-[13px] hover:border-border-strong md:h-8 md:min-h-0" data-task-mode>
            {TASK_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {c.tasks.modes[mode]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {note && (
        <p className="mt-2 rounded-md border border-border bg-surface p-2 text-sm" role="status" data-calendar-note>
          {note}
        </p>
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
            holidays={holidays}
            birthdays={birthdays}
            tasks={shownTasks}
            timeOffHref={timeOffHref}
            workDays={settings.work_days}
            me={me}
            myRequests={myRequests}
            policyName={policyName}
            onMyAbsence={openMyAbsence}
            canPick={!guest}
            onPick={pick}
            onPickDay={(day) => {
              setAnchor(day);
              setView("week");
            }}
            onEvent={openEvent}
          />
        ) : view === "week" ? (
          <WeekView
            from={range.from}
            days={days}
            today={today}
            events={events}
            busy={shownBusy}
            absences={absences}
            holidays={holidays}
            birthdays={birthdays}
            tasks={shownTasks}
            taskHref={taskHref}
            timeOffHref={timeOffHref}
            nameOf={nameOf}
            workDays={settings.work_days}
            me={me}
            myRequests={myRequests}
            policyName={policyName}
            onMyAbsence={openMyAbsence}
            canPick={!guest}
            onPick={pick}
            onEvent={openEvent}
          />
        ) : (
          <ListView from={range.from} events={events} absences={absences} birthdays={birthdays} tasks={shownTasks} taskHref={taskHref} timeOffHref={timeOffHref} cancelled={cancelled} loading={state === "loading"} onEvent={openEvent} onRestore={restore} />
        )}
      </div>

      {dialog && (
        <EventDialog
          key={dialog.mode === "details" ? `${dialog.id}:${dialog.occurrence ?? ""}` : dialog.mode === "edit" ? `edit:${dialog.scope}` : dialog.mode}
          shortId={shortId}
          workspaceId={workspaceId}
          me={me}
          guest={guest}
          people={people}
          units={units}
          defaultZone={settings.time_zone}
          state={dialog}
          onState={setDialog}
          onChanged={reload}
        />
      )}
      {leaveAsk && myLeave && (
        <RequestDialog
          shortId={shortId}
          workspaceId={workspaceId}
          me={me}
          today={myLeave.today}
          policies={myLeave.policies.filter((p) => p.active)}
          people={people.filter((p) => p.id !== me && !p.guest)}
          initialFrom={leaveAsk.from}
          initialTo={leaveAsk.to}
          onClose={() => setLeaveAsk(null)}
          onSent={(status) => {
            setLeaveAsk(null);
            setNote(status === "approved" ? c.create.leaveOn : c.create.leaveSent);
            reload();
          }}
        />
      )}
      {myAbsence && myLeave && (
        <MyAbsenceDialog shortId={shortId} request={myAbsence} policy={policyName(myAbsence.policy_id)} today={myLeave.today} onClose={() => setMyAbsence(null)} onChanged={reload} />
      )}
      {showFeed && <FeedDialog shortId={shortId} workspaceId={workspaceId} guest={guest} onOutsideChanged={() => setOutsideTick((n) => n + 1)} onClose={() => setShowFeed(false)} />}
      {showSettings && (
        <CalendarSettingsDialog
          shortId={shortId}
          workspaceId={workspaceId}
          settings={settings}
          onSaved={(next) => {
            setSettings(next);
            setShowSettings(false);
            reload();
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </main>
  );
}

const eventKey = (event: CalendarEvent) => `${event.id}:${event.occurrence ?? ""}`;

function EventChip({ event, onOpen, withTime = true }: { event: CalendarEvent; onOpen: (event: CalendarEvent) => void; withTime?: boolean }) {
  const { start } = eventSpan(event);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(event);
      }}
      className={`block w-full truncate rounded border px-1 text-left text-xs leading-5 ${chipClass(event)}`}
      title={event.title}
      data-event={event.title}
    >
      {withTime && !event.all_day && <span className="mr-1 opacity-80">{timeOf(start)}</span>}
      {event.title}
      {event.recurring && <span className="ml-1 opacity-70" aria-label={c.repeat.title} data-recurring>
            <Icon name="refresh" size={11} className="inline" />
          </span>}
    </button>
  );
}

const holidayOn = (holidays: Holiday[], day: Date) => holidays.find((h) => h.day === dayKey(day));
// Who is off on a day. An absence that counts working days only isn't shown on days off and holidays.
const offOn = (absences: Absence[], day: Date, workDays: number[], holidays: Holiday[]) => {
  const key = dayKey(day);
  const free = !workDays.includes(weekdayOf(day)) || holidays.some((h) => h.day === key);
  return absences.filter((a) => a.start_date <= key && a.end_date >= key && !(a.working_only && free));
};
const absenceTitle = (a: Absence) => [a.person, a.label ?? (a.remote ? t.timeOff.team.remote : t.timeOff.team.absent), a.deputy ? t.timeOff.deputy(a.deputy) : null].filter(Boolean).join(" · ");

// My own request that still waits: shown to me only, and opens "withdraw".
const waitingOn = (requests: MyLeaveRequest[], day: Date) => {
  const key = dayKey(day);
  return requests.filter((r) => r.status === "pending" && r.start_date <= key && r.end_date >= key);
};

function WaitingChip({ request, name, onOpen }: { request: MyLeaveRequest; name: string; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(request.id);
      }}
      className="block w-full truncate rounded border border-dashed border-accent bg-accent/5 px-1 text-left text-xs leading-5"
      title={`${name} · ${t.timeOff.status.pending}`}
      data-my-request={request.status}
    >
      <Icon name="clock" size={12} className="inline" /> {name}
    </button>
  );
}

// Someone's birthday: festive, yet quiet beside the events.
function BirthdayChip({ birthday }: { birthday: Birthday }) {
  return (
    <div
      className="flex min-w-0 items-center gap-1 truncate rounded border border-accent/30 bg-accent/5 px-1 text-xs leading-5 text-accent"
      title={c.birthdays.of(birthday.name)}
      data-birthday={birthday.name}
    >
      <Icon name="gift" size={12} />
      <span className="truncate">{birthday.mine ? c.birthdays.mine : birthday.name}</span>
    </div>
  );
}
const birthdaysOn = (birthdays: Birthday[], day: Date) => birthdays.filter((b) => b.day === dayKey(day));

function AbsenceChip({ absence, href, onOpen }: { absence: Absence; href: string; onOpen?: (id: string) => void }) {
  // My own absence opens here (to withdraw it); a colleague's leads to the team list.
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(absence.id);
        }}
        className="block w-full truncate rounded border border-accent/40 bg-accent/10 px-1 text-left text-xs leading-5 hover:bg-accent/20"
        title={absenceTitle(absence)}
        data-absence={absence.person}
        data-my-absence-chip
      >
        <Icon name={absence.remote ? "home" : "sun"} size={12} className="inline" /> {absence.person}
      </button>
    );
  }
  return (
    <Link href={href} onClick={(e) => e.stopPropagation()} className="block truncate rounded border border-border bg-surface px-1 text-xs leading-5 text-muted hover:text-foreground" title={absenceTitle(absence)} data-absence={absence.person}>
      <Icon name={absence.remote ? "home" : "sun"} size={12} className="inline" /> {absence.person}
    </Link>
  );
}

const dueOn = (tasks: CalendarTask[], day: Date) => {
  const key = dayKey(day);
  return tasks.filter((task) => task.due_date === key);
};

function TaskCard({ task, href }: { task: CalendarTask; href: string }) {
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className={`block truncate rounded border border-border bg-background px-1 text-xs leading-5 hover:bg-surface ${task.done ? "text-muted line-through" : ""}`}
      title={`${task.key} ${task.title}`}
      data-calendar-task={task.key}
    >
      <Icon name="task" size={12} className="inline" /> <span className="text-muted">{task.key}</span> {task.title}
    </Link>
  );
}

// The tasks due on a day: a few cards and a "+N" counter for the rest, so a busy day
// doesn't push the grid away (on a phone above all). The counter opens them all.
function DayTasks({ tasks, taskHref }: { tasks: CalendarTask[]; taskHref: (task: CalendarTask) => string }) {
  const [open, setOpen] = useState(false);
  if (!tasks.length) return null;
  const shown = open ? tasks : tasks.slice(0, TASKS_PER_DAY);
  const more = tasks.length - shown.length;
  return (
    <div className="space-y-0.5" data-day-tasks={tasks.length}>
      {shown.map((task) => (
        <TaskCard key={task.id} task={task} href={taskHref(task)} />
      ))}
      {(more > 0 || open) && tasks.length > TASKS_PER_DAY && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          className="block min-h-6 w-full rounded px-1 text-left text-xs text-muted hover:bg-surface hover:text-foreground"
          aria-expanded={open}
          data-more-tasks
        >
          {open ? c.tasks.fewer : c.tasks.more(more)}
        </button>
      )}
    </div>
  );
}

function MonthView({
  anchor,
  today,
  events,
  absences,
  holidays,
  birthdays,
  tasks,
  timeOffHref,
  workDays,
  me,
  myRequests,
  policyName,
  onMyAbsence,
  canPick,
  onPick,
  onPickDay,
  onEvent,
}: {
  anchor: Date;
  today: Date;
  events: CalendarEvent[];
  absences: Absence[];
  holidays: Holiday[];
  birthdays: Birthday[];
  tasks: CalendarTask[];
  timeOffHref: string;
  workDays: number[];
  me: string;
  myRequests: MyLeaveRequest[];
  policyName: (id: string) => string;
  onMyAbsence: (id: string) => void;
  canPick: boolean;
  onPick: (picked: GridPick) => void;
  onPickDay: (day: Date) => void;
  onEvent: (event: CalendarEvent) => void;
}) {
  const grid = monthGrid(anchor);
  const weekday = new Intl.DateTimeFormat(dateLocale(), { weekday: "short" });
  // Days are picked by a click or by dragging across cells — along a week or down the weeks.
  const drag = useDayDrag("day", (range) => onPick({ kind: "days", ...range }));
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
          const off = offOn(absences, day, workDays, holidays);
          const holiday = holidayOn(holidays, day);
          const outside = day.getMonth() !== anchor.getMonth();
          const isToday = dayKey(day) === dayKey(today);
          return (
            <div
              key={dayKey(day)}
              className={`min-h-20 min-w-0 select-none border-border p-1 md:min-h-28 ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${
                drag.isSelected(dayKey(day)) ? "bg-accent/20" : `${workDays.includes(weekdayOf(day)) && !holiday ? "" : "bg-surface/60"} ${canPick ? "cursor-cell hover:bg-accent/10" : ""}`
              }`}
              data-day={dayKey(day)}
              data-holiday={holiday?.name}
              data-picked={drag.isSelected(dayKey(day)) || undefined}
              {...(canPick ? drag.handlers(dayKey(day)) : {})}
              onClick={(e) => {
                // A tap on the empty part of a cell (a mouse press was already taken as a pick).
                if (!canPick || drag.consumeClick() || (e.target as HTMLElement).closest("a, button")) return;
                onPick({ kind: "days", first: dayKey(day), last: dayKey(day) });
              }}
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
              {holiday && (
                <p className="truncate px-1 text-[10px] leading-4 text-muted" title={holiday.name}>
                  <Icon name="star" size={12} className="inline" /> <span className="hidden sm:inline">{holiday.name}</span>
                </p>
              )}
              <div className="hidden space-y-0.5 sm:block">
                {birthdaysOn(birthdays, day).map((birthday) => (
                  <BirthdayChip key={birthday.user_id} birthday={birthday} />
                ))}
                {waitingOn(myRequests, day).map((request) => (
                  <WaitingChip key={request.id} request={request} name={policyName(request.policy_id)} onOpen={onMyAbsence} />
                ))}
                {off.length === 1 && off[0].user_id === me && <AbsenceChip absence={off[0]} href={timeOffHref} onOpen={onMyAbsence} />}
                {off.length > 0 && !(off.length === 1 && off[0].user_id === me) && (
                  <Link href={timeOffHref} className="block truncate rounded border border-border bg-surface px-1 text-xs leading-5 text-muted hover:text-foreground" title={off.map(absenceTitle).join("\n")} data-absences={off.length}>
                    <Icon name="sun" size={12} className="inline" /> {off.length === 1 ? off[0].person : c.offCount(off.length)}
                  </Link>
                )}
                {dayEvents.slice(0, 3).map((event) => (
                  <EventChip key={eventKey(event)} event={event} onOpen={onEvent} />
                ))}
                {dueOn(tasks, day).length > 0 && (
                  <button type="button" onClick={() => onPickDay(day)} className="block w-full truncate rounded border border-border bg-background px-1 text-left text-xs leading-5 text-muted hover:text-foreground" data-month-tasks={dueOn(tasks, day).length}>
                    <Icon name="task" size={12} className="inline" /> {c.tasks.count(dueOn(tasks, day).length)}
                  </button>
                )}
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
  holidays,
  birthdays,
  tasks,
  taskHref,
  timeOffHref,
  nameOf,
  workDays,
  me,
  myRequests,
  policyName,
  onMyAbsence,
  canPick,
  onPick,
  onEvent,
}: {
  from: Date;
  days: number;
  today: Date;
  events: CalendarEvent[];
  busy: BusySlot[];
  absences: Absence[];
  holidays: Holiday[];
  birthdays: Birthday[];
  tasks: CalendarTask[];
  taskHref: (task: CalendarTask) => string;
  timeOffHref: string;
  nameOf: (id: string) => string;
  workDays: number[];
  me: string;
  myRequests: MyLeaveRequest[];
  policyName: (id: string) => string;
  onMyAbsence: (id: string) => void;
  canPick: boolean;
  onPick: (picked: GridPick) => void;
  onEvent: (event: CalendarEvent) => void;
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

  // The "all day" row: a click or a drag along the days picks whole days.
  const dayDrag = useDayDrag("allDay", (range) => onPick({ kind: "days", ...range }));
  // The hours: the slot under the pointer is shown, and a drag — down the hours, and
  // across the days — picks a stretch of time that sticks to the nearest quarter of an hour.
  type TimePoint = { day: string; minutes: number };
  const [hover, setHover] = useState<TimePoint | null>(null);
  const [stretch, setStretch] = useState<{ anchor: TimePoint; current: TimePoint } | null>(null);
  const live = useRef<{ anchor: TimePoint; current: TimePoint } | null>(null);
  const justDragged = useRef(false);
  const pointAt = (x: number, y: number): TimePoint | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const day = (el as HTMLElement).dataset?.dayColumn;
      if (day) {
        const minutes = Math.round((((y - el.getBoundingClientRect().top) / HOUR_PX) * 60) / SNAP_MINUTES) * SNAP_MINUTES;
        return { day, minutes: Math.max(0, Math.min(24 * 60, minutes)) };
      }
    }
    return null;
  };
  const moment = (point: TimePoint) => new Date(fromDayKey(point.day).getTime() + point.minutes * 60_000);
  const picked = stretch
    ? moment(stretch.anchor).getTime() <= moment(stretch.current).getTime()
      ? { start: moment(stretch.anchor), end: moment(stretch.current) }
      : { start: moment(stretch.current), end: moment(stretch.anchor) }
    : null;
  const finishStretch = (take: boolean) => {
    const done = live.current;
    live.current = null;
    setStretch(null);
    if (!done || !take) return;
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    const [from, to] = [moment(done.anchor).getTime(), moment(done.current).getTime()].sort((x, y) => x - y);
    // A press without a move is an hour from that slot; a drag is at least half an hour.
    const start = new Date(Math.min(from, fromDayKey(done.anchor.day).getTime() + 23.5 * 3_600_000));
    onPick({ kind: "time", start: from === to ? start : new Date(from), end: new Date(from === to ? start.getTime() + 3_600_000 : Math.max(to, from + 30 * 60_000)) });
  };

  return (
    <div className="flex h-full min-h-96 flex-col overflow-hidden rounded-lg border border-border" data-week data-week-days={days}>
      <div className="grid border-b border-border bg-surface text-sm" style={template}>
        <div />
        {columns.map((day) => (
          <div key={dayKey(day)} className={`border-l border-border px-1 py-1 text-center first-letter:uppercase ${dayKey(day) === dayKey(today) ? "font-semibold text-accent" : ""}`}>
            {head.format(day)}
            {holidayOn(holidays, day) && (
              <span className="block truncate text-[10px] font-normal leading-3 text-muted" title={holidayOn(holidays, day)?.name} data-holiday={holidayOn(holidays, day)?.name}>
                <Icon name="star" className="mr-1 inline" />
                {holidayOn(holidays, day)?.name}
              </span>
            )}
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
            <div
              key={dayKey(day)}
              className={`min-h-7 min-w-0 select-none space-y-0.5 border-l border-border p-0.5 ${dayDrag.isSelected(dayKey(day)) ? "bg-accent/20" : canPick ? "cursor-cell hover:bg-accent/10" : ""}`}
              data-all-day={dayKey(day)}
              data-picked={dayDrag.isSelected(dayKey(day)) || undefined}
              {...(canPick ? dayDrag.handlers(dayKey(day)) : {})}
              onClick={(e) => {
                if (!canPick || dayDrag.consumeClick() || (e.target as HTMLElement).closest("a, button")) return;
                onPick({ kind: "days", first: dayKey(day), last: dayKey(day) });
              }}
            >
              {birthdaysOn(birthdays, day).map((birthday) => (
                <BirthdayChip key={birthday.user_id} birthday={birthday} />
              ))}
              {whole.map((event) => (
                <EventChip key={eventKey(event)} event={event} onOpen={onEvent} withTime={false} />
              ))}
              {waitingOn(myRequests, day).map((request) => (
                <WaitingChip key={request.id} request={request} name={policyName(request.policy_id)} onOpen={onMyAbsence} />
              ))}
              {offOn(absences, day, workDays, holidays).map((absence) => (
                <AbsenceChip key={absence.id} absence={absence} href={timeOffHref} onOpen={absence.user_id === me ? onMyAbsence : undefined} />
              ))}
              <DayTasks tasks={dueOn(tasks, day)} taskHref={taskHref} />
              {wholeBusy.map((slot, i) => (
                <div key={i} className="truncate rounded border border-border bg-surface px-1 text-xs leading-5 text-muted" data-busy={slot.outside ? "outside" : ""}>
                  {slot.outside ? c.outside.mine : c.busyOf(nameOf(slot.user_id))}
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
                className={`relative select-none border-l border-border ${canPick ? "cursor-cell" : ""} ${workDays.includes(weekdayOf(day)) && !holidayOn(holidays, day) ? "" : "bg-surface/60"}`}
                style={{ backgroundImage: "linear-gradient(to bottom, var(--border) 1px, transparent 1px)", backgroundSize: `100% ${HOUR_PX}px`, touchAction: "pan-y" }}
                onPointerMove={(e) => {
                  if (!canPick || e.pointerType === "touch") return;
                  const point = pointAt(e.clientX, e.clientY);
                  if (live.current) {
                    if (point && (point.day !== live.current.current.day || point.minutes !== live.current.current.minutes)) {
                      live.current = { ...live.current, current: point };
                      setStretch(live.current);
                    }
                  } else {
                    // Over an event nothing new is offered.
                    const free = point && !(e.target as HTMLElement).closest("button, a");
                    setHover(free ? { day: point.day, minutes: Math.min(point.minutes, 23.5 * 60) } : null);
                  }
                }}
                onPointerLeave={() => setHover(null)}
                onPointerDown={(e) => {
                  if (!canPick || e.pointerType === "touch" || e.button !== 0 || (e.target as HTMLElement).closest("button, a")) return;
                  const point = pointAt(e.clientX, e.clientY);
                  if (!point) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  live.current = { anchor: point, current: point };
                  setStretch(live.current);
                  setHover(null);
                }}
                onPointerUp={() => finishStretch(true)}
                onPointerCancel={() => finishStretch(false)}
                onClick={(e) => {
                  // A tap (a mouse press was already taken as a pick): an hour from that half hour.
                  if (!canPick || justDragged.current || (e.target as HTMLElement).closest("button, a")) return;
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  const minutes = Math.max(0, Math.min(23.5 * 60, Math.floor((y / HOUR_PX) * 2) * 30));
                  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
                  onPick({ kind: "time", start, end: new Date(start.getTime() + 3_600_000) });
                }}
                data-day-column={dayKey(day)}
              >
                {/* The slot under the pointer: where a click would start an event. */}
                {hover && hover.day === dayKey(day) && !stretch && (
                  <div className="pointer-events-none absolute inset-x-0.5 rounded border border-accent/60 bg-accent/10 px-1 text-[10px] leading-4 text-accent" style={{ top: (hover.minutes / 60) * HOUR_PX, height: HOUR_PX / 2 }} data-hover-slot>
                    {timeOf(moment(hover))}
                  </div>
                )}
                {/* What is being dragged out, as it would be made. */}
                {picked &&
                  (() => {
                    const dayStart = startOfDay(day).getTime();
                    const top = Math.max(picked.start.getTime(), dayStart);
                    const bottom = Math.min(picked.end.getTime(), dayStart + DAY_MS);
                    if (bottom <= top && !(picked.start.getTime() === picked.end.getTime() && dayKey(picked.start) === dayKey(day))) return null;
                    return (
                      <div
                        className="pointer-events-none absolute inset-x-0.5 z-10 overflow-hidden rounded border border-accent bg-accent/25 px-1 text-[10px] font-medium leading-4"
                        style={{ top: ((top - dayStart) / 3_600_000) * HOUR_PX, height: Math.max(((bottom - top) / 3_600_000) * HOUR_PX, 4) }}
                        data-drag-selection
                      >
                        {dayKey(picked.start) === dayKey(day) && `${timeOf(picked.start)} – ${timeOf(picked.end)}`}
                      </div>
                    );
                  })()}
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
                    data-busy={p.item.outside ? "outside" : ""}
                  >
                    {p.item.outside ? c.outside.mine : c.busyOf(nameOf(p.item.user_id))}
                  </div>
                ))}
                {timed.map((p) => (
                  <button
                    key={eventKey(p.item)}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEvent(p.item);
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
                    <span className="block truncate font-medium">
                      {p.item.title}
                      {p.item.recurring && <span className="ml-1 opacity-70" aria-label={c.repeat.title} data-recurring>
            <Icon name="refresh" size={11} className="inline" />
          </span>}
                    </span>
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
  birthdays,
  tasks,
  taskHref,
  timeOffHref,
  cancelled,
  loading,
  onEvent,
  onRestore,
}: {
  from: Date;
  events: CalendarEvent[];
  absences: Absence[];
  birthdays: Birthday[];
  tasks: CalendarTask[];
  taskHref: (task: CalendarTask) => string;
  timeOffHref: string;
  cancelled: CancelledEvent[];
  loading: boolean;
  onEvent: (event: CalendarEvent) => void;
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
              <li key={eventKey(event)}>
                <button type="button" onClick={() => onEvent(event)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface" data-event={event.title}>
                  <span className="w-24 shrink-0 text-sm text-muted">{event.all_day ? c.allDay : `${timeOf(span.start)} – ${timeOf(span.end)}`}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-medium ${event.my_status === "declined" ? "text-muted line-through" : ""}`}>{event.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {[c.kinds[event.visibility], event.recurring ? c.repeat.title.toLowerCase() : null, event.location, event.my_status ? c.details.status[event.my_status] : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {event.requests > 0 && <span className="rounded-full bg-accent px-2 text-xs text-white">{c.details.requestsCount(event.requests)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {tasks.length > 0 && (
        <section className="mt-6" data-list-tasks>
          <h3 className="mb-1 text-sm font-medium text-muted">{c.tasks.title}</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {tasks.slice(0, 40).map((task) => (
              <li key={task.id}>
                <Link href={taskHref(task)} className="flex min-h-11 items-center gap-3 px-3 py-1 text-sm hover:bg-surface" data-calendar-task={task.key}>
                  <span className="w-20 shrink-0 text-xs text-muted">{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(fromDayKey(task.due_date))}</span>
                  <span className={`min-w-0 flex-1 truncate ${task.done ? "text-muted line-through" : ""}`}>
                    <span className="text-muted">{task.key}</span> {task.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {tasks.length > 40 && <p className="mt-1 text-xs text-muted">{c.tasks.more(tasks.length - 40)}</p>}
        </section>
      )}
      {birthdays.length > 0 && (
        <section className="mt-6" data-list-birthdays>
          <h3 className="mb-1 text-sm font-medium text-muted">{c.birthdays.title}</h3>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {birthdays.slice(0, 40).map((birthday) => (
              <li key={`${birthday.user_id}-${birthday.day}`} className="flex min-h-11 items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-2 text-sm" data-birthday={birthday.name}>
                <Icon name="gift" size={14} className="text-accent" />
                <span className="min-w-0 flex-1 truncate">{birthday.mine ? c.birthdays.mine : birthday.name}</span>
                <span className="shrink-0 text-xs text-muted">{new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(fromDayKey(birthday.day))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {absences.length > 0 && (
        <section className="mt-6" data-list-absences>
          <h3 className="mb-1 text-sm font-medium text-muted">{t.timeOff.title}</h3>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {absences.slice(0, 30).map((absence) => (
              <li key={absence.id}>
                <Link href={timeOffHref} className="flex min-h-11 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-surface" title={absenceTitle(absence)}>
                  <Icon name={absence.remote ? "home" : "sun"} size={12} className="inline" />
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
