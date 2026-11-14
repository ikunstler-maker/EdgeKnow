import { dateLocale, t } from "@/i18n";
import { Icon } from "@/components/ui/icon";

// ADMIN-2: the central project's database and storage against the plan's limits (green,
// amber from 70 %, red from 85 %), the 90-day trend with a forecast, and every workspace's
// load. Numbers only; names only of the admin's own workspaces (the database decides).

export type DailyStat = { day: string; database_bytes: number; storage_bytes: number; workspaces: number; members: number; files_bytes: number };
export type WorkspaceLoad = {
  id: string;
  short_id: string;
  name: string | null;
  members: number;
  files_bytes: number;
  storage_limit_mb: number;
  last_activity: string | null;
  data_location: "team" | "setup" | null;
  frozen: boolean;
};

const m = t.platform.monitoring;
const MB = 1048576;
// The time of this request (the page is drawn per request on the server).
const msNow = () => Date.now();
const fmt = (bytes: number) => (bytes >= 1024 * MB ? `${(bytes / 1024 / MB).toFixed(2)} ${m.gb}` : `${(bytes / MB).toFixed(1)} ${m.mb}`);
const level = (share: number) => (share >= 0.85 ? "critical" : share >= 0.7 ? "warning" : "good");
// The fixed status palette (never themed); each level also carries an icon and a word.
const LEVEL_COLOR = { good: "#0ca30c", warning: "#fab219", critical: "#d03b3b" } as const;
const LEVEL_ICON = { good: "check-circle", warning: "alert", critical: "alert" } as const;

// Days until the limit at the pace of the last 30 snapshots (least squares); null if not growing.
export function daysToLimit(points: { day: string; value: number }[], limit: number, current: number): number | null {
  const recent = points.slice(-30);
  if (recent.length < 3) return null;
  const xs = recent.map((p) => new Date(p.day).getTime() / 86_400_000);
  const ys = recent.map((p) => p.value);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0) / Math.max(xs.reduce((sum, x) => sum + (x - mx) ** 2, 0), 1e-9);
  if (slope <= 0) return null;
  const left = (limit - current) / slope;
  return left <= 0 ? 0 : Math.round(left);
}

function Gauge({ label, used, limit, history, testId }: { label: string; used: number | null; limit: number; history: { day: string; value: number }[]; testId: string }) {
  const share = used === null ? 0 : used / limit;
  const lv = level(share);
  const days = used === null ? null : daysToLimit(history, limit, used);
  const when = days === null ? null : new Date(msNow() + days * 86_400_000).toLocaleDateString(dateLocale(), { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="rounded-lg border border-border p-3" data-monitor-gauge={testId} data-monitor-level={lv}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted tabular-nums">{used === null ? "—" : `${fmt(used)} / ${fmt(limit)}`}</span>
      </div>
      <div className="relative mt-2 h-3 w-full overflow-hidden rounded-full bg-hover" role="img" aria-label={`${label}: ${Math.round(share * 100)}%`}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(share, 1) * 100}%`, background: LEVEL_COLOR[lv] }} />
        <span aria-hidden="true" className="absolute top-0 h-full w-px bg-border-strong" style={{ left: "70%" }} />
        <span aria-hidden="true" className="absolute top-0 h-full w-px bg-border-strong" style={{ left: "85%" }} />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs">
        <Icon name={LEVEL_ICON[lv]} size={14} />
        <span className="font-medium tabular-nums">{Math.round(share * 100)}%</span>
        <span className="text-muted">{m.levels[lv]}</span>
      </p>
      <p className="mt-1 text-xs text-muted" data-monitor-forecast>
        {history.length < 3 ? m.forecastSoon : days === null ? m.notGrowing : m.forecast(days, when!)}
      </p>
      <Sparkline points={history} limit={limit} label={label} />
    </div>
  );
}

// 90 days of one measure: a 2 px line with a dot per day (each names its date and value).
function Sparkline({ points, limit, label }: { points: { day: string; value: number }[]; limit: number; label: string }) {
  if (points.length < 2) return null;
  const W = 300;
  const H = 56;
  const max = Math.max(limit * 0.25, ...points.map((p) => p.value)) * 1.1;
  const x = (i: number) => (i / (points.length - 1)) * (W - 8) + 4;
  const y = (v: number) => H - 4 - (v / max) * (H - 8);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-14 w-full" preserveAspectRatio="none" role="img" aria-label={`${label}: ${m.trend}`} data-monitor-trend>
      <path d={path} fill="none" stroke="var(--rm-done)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <circle key={p.day} cx={x(i)} cy={y(p.value)} r={6} fill="transparent" className="cursor-default">
          <title>{`${new Date(p.day).toLocaleDateString(dateLocale())}: ${fmt(p.value)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function Monitoring({
  size,
  history,
  workspaces,
  limits,
}: {
  size: { database_bytes: number; storage_bytes: number } | null;
  history: DailyStat[];
  workspaces: WorkspaceLoad[];
  limits: { databaseMb: number; storageMb: number };
}) {
  const loaded = workspaces
    .map((w) => ({ ...w, share: w.storage_limit_mb > 0 ? w.files_bytes / (w.storage_limit_mb * MB) : 0 }))
    .sort((a, b) => b.share - a.share || b.members - a.members);
  const since = (iso: string | null) => {
    if (!iso) return m.never;
    const days = Math.floor((msNow() - new Date(iso).getTime()) / 86_400_000);
    return days <= 0 ? m.today : m.daysAgo(days);
  };
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4" data-monitoring>
      <h2 className="font-semibold">{m.title}</h2>
      <p className="mt-1 text-sm text-muted">{m.intro(limits.databaseMb, limits.storageMb)}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Gauge label={m.database} used={size?.database_bytes ?? null} limit={limits.databaseMb * MB} history={history.map((h) => ({ day: h.day, value: h.database_bytes }))} testId="database" />
        <Gauge label={m.storage} used={size?.storage_bytes ?? null} limit={limits.storageMb * MB} history={history.map((h) => ({ day: h.day, value: h.storage_bytes }))} testId="storage" />
      </div>

      <h3 className="mt-6 text-sm font-medium">{m.workspaces(loaded.length)}</h3>
      <p className="text-xs text-muted">{m.workspacesHint}</p>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border" data-monitor-workspaces>
        {loaded.map((w) => {
          const lv = level(w.share);
          return (
            <li key={w.id} className="grid gap-1 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center sm:gap-4" data-monitor-workspace={w.short_id}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{w.name ?? <span className="font-mono text-muted">{w.short_id}</span>}</p>
                <p className="text-xs text-muted">
                  {m.members(w.members)} · {m.lastActivity(since(w.last_activity))} · {w.data_location === "team" ? m.ownDatabase : w.data_location === "setup" ? m.settingUp : m.central}
                  {w.frozen && ` · ${m.frozen}`}
                </p>
              </div>
              <div>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-muted">{m.files}</span>
                  <span className="tabular-nums">
                    {fmt(w.files_bytes)} / {w.storage_limit_mb} {m.mb} · {Math.round(w.share * 100)}%
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-hover" role="img" aria-label={`${m.files}: ${Math.round(w.share * 100)}%, ${m.levels[lv]}`}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(w.share, 1) * 100}%`, background: LEVEL_COLOR[lv] }} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
