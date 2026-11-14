import { dateLocale, t } from "@/i18n";
import type { HostingStats } from "@/lib/vercel-monitor";
import { Icon } from "@/components/ui/icon";

// ADMIN-3: the hosting — deployments in the last 24 hours against the plan's daily limit
// (amber from 70 %, red from 85 %), the last 7 days, failed builds and build time, the live
// site's last deployment. Traffic and function time come only with the paid plan.

const h = t.platform.hosting;
const LIMIT = 100;
const level = (share: number) => (share >= 0.85 ? "critical" : share >= 0.7 ? "warning" : "good");
const LEVEL_COLOR = { good: "#0ca30c", warning: "#fab219", critical: "#d03b3b" } as const;
const LEVEL_ICON = { good: "check-circle", warning: "alert", critical: "alert" } as const;

export function Hosting({ stats }: { stats: HostingStats }) {
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4" data-hosting data-hosting-state={stats.state}>
      <h2 className="font-semibold">{h.title}</h2>
      {stats.state === "not_set" && <p className="mt-2 text-sm text-muted">{h.notSet}</p>}
      {stats.state === "error" && <p className="mt-2 text-sm text-muted">{h.error}</p>}
      {stats.state === "ok" && <HostingBody stats={stats} />}
      <p className="mt-3 text-xs text-muted">{h.paidOnly}</p>
    </section>
  );
}

function HostingBody({ stats }: { stats: Extract<HostingStats, { state: "ok" }> }) {
  const share = stats.last24h / LIMIT;
  const lv = level(share);
  const max = Math.max(...stats.days.map((d) => d.total), 1);
  return (
    <>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border p-3" data-hosting-gauge data-monitor-level={lv}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{h.deployments24h}</span>
            <span className="text-xs text-muted tabular-nums">
              {stats.last24h} / {LIMIT}
            </span>
          </div>
          <div className="relative mt-2 h-3 w-full overflow-hidden rounded-full bg-hover" role="img" aria-label={`${h.deployments24h}: ${stats.last24h} / ${LIMIT}`}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(share, 1) * 100}%`, background: LEVEL_COLOR[lv] }} />
            <span aria-hidden="true" className="absolute top-0 h-full w-px bg-border-strong" style={{ left: "70%" }} />
            <span aria-hidden="true" className="absolute top-0 h-full w-px bg-border-strong" style={{ left: "85%" }} />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs">
            <Icon name={LEVEL_ICON[lv]} size={14} />
            <span className="font-medium tabular-nums">{Math.round(share * 100)}%</span>
            <span className="text-muted">{h.levels[lv]}</span>
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 text-sm">
          <div>
            <dt className="text-xs text-muted">{h.failed}</dt>
            <dd className="text-lg font-semibold tabular-nums">{Math.round(stats.failedShare * 100)}%</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{h.buildTime}</dt>
            <dd className="text-lg font-semibold tabular-nums">{stats.averageBuildSeconds === null ? "—" : h.seconds(stats.averageBuildSeconds)}</dd>
          </div>
          <div className="col-span-2" data-hosting-last>
            <dt className="text-xs text-muted">{h.lastProduction}</dt>
            <dd>
              {stats.lastProduction
                ? `${h.states[stats.lastProduction.state as keyof typeof h.states] ?? stats.lastProduction.state} · ${new Date(stats.lastProduction.at).toLocaleString(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                : "—"}
            </dd>
          </div>
        </dl>
      </div>
      <h3 className="mt-4 text-sm font-medium">{h.week}</h3>
      {/* Seven thin bars on one axis; each names its day, count and failed count on hover. */}
      <div className="mt-2 flex h-24 items-end gap-2" role="img" aria-label={stats.days.map((d) => `${d.day}: ${d.total}`).join(", ")} data-hosting-week>
        {stats.days.map((d) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${new Date(d.day).toLocaleDateString(dateLocale())}: ${h.dayTitle(d.total, d.failed)}`}>
            <span className="text-[11px] text-muted tabular-nums">{d.total}</span>
            <div className="w-full max-w-8 rounded-t-[4px]" style={{ height: `${Math.max((d.total / max) * 70, d.total ? 3 : 0)}%`, background: "var(--rm-done)" }} />
            <span className="text-[11px] text-muted">{new Date(d.day).toLocaleDateString(dateLocale(), { weekday: "short" })}</span>
          </div>
        ))}
      </div>
    </>
  );
}
