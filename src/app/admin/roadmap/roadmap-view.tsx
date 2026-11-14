"use client";

import { useMemo, useState } from "react";
import { currentLocale, t } from "@/i18n";
import { ROADMAP, STAGE_FLAGS, STAGE_STATUSES, roadmapCounts, type Stage, type StageFlag, type StageStatus, type Track } from "@/lib/roadmap";
import { ServiceIcon } from "@/components/services/service-icon";
import { Icon, type IconName } from "@/components/ui/icon";

// ADMIN-1: the road map — overall progress, what lies ahead needs, and one card per service
// with its stages. Status colours are validated categorical slots (light + dark in globals.css);
// every colour has its label beside it, so nothing is told by colour alone.

const r = t.platform.roadmap;
const lang = () => (currentLocale() === "en" ? "en" : "uk");
const FLAG_ICONS: Record<StageFlag, IconName> = { owner: "user", external: "globe", cost: "tag", db: "database", security: "shield" };
const TRACK_ICONS: Record<NonNullable<Track["icon"]>, IconName> = { platform: "settings", design: "layers", profile: "user", money: "tag" };
const color = (status: StageStatus) => `var(--rm-${status})`;

// One bar of stages by status: thin segments with a 2 px gap; each names itself on hover.
function StatusBar({ counts, total, tall = false }: { counts: Record<StageStatus, number>; total: number; tall?: boolean }) {
  return (
    <div role="img" aria-label={`${r.chartLabel}: ${STAGE_STATUSES.map((s) => `${r.status[s]} ${counts[s]}`).join(", ")}`} className={`flex w-full gap-0.5 ${tall ? "h-4" : "h-2"}`} data-roadmap-bar>
      {STAGE_STATUSES.filter((s) => counts[s] > 0).map((s) => (
        <div key={s} title={`${r.status[s]}: ${counts[s]}`} className="h-full rounded-[4px] first:rounded-l-full last:rounded-r-full" style={{ width: `${(counts[s] / Math.max(total, 1)) * 100}%`, background: color(s) }} />
      ))}
    </div>
  );
}

function Legend({ counts }: { counts: Record<StageStatus, number> }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {STAGE_STATUSES.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: color(s) }} />
          <span className="text-muted">{r.status[s]}</span>
          <span className="font-medium tabular-nums">{counts[s]}</span>
        </li>
      ))}
    </ul>
  );
}

const chip = (on: boolean) =>
  `inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm md:min-h-8 ${on ? "border-foreground bg-hover font-medium" : "border-border text-muted hover:bg-hover"}`;

export function RoadmapView() {
  const [statuses, setStatuses] = useState<Set<StageStatus>>(new Set());
  const [flags, setFlags] = useState<Set<StageFlag>>(new Set());
  const [onlyExtra, setOnlyExtra] = useState(false);
  const L = lang();
  const totals = roadmapCounts();
  const doneShare = Math.round((totals.status.done / Math.max(totals.total, 1)) * 100);

  const toggle = <T,>(set: Set<T>, value: T, apply: (next: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };
  const keep = (stage: Stage) =>
    (!statuses.size || statuses.has(stage.status)) && (!flags.size || [...flags].every((f) => stage.flags?.includes(f))) && (!onlyExtra || stage.extra);
  const tracks = useMemo(
    () => ROADMAP.map((track) => ({ track, shown: track.stages.filter(keep) })).filter((x) => x.shown.length > 0),
    // keep reads the three filters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statuses, flags, onlyExtra],
  );
  const filtered = statuses.size > 0 || flags.size > 0 || onlyExtra;

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-xl border border-border bg-surface p-4" data-roadmap-overall>
        <h2 className="font-semibold">{r.overall}</h2>
        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
          <p className="text-4xl font-semibold tabular-nums">{doneShare}%</p>
          <p className="pb-1 text-sm text-muted">
            {r.doneShare(totals.status.done, totals.total)} · {r.extra(totals.extra)}
          </p>
        </div>
        <div className="mt-3">
          <StatusBar counts={totals.status} total={totals.total} tall />
        </div>
        <Legend counts={totals.status} />
        <h3 className="mt-5 text-sm font-medium text-muted">{r.ahead}</h3>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {STAGE_FLAGS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => toggle(flags, f, setFlags)}
              aria-pressed={flags.has(f)}
              title={r.flagHints[f]}
              className={`flex min-h-11 flex-col items-start gap-1 rounded-lg border p-3 text-left ${flags.has(f) ? "border-foreground bg-hover" : "border-border hover:bg-hover"}`}
              data-roadmap-flag-tile={f}
            >
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <Icon name={FLAG_ICONS[f]} size={14} />
                {r.flags[f]}
              </span>
              <span className="text-2xl font-semibold tabular-nums">{totals.flags[f]}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="space-y-2" data-roadmap-filters>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">{r.filterStatus}:</span>
          {STAGE_STATUSES.map((s) => (
            <button key={s} type="button" aria-pressed={statuses.has(s)} onClick={() => toggle(statuses, s, setStatuses)} className={chip(statuses.has(s))} data-roadmap-status-filter={s}>
              <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: color(s) }} />
              {r.status[s]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">{r.filterFlags}:</span>
          {STAGE_FLAGS.map((f) => (
            <button key={f} type="button" aria-pressed={flags.has(f)} onClick={() => toggle(flags, f, setFlags)} className={chip(flags.has(f))} title={r.flagHints[f]} data-roadmap-flag-filter={f}>
              <Icon name={FLAG_ICONS[f]} size={14} />
              {r.flags[f]}
            </button>
          ))}
          <button type="button" aria-pressed={onlyExtra} onClick={() => setOnlyExtra(!onlyExtra)} className={chip(onlyExtra)} data-roadmap-extra-filter>
            <Icon name="sparkle" size={14} />
            {r.onlyExtra}
          </button>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setStatuses(new Set());
                setFlags(new Set());
                setOnlyExtra(false);
              }}
              className="min-h-11 px-2 text-sm text-accent hover:underline md:min-h-8"
            >
              {r.reset}
            </button>
          )}
        </div>
      </div>

      {tracks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{r.none}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tracks.map(({ track, shown }) => {
            const counts = roadmapCounts([track]);
            return (
              <section key={track.key} className="min-w-0 rounded-xl border border-border bg-surface p-4" data-roadmap-track={track.key}>
                <header className="flex items-center gap-2">
                  {track.service ? <ServiceIcon serviceId={track.service} size={22} /> : <Icon name={TRACK_ICONS[track.icon ?? "platform"]} size={20} className="text-muted" />}
                  <h2 className="min-w-0 flex-1 truncate font-semibold">{track.name[L]}</h2>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {counts.status.done}/{counts.total}
                  </span>
                </header>
                <div className="mt-2">
                  <StatusBar counts={counts.status} total={counts.total} />
                </div>
                <ol className="mt-3 space-y-2">
                  {shown.map((stage) => (
                    <li key={stage.code + stage.title.en} className="flex gap-2" data-roadmap-stage={stage.code} data-roadmap-stage-status={stage.status}>
                      <span aria-hidden="true" className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: color(stage.status) }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="mr-1.5 font-mono text-xs text-muted">{stage.code}</span>
                          {stage.title[L]}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                          <span>{r.status[stage.status]}</span>
                          {stage.pr && (
                            <a href={`https://github.com/ikunstler-maker/EdgeKnow/pull/${stage.pr}`} target="_blank" rel="noreferrer" className="hover:underline">
                              {r.pr(stage.pr)}
                            </a>
                          )}
                          {stage.extra && (
                            <span className="inline-flex items-center gap-1">
                              <Icon name="sparkle" size={12} />
                              {r.added}
                            </span>
                          )}
                          {stage.flags?.map((f) => (
                            <span key={f} title={r.flagHints[f]} className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-px" data-roadmap-stage-flag={f}>
                              <Icon name={FLAG_ICONS[f]} size={12} />
                              {r.flags[f]}
                            </span>
                          ))}
                        </p>
                        {stage.note && <p className="mt-0.5 text-xs text-muted">{stage.note[L]}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
