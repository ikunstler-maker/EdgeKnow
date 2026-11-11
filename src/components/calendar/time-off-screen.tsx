"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { dateLocale, t } from "@/i18n";
import {
  accrueLeaveYear,
  adjustLeaveBalance,
  cancelLeave,
  copyHolidays,
  decideLeave,
  deleteHoliday,
  loadAbsences,
  loadBalanceSheet,
  loadHolidays,
  loadLeaveInbox,
  loadMyLeave,
  loadUnitOverlaps,
  requestLeave,
  saveHoliday,
  saveLeavePolicy,
  seedLeavePolicies,
  setStartDate,
} from "@/app/time-off-actions";
import type { CalendarPerson } from "@/lib/calendar";
import { workspacePath } from "@/lib/paths";
import {
  LEAVE_ACCRUALS,
  LEAVE_KINDS,
  NEW_POLICY,
  daysText,
  left,
  parseDay,
  type Absence,
  type BalanceSheet,
  type Holiday,
  type InboxRequest,
  type LeaveHalf,
  type LeavePolicy,
  type LeavePolicyFields,
  type MyLeave,
  type UnitOverlap,
} from "@/lib/time-off";
import { buttonClass, inputClass, primaryClass } from "./calendar-parts";
import { Icon } from "@/components/ui/icon";

const o = t.timeOff;
const TABS = ["mine", "inbox", "team", "settings"] as const;
type Tab = (typeof TABS)[number];

const errorText = (code: string) => o.errors[code] ?? o.errors.unknown;
const num = (n: number) => daysText(n, dateLocale());

function periodText(item: { start_date: string; end_date: string; half: LeaveHalf | null }) {
  const format = new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short", year: "numeric" });
  if (item.start_date === item.end_date) return `${format.format(parseDay(item.start_date))}${item.half ? ` · ${o.half[item.half]}` : ""}`;
  return `${format.format(parseDay(item.start_date))} – ${format.format(parseDay(item.end_date))}`;
}

const statusClass: Record<string, string> = {
  pending: "border-accent/40 bg-accent/10",
  approved: "border-accent bg-accent text-white",
  rejected: "border-danger/40 bg-danger/10 text-danger",
  cancelled: "border-border bg-surface text-muted",
};
function Status({ status }: { status: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass[status] ?? ""}`} data-leave-status={status}>
      {o.status[status]}
    </span>
  );
}

// The calendar's two halves: events and time off.
export function DobaNav({ shortId, current }: { shortId: string; current: "events" | "timeOff" }) {
  const item = (key: "events" | "timeOff", href: string) => (
    <Link
      href={href}
      aria-current={current === key ? "page" : undefined}
      className={`inline-flex min-h-10 items-center rounded-md px-3 text-[13px] font-medium md:h-7 md:min-h-0 ${current === key ? "bg-background text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
      data-doba-nav={key}
    >
      {o.nav[key]}
    </Link>
  );
  return (
    <nav className="inline-flex rounded-lg border border-border bg-hover p-0.5" aria-label={t.calendar.title}>
      {item("events", workspacePath(shortId, "/calendar"))}
      {item("timeOff", workspacePath(shortId, "/calendar/time-off"))}
    </nav>
  );
}

function Shell({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-xl bg-background p-4 shadow-xl sm:rounded-xl"
        data-leave-dialog
      >
        <h2 className="text-lg font-semibold">{label}</h2>
        {children}
      </div>
    </div>
  );
}

function Overlaps({ title, items }: { title: string; items: UnitOverlap[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-md border border-accent/40 bg-accent/5 p-2 text-sm" data-leave-overlaps>
      <p className="font-medium">{title}</p>
      <ul className="mt-1 text-xs">
        {items.slice(0, 8).map((item, i) => (
          <li key={i}>
            {item.name} · {periodText({ ...item, half: null })} · {o.form.overlapStatus[item.status] ?? item.status}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TimeOffScreen({
  shortId,
  workspaceId,
  me,
  guest,
  people,
  initialTab,
}: {
  shortId: string;
  workspaceId: string;
  me: string;
  guest: boolean;
  people: CalendarPerson[];
  initialTab: string | null;
}) {
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "mine");
  const [year, setYear] = useState<number | null>(null);
  const [mine, setMine] = useState<MyLeave | null>(null);
  const [inbox, setInbox] = useState<InboxRequest[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  // Holidays from last year to the next one: for the settings and the hint to who decides.
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [asking, setAsking] = useState(false);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (guest) return;
    let live = true;
    // The first read doesn't know the workspace's "today" yet: the browser's year will do.
    const wanted = year ?? new Date().getFullYear();
    Promise.all([loadMyLeave(shortId, workspaceId, wanted), loadLeaveInbox(shortId, workspaceId)]).then(([loaded, requests]) => {
      if (!live) return;
      if (!loaded.ok) return setError(errorText(loaded.error));
      setError(null);
      setMine(loaded);
      setInbox(requests);
      const today = parseDay(loaded.today);
      const until = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 90);
      const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      loadAbsences(shortId, workspaceId, loaded.today, key(until)).then((list) => live && setAbsences(list));
      loadHolidays(shortId, workspaceId, `${today.getFullYear() - 1}-01-01`, `${today.getFullYear() + 1}-12-31`).then((list) => live && setHolidays(list));
    });
    return () => {
      live = false;
    };
  }, [shortId, workspaceId, guest, year, tick]);

  if (guest) {
    return (
      <main className="flex min-w-0 flex-1 flex-col px-3 py-4 md:px-6" data-time-off>
        <h1 className="text-xl font-semibold tracking-tight"><Icon name="calendar" className="mr-1.5 inline" />{o.title}</h1>
        <p className="mt-3 text-muted">{o.guest}</p>
      </main>
    );
  }

  const thisYear = mine ? parseDay(mine.today).getFullYear() : new Date().getFullYear();
  const shownYear = year ?? thisYear;
  const waiting = inbox.filter((r) => r.status === "pending").length;
  const tabs = TABS.filter((key) => key !== "settings" || mine?.manager);
  const active = mine?.policies.filter((p) => p.active) ?? [];

  return (
    <main className="flex min-w-0 flex-1 flex-col px-3 py-4 md:px-6" data-time-off>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight"><Icon name="calendar" className="mr-1.5 inline" />{o.title}</h1>
        <DobaNav shortId={shortId} current="timeOff" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-md border border-border" role="tablist">
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`min-h-11 px-3 text-sm first:rounded-l-md last:rounded-r-md md:min-h-9 ${tab === key ? "bg-accent text-white" : "hover:bg-surface"}`}
              data-leave-tab={key}
            >
              {o.tabs[key]}
              {key === "inbox" && waiting > 0 && <span className="ml-1 rounded-full bg-danger px-1.5 text-xs text-white">{waiting}</span>}
            </button>
          ))}
        </div>
        {(tab === "mine" || tab === "settings") && (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-muted">{o.year}</span>
            <select value={shownYear} onChange={(e) => setYear(Number(e.target.value))} className={`${inputClass} w-28`} data-leave-year>
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <p className="mt-3 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm">{error}</p>}
      {!mine && !error && <p className="mt-4 text-muted">{t.calendar.loading}</p>}

      {mine && tab === "mine" && (
        <section className="mt-4 max-w-4xl" data-leave-mine>
          {active.length === 0 ? (
            <p className="text-muted">{mine.manager ? o.settings.seedIntro : o.noPolicies}</p>
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {active.map((p) => (
                  <li key={p.id} className="rounded-lg border border-border p-3" data-leave-balance={p.name}>
                    <p className="truncate text-sm text-muted">{p.name}</p>
                    {p.unlimited ? (
                      <p className="mt-1 text-xl font-semibold">{o.balance.used(num(p.used))}</p>
                    ) : (
                      <p className="mt-1 text-xl font-semibold" data-leave-left>
                        {o.balance.left(num(left(p)))}
                        <span className="ml-1 text-sm font-normal text-muted">{o.balance.of(num(p.granted))}</span>
                      </p>
                    )}
                    <p className="text-xs text-muted">{p.unlimited ? o.balance.unlimited : Number(p.pending) > 0 ? o.balance.waiting(num(p.pending)) : " "}</p>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setAsking(true)} className={`${primaryClass} mt-4`} data-new-leave>
                <Icon name="plus" className="mr-1 inline" />
                {o.newRequest}
              </button>
            </>
          )}
          {mine.started_on && (
            <p className="mt-3 text-xs text-muted" data-started-on>
              {o.startedOn(new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(parseDay(mine.started_on)))}
            </p>
          )}
          <h2 className="mt-6 text-sm font-medium text-muted">{o.myRequests}</h2>
          {mine.requests.length === 0 ? (
            <p className="mt-1 text-muted">{o.noRequests}</p>
          ) : (
            <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
              {mine.requests.map((r) => {
                const policy = mine.policies.find((p) => p.id === r.policy_id);
                const canCancel = r.status === "pending" || (r.status === "approved" && r.start_date > mine.today);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-leave-request={policy?.name ?? ""}>
                    <div className="min-w-48 flex-1">
                      <p className="font-medium">
                        {policy?.name} · {o.days(num(r.days))}
                      </p>
                      <p className="text-sm text-muted">
                        {periodText(r)}
                        {r.deputy ? ` · ${o.deputy(r.deputy)}` : ""}
                      </p>
                      {r.decision_note && <p className="text-sm text-muted">«{r.decision_note}»</p>}
                    </div>
                    <Status status={r.status} />
                    {canCancel && (
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={async () => {
                          if (!confirm(o.cancelConfirm)) return;
                          const result = await cancelLeave(shortId, r.id);
                          if (!result.ok) setError(errorText(result.error));
                          reload();
                        }}
                        data-cancel-leave
                      >
                        {o.cancel}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {mine && tab === "inbox" && <Inbox shortId={shortId} workspaceId={workspaceId} today={mine.today} items={inbox} holidays={holidays} onChanged={reload} />}

      {mine && tab === "team" && (
        <section className="mt-4 max-w-3xl" data-leave-team>
          {absences.length === 0 ? (
            <p className="text-muted">{o.team.empty}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {absences.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-absence={a.person}>
                  <span className="text-xl" aria-hidden="true">
                    <Icon name={a.remote ? "home" : "sun"} size={14} className="inline" />
                  </span>
                  <div className="min-w-48 flex-1">
                    <p className="truncate font-medium">{a.person}</p>
                    <p className="text-sm text-muted">
                      {a.label ?? (a.remote ? o.team.remote : o.team.absent)} · {periodText(a)}
                      {a.deputy ? ` · ${o.deputy(a.deputy)}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {mine && tab === "settings" && mine.manager && (
        <Settings shortId={shortId} workspaceId={workspaceId} year={shownYear} thisYear={thisYear} policies={mine.policies} people={people} holidays={holidays} tick={tick} onChanged={reload} />
      )}

      {asking && mine && (
        <RequestDialog
          shortId={shortId}
          workspaceId={workspaceId}
          me={me}
          today={mine.today}
          policies={active}
          people={people.filter((p) => p.id !== me)}
          onClose={() => setAsking(false)}
          onSent={() => {
            setAsking(false);
            reload();
          }}
        />
      )}
    </main>
  );
}

// One's own absence or request, opened from the calendar: what it is, and "withdraw" —
// while it waits, or (approved) before its first day; after that who decides cancels it.
export function MyAbsenceDialog({
  shortId,
  request,
  policy,
  today,
  onClose,
  onChanged,
}: {
  shortId: string;
  request: MyLeave["requests"][number];
  policy: string;
  today: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canWithdraw = request.status === "pending" || (request.status === "approved" && request.start_date > today);
  return (
    <Shell label={policy} onClose={onClose}>
      <div className="mt-2 space-y-1" data-my-absence>
        <p>
          {periodText(request)} · {o.days(num(request.days))}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Status status={request.status} />
          {request.deputy ? o.deputy(request.deputy) : null}
        </p>
        {!canWithdraw && request.status === "approved" && <p className="text-sm text-muted">{o.errors.started}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {canWithdraw && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!confirm(o.cancelConfirm)) return;
              setBusy(true);
              const result = await cancelLeave(shortId, request.id);
              setBusy(false);
              if (!result.ok) return setError(errorText(result.error));
              onChanged();
              onClose();
            }}
            className={`${buttonClass} mr-auto text-danger`}
            data-withdraw-leave
          >
            {o.cancel}
          </button>
        )}
        <button type="button" onClick={onClose} className={buttonClass}>
          {t.calendar.form.close}
        </button>
      </div>
    </Shell>
  );
}

// The request window. From the calendar it opens with the days picked on the grid.
export function RequestDialog({
  shortId,
  workspaceId,
  me,
  today,
  policies,
  people,
  initialFrom,
  initialTo,
  onClose,
  onSent,
}: {
  shortId: string;
  workspaceId: string;
  me: string;
  today: string;
  policies: LeavePolicy[];
  people: CalendarPerson[];
  initialFrom?: string;
  initialTo?: string;
  onClose: () => void;
  // "pending": waits for approval; "approved": active at once.
  onSent: (status: string) => void;
}) {
  const f = o.form;
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? "");
  const [from, setFrom] = useState(initialFrom ?? today);
  const [to, setTo] = useState(initialTo ?? initialFrom ?? today);
  const [half, setHalf] = useState<"" | LeaveHalf>("");
  const [deputy, setDeputy] = useState("");
  const [comment, setComment] = useState("");
  const [overlaps, setOverlaps] = useState<UnitOverlap[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const policy = policies.find((p) => p.id === policyId);
  const single = from === to;
  const valid = !!policy && !!from && !!to && to >= from && from.slice(0, 4) === to.slice(0, 4);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    const timer = setTimeout(() => loadUnitOverlaps(shortId, workspaceId, me, from, to, null).then((list) => live && setOverlaps(list)), 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [shortId, workspaceId, me, from, to, valid]);

  const send = async () => {
    if (!policy || !valid) return setError(o.errors.invalid);
    if (policy.requires_deputy && !deputy) return setError(o.errors.deputy_required);
    setSaving(true);
    const result = await requestLeave(shortId, workspaceId, { policy: policy.id, from, to, half: single && half ? half : null, deputy: deputy || null, comment });
    setSaving(false);
    if (!result.ok) return setError(errorText(result.error));
    onSent(result.status);
  };

  return (
    <Shell label={f.title} onClose={onClose}>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        data-leave-form
      >
        <label className="block text-sm">
          <span className="text-muted">{f.policy}</span>
          <select value={policyId} onChange={(e) => setPolicyId(e.target.value)} className={`${inputClass} mt-1`} data-leave-field="policy">
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {policy && (
            <span className="mt-1 block text-xs text-muted" data-leave-hint>
              {policy.unlimited ? o.balance.unlimited : `${o.balance.left(num(left(policy) - Number(policy.pending)))} ${f.leftHint}`}
              {policy.allow_negative && !policy.unlimited ? ` · ${f.negativeAllowed}` : ""}
              {" · "}
              {policy.requires_approval ? f.needsApproval : f.noApproval}
            </span>
          )}
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">{f.from}</span>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (e.target.value > to) setTo(e.target.value);
              }}
              className={`${inputClass} mt-1`}
              data-leave-field="from"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">{f.to}</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={`${inputClass} mt-1`} data-leave-field="to" />
          </label>
        </div>
        {single && (
          <label className="block text-sm">
            <span className="text-muted">{f.part}</span>
            <select value={half} onChange={(e) => setHalf(e.target.value as "" | LeaveHalf)} className={`${inputClass} mt-1`} data-leave-field="half">
              <option value="">{o.half.whole}</option>
              <option value="first">{o.half.first}</option>
              <option value="second">{o.half.second}</option>
            </select>
          </label>
        )}
        {from.slice(0, 4) !== to.slice(0, 4) && <p className="text-sm text-danger">{o.errors.split_year}</p>}
        <label className="block text-sm">
          <span className="text-muted">
            {f.deputy}
            {policy?.requires_deputy ? " *" : ""}
          </span>
          <select value={deputy} onChange={(e) => setDeputy(e.target.value)} className={`${inputClass} mt-1`} data-leave-field="deputy">
            <option value="">{f.noDeputy}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Overlaps title={f.overlapTitle} items={valid ? overlaps : []} />
        <label className="block text-sm">
          <span className="text-muted">{f.comment}</span>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={2} className={`${inputClass} mt-1 py-2`} data-leave-field="comment" />
          <span className="mt-1 block text-xs text-muted">{f.commentHint}</span>
        </label>
        {error && (
          <p className="text-sm text-danger" data-leave-error>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonClass}>
            {t.calendar.form.cancel}
          </button>
          <button type="submit" disabled={saving || !valid} className={primaryClass} data-send-leave>
            {f.send}
          </button>
        </div>
      </form>
    </Shell>
  );
}

function Inbox({ shortId, workspaceId, today, items, holidays, onChanged }: { shortId: string; workspaceId: string; today: string; items: InboxRequest[]; holidays: Holiday[]; onChanged: () => void }) {
  const [overlaps, setOverlaps] = useState<Record<string, UnitOverlap[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingKey = items
    .filter((r) => r.status === "pending")
    .slice(0, 20)
    .map((r) => r.id)
    .join(",");

  // Who of the same unit is already off in the days of each waiting request.
  useEffect(() => {
    let live = true;
    const waiting = items.filter((r) => pendingKey.split(",").includes(r.id));
    Promise.all(waiting.map((r) => loadUnitOverlaps(shortId, workspaceId, r.user_id, r.start_date, r.end_date, r.id).then((list) => [r.id, list] as const))).then((pairs) => {
      if (live) setOverlaps(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
    // Only when the set of waiting requests changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortId, workspaceId, pendingKey]);

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    setError(result.ok ? null : errorText(result.error ?? "unknown"));
    onChanged();
  };

  return (
    <section className="mt-4 max-w-3xl" data-leave-inbox>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      {items.length === 0 ? (
        <p className="text-muted">{o.inbox.empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={r.id} className="rounded-lg border border-border p-3" data-inbox-request={r.person}>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <div className="min-w-48 flex-1">
                  <p className="font-medium">{r.person}</p>
                  <p className="text-sm">
                    {r.policy} · {periodText(r)} · {o.days(num(r.days))}
                  </p>
                  <p className="text-sm text-muted">
                    {r.unlimited ? o.balance.unlimited : o.inbox.balance(num(r.balance))}
                    {r.deputy ? ` · ${o.deputy(r.deputy)}` : ""}
                  </p>
                  {r.comment && <p className="mt-1 whitespace-pre-wrap break-words text-sm">«{r.comment}»</p>}
                </div>
                <Status status={r.status} />
              </div>
              {r.status === "pending" && (
                <>
                  <div className="mt-2">
                    <Overlaps title={o.inbox.overlapTitle} items={overlaps[r.id] ?? []} />
                    {/* A holiday added after the request was made isn't taken off its days by itself. */}
                    {r.count_days === "working" &&
                      holidays
                        .filter((h) => h.day >= r.start_date && h.day <= r.end_date && h.created_at > r.created_at)
                        .map((h) => (
                          <p key={h.day} className="mt-1 rounded-md border border-border bg-surface p-2 text-xs" data-holiday-hint>
                            {o.inbox.holidayHint(h.name, new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "long" }).format(parseDay(h.day)))}
                          </p>
                        ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={notes[r.id] ?? ""}
                      onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                      maxLength={500}
                      placeholder={o.inbox.note}
                      aria-label={o.inbox.note}
                      className={`${inputClass} min-w-40 flex-1`}
                    />
                    <button type="button" disabled={busy} onClick={() => run(() => decideLeave(shortId, r.id, true, notes[r.id] ?? ""))} className={primaryClass} data-approve-leave>
                      {o.inbox.approve}
                    </button>
                    <button type="button" disabled={busy} onClick={() => run(() => decideLeave(shortId, r.id, false, notes[r.id] ?? ""))} className={buttonClass} data-reject-leave>
                      {o.inbox.reject}
                    </button>
                  </div>
                </>
              )}
              {r.status === "approved" && r.end_date >= today && (
                <div className="mt-2 flex justify-end">
                  <button type="button" disabled={busy} onClick={() => confirm(o.cancelConfirm) && run(() => cancelLeave(shortId, r.id))} className={buttonClass} data-cancel-approved>
                    {o.inbox.cancelApproved}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Settings({
  shortId,
  workspaceId,
  year,
  thisYear,
  policies,
  people,
  holidays,
  tick,
  onChanged,
}: {
  shortId: string;
  workspaceId: string;
  year: number;
  thisYear: number;
  policies: LeavePolicy[];
  people: CalendarPerson[];
  holidays: Holiday[];
  tick: number;
  onChanged: () => void;
}) {
  const s = o.settings;
  const [editing, setEditing] = useState<{ id: string | null; fields: LeavePolicyFields } | null>(null);
  const [sheet, setSheet] = useState<BalanceSheet | null>(null);
  const [adjusting, setAdjusting] = useState<{ person: string; policy: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useMemo(() => policies.filter((p) => p.active), [policies]);
  const canAccrue = year === thisYear || year === thisYear + 1;
  const [holidayDay, setHolidayDay] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const yearHolidays = holidays.filter((h) => h.day.startsWith(`${year}-`));
  const act = async (action: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    setMessage(result.ok ? (done ?? null) : errorText(result.error ?? "unknown"));
    onChanged();
    return result.ok;
  };

  useEffect(() => {
    let live = true;
    loadBalanceSheet(shortId, workspaceId, year).then((result) => live && result.ok && setSheet(result));
    return () => {
      live = false;
    };
  }, [shortId, workspaceId, year, tick]);

  const seed = async () => {
    setBusy(true);
    const result = await seedLeavePolicies(shortId, workspaceId, s.seedNames);
    setBusy(false);
    setMessage(result.ok ? null : errorText(result.error));
    onChanged();
  };
  const accrue = async (policy: LeavePolicy) => {
    setBusy(true);
    const result = await accrueLeaveYear(shortId, workspaceId, policy.id, year);
    setBusy(false);
    setMessage(result.ok ? s.accrued(policy.name, result.added, year) : errorText(result.error));
    onChanged();
  };

  return (
    <section className="mt-4 max-w-5xl" data-leave-settings>
      {policies.length === 0 ? (
        <div className="rounded-lg border border-border p-4">
          <p>{s.seedIntro}</p>
          <button type="button" disabled={busy} onClick={seed} className={`${primaryClass} mt-3`} data-seed-policies>
            {s.seed}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-sm font-medium text-muted">{s.policies}</h2>
            <button type="button" onClick={() => setEditing({ id: null, fields: NEW_POLICY })} className={buttonClass} data-add-policy>
              <Icon name="plus" className="mr-1 inline" />
              {s.addPolicy}
            </button>
          </div>
          {message && (
            <p className="mt-2 rounded-md border border-border bg-surface p-2 text-sm" data-leave-message>
              {message}
            </p>
          )}
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {policies.map((p) => (
              <li key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${p.active ? "" : "opacity-60"}`} data-policy={p.name}>
                <div className="min-w-48 flex-1">
                  <p className="truncate font-medium">
                    {p.name}
                    {!p.active && <span className="ml-2 text-xs text-muted">{s.off}</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {[
                      p.unlimited ? o.balance.unlimited : s.perYear(num(p.days_per_year)),
                      !p.unlimited && Number(p.carry_over_max) > 0 ? s.carry(num(p.carry_over_max)) : null,
                      !p.unlimited && p.accrual && p.accrual !== "manual" ? s.accruals[p.accrual] : null,
                      p.requires_approval ? s.short.approval : s.short.noApproval,
                      p.requires_deputy ? s.short.deputy : null,
                      p.show_kind ? s.short.shown : s.short.hidden,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {p.active && !p.unlimited && canAccrue && !(p.accrual === "monthly" && year !== thisYear) && (
                  <button type="button" disabled={busy} onClick={() => accrue(p)} className={buttonClass} title={s.accrueHint} data-accrue>
                    {s.accrue(year)}
                  </button>
                )}
                <button type="button" onClick={() => setEditing({ id: p.id, fields: p })} className={buttonClass} data-edit-policy>
                  {s.edit}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">{s.accrueHint}</p>

          <h2 className="mt-6 text-sm font-medium text-muted">{s.sheet(year)}</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-max text-sm" data-balance-sheet>
              <thead>
                <tr className="bg-surface text-left text-muted">
                  <th className="px-3 py-2 font-normal">{s.person}</th>
                  <th className="px-3 py-2 font-normal">{s.startedOn}</th>
                  {active.map((p) => (
                    <th key={p.id} className="px-3 py-2 font-normal">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(sheet?.people ?? []).map((person) => (
                  <tr key={person.id} className="border-t border-border" data-sheet-person={person.name}>
                    <td className="px-3 py-2">{person.name}</td>
                    <td className="px-3 py-1">
                      <input
                        type="date"
                        defaultValue={person.started_on ?? ""}
                        key={person.started_on ?? "none"}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === (person.started_on ?? "")) return;
                          if (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)) act(() => setStartDate(shortId, workspaceId, person.id, value || null));
                        }}
                        aria-label={`${s.startedOn}: ${person.name}`}
                        className="min-h-11 rounded-md border border-border bg-background px-2 text-sm md:min-h-9"
                        data-start-date
                      />
                    </td>
                    {active.map((p) => {
                      const n = person.numbers[p.id];
                      return (
                        <td key={p.id} className="px-3 py-1">
                          <button
                            type="button"
                            onClick={() => setAdjusting({ person: person.id, policy: p.id })}
                            className="min-h-11 rounded-md px-2 text-left hover:bg-surface md:min-h-9"
                            title={s.adjust}
                            data-sheet-cell={p.name}
                          >
                            {p.unlimited ? o.balance.used(num(n?.used ?? 0)) : `${num(left(n ?? { granted: 0, used: 0 }))} / ${num(n?.granted ?? 0)}`}
                            {n && Number(n.pending) > 0 ? <span className="ml-1 text-xs text-muted">({o.balance.waiting(num(n.pending))})</span> : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-muted">{s.sheetHint}</p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-sm font-medium text-muted">{s.holidays(year)}</h2>
            <button type="button" disabled={busy} onClick={() => copyHolidays(shortId, workspaceId, year - 1, year).then((result) => { setMessage(result.ok ? s.holidaysCopied(result.added) : errorText(result.error)); onChanged(); })} className={buttonClass} data-copy-holidays>
              {s.copyHolidays(year - 1)}
            </button>
          </div>
          <form
            className="mt-2 flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!holidayDay || !holidayName.trim()) return;
              if (await act(() => saveHoliday(shortId, workspaceId, holidayDay, holidayName.trim()))) {
                setHolidayDay("");
                setHolidayName("");
              }
            }}
            data-holiday-form
          >
            <label className="block text-sm">
              <span className="text-muted">{s.holidayDay}</span>
              <input type="date" value={holidayDay} min={`${year}-01-01`} max={`${year}-12-31`} onChange={(e) => setHolidayDay(e.target.value)} className={`${inputClass} mt-1`} data-holiday-field="day" />
            </label>
            <label className="block min-w-40 flex-1 text-sm">
              <span className="text-muted">{s.holidayName}</span>
              <input value={holidayName} onChange={(e) => setHolidayName(e.target.value)} maxLength={80} className={`${inputClass} mt-1`} data-holiday-field="name" />
            </label>
            <button type="submit" disabled={busy || !holidayDay || !holidayName.trim()} className={primaryClass} data-add-holiday>
              {s.addHoliday}
            </button>
          </form>
          {yearHolidays.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{s.noHolidays}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border" data-holidays>
              {yearHolidays.map((h) => (
                <li key={h.day} className="flex items-center gap-3 px-3 py-1" data-holiday={h.name}>
                  <span className="w-28 shrink-0 text-sm text-muted">{new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "numeric", month: "short" }).format(parseDay(h.day))}</span>
                  <span className="min-w-0 flex-1 truncate">{h.name}</span>
                  <button type="button" disabled={busy} onClick={() => act(() => deleteHoliday(shortId, workspaceId, h.day))} className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-surface md:h-9 md:w-9" aria-label={s.deleteHoliday(h.name)}>
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-muted">{s.holidaysHint}</p>
        </>
      )}

      {editing && (
        <PolicyDialog
          shortId={shortId}
          workspaceId={workspaceId}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {adjusting && (
        <AdjustDialog
          shortId={shortId}
          workspaceId={workspaceId}
          year={year}
          person={people.find((p) => p.id === adjusting.person)?.name ?? ""}
          personId={adjusting.person}
          policy={policies.find((p) => p.id === adjusting.policy)!}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function Toggle({ label, hint, checked, onChange, name }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; name: string }) {
  return (
    <label className="flex min-h-11 items-start gap-2 py-1 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" data-policy-field={name} />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

function PolicyDialog({
  shortId,
  workspaceId,
  editing,
  onClose,
  onSaved,
}: {
  shortId: string;
  workspaceId: string;
  editing: { id: string | null; fields: LeavePolicyFields };
  onClose: () => void;
  onSaved: () => void;
}) {
  const s = o.settings;
  const [fields, setFields] = useState<LeavePolicyFields>({
    name: editing.fields.name,
    kind: editing.fields.kind,
    days_per_year: Number(editing.fields.days_per_year),
    carry_over_max: Number(editing.fields.carry_over_max),
    count_days: editing.fields.count_days,
    requires_approval: editing.fields.requires_approval,
    requires_deputy: editing.fields.requires_deputy,
    show_kind: editing.fields.show_kind,
    allow_negative: editing.fields.allow_negative,
    accrual: editing.fields.accrual ?? "manual",
    unlimited: editing.fields.unlimited,
    active: editing.fields.active,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof LeavePolicyFields>(key: K, value: LeavePolicyFields[K]) => setFields((now) => ({ ...now, [key]: value }));
  const halves = (value: string) => Math.max(0, Math.min(366, Math.round((Number(value) || 0) * 2) / 2));
  const save = async () => {
    if (!fields.name.trim()) return setError(o.errors.invalid);
    setSaving(true);
    const result = await saveLeavePolicy(shortId, workspaceId, editing.id, { ...fields, name: fields.name.trim() });
    setSaving(false);
    if (!result.ok) return setError(errorText(result.error));
    onSaved();
  };
  return (
    <Shell label={editing.id ? s.editTitle : s.addPolicy} onClose={onClose}>
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        data-policy-form
      >
        <label className="block text-sm">
          <span className="text-muted">{s.fields.name}</span>
          <input value={fields.name} onChange={(e) => set("name", e.target.value)} maxLength={80} className={`${inputClass} mt-1`} data-policy-field="name" />
        </label>
        <label className="block text-sm">
          <span className="text-muted">{s.fields.kind}</span>
          <select value={fields.kind} onChange={(e) => set("kind", e.target.value as LeavePolicyFields["kind"])} className={`${inputClass} mt-1`} data-policy-field="kind">
            {LEAVE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {s.kinds[kind]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">{s.kindHint}</span>
        </label>
        <Toggle name="unlimited" label={s.fields.unlimited} hint={s.hints.unlimited} checked={fields.unlimited} onChange={(v) => set("unlimited", v)} />
        {!fields.unlimited && (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-muted">{s.fields.daysPerYear}</span>
                <input type="number" min={0} max={366} step={0.5} value={fields.days_per_year} onChange={(e) => set("days_per_year", halves(e.target.value))} className={`${inputClass} mt-1`} data-policy-field="days_per_year" />
              </label>
              <label className="block text-sm">
                <span className="text-muted">{s.fields.carryOver}</span>
                <input type="number" min={0} max={366} step={0.5} value={fields.carry_over_max} onChange={(e) => set("carry_over_max", halves(e.target.value))} className={`${inputClass} mt-1`} data-policy-field="carry_over_max" />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-muted">{s.fields.accrual}</span>
              <select value={fields.accrual ?? "manual"} onChange={(e) => set("accrual", e.target.value as LeavePolicyFields["accrual"])} className={`${inputClass} mt-1`} data-policy-field="accrual">
                {LEAVE_ACCRUALS.map((mode) => (
                  <option key={mode} value={mode}>
                    {s.accruals[mode]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-muted">{s.hints.accrual}</span>
            </label>
            <Toggle name="allow_negative" label={s.fields.allowNegative} hint={s.hints.allowNegative} checked={fields.allow_negative} onChange={(v) => set("allow_negative", v)} />
          </>
        )}
        <label className="block text-sm">
          <span className="text-muted">{s.fields.countDays}</span>
          <select value={fields.count_days} onChange={(e) => set("count_days", e.target.value as "working" | "calendar")} className={`${inputClass} mt-1`} data-policy-field="count_days">
            <option value="working">{s.fields.working}</option>
            <option value="calendar">{s.fields.calendar}</option>
          </select>
        </label>
        <Toggle name="requires_approval" label={s.fields.requiresApproval} hint={s.hints.requiresApproval} checked={fields.requires_approval} onChange={(v) => set("requires_approval", v)} />
        <Toggle name="requires_deputy" label={s.fields.requiresDeputy} checked={fields.requires_deputy} onChange={(v) => set("requires_deputy", v)} />
        <Toggle name="show_kind" label={s.fields.showKind} hint={s.hints.showKind} checked={fields.show_kind} onChange={(v) => set("show_kind", v)} />
        <Toggle name="active" label={s.fields.active} hint={s.hints.active} checked={fields.active} onChange={(v) => set("active", v)} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonClass}>
            {t.calendar.form.cancel}
          </button>
          <button type="submit" disabled={saving} className={primaryClass} data-save-policy>
            {t.calendar.form.save}
          </button>
        </div>
      </form>
    </Shell>
  );
}

function AdjustDialog({
  shortId,
  workspaceId,
  year,
  person,
  personId,
  policy,
  onClose,
  onSaved,
}: {
  shortId: string;
  workspaceId: string;
  year: number;
  person: string;
  personId: string;
  policy: LeavePolicy;
  onClose: () => void;
  onSaved: () => void;
}) {
  const s = o.settings;
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = Math.round(Number(days.replace(",", ".")) * 2) / 2;
  const valid = Number.isFinite(amount) && amount !== 0 && Math.abs(amount) <= 366 && reason.trim().length > 0;
  const save = async () => {
    setSaving(true);
    const result = await adjustLeaveBalance(shortId, workspaceId, policy.id, personId, year, amount, reason.trim());
    setSaving(false);
    if (!result.ok) return setError(errorText(result.error));
    onSaved();
  };
  return (
    <Shell label={s.adjustTitle(person, policy.name, year)} onClose={onClose}>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save();
        }}
        data-adjust-form
      >
        <label className="block text-sm">
          <span className="text-muted">{s.adjustDays}</span>
          <input inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} placeholder="+2 / -1.5" className={`${inputClass} mt-1`} data-adjust-field="days" />
        </label>
        <label className="block text-sm">
          <span className="text-muted">{s.adjustReason}</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={`${inputClass} mt-1`} data-adjust-field="reason" />
          <span className="mt-1 block text-xs text-muted">{s.adjustHint}</span>
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonClass}>
            {t.calendar.form.cancel}
          </button>
          <button type="submit" disabled={saving || !valid} className={primaryClass} data-save-adjust>
            {t.calendar.form.save}
          </button>
        </div>
      </form>
    </Shell>
  );
}
