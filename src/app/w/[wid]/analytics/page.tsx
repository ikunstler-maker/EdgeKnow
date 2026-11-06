import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";

const a = t.analytics;
const PERIODS = [7, 30, 90, 365] as const;

type PersonRow = {
  user_id: string;
  name: string | null;
  role: string | null;
  active: boolean;
  created: number;
  completed: number;
  passed: number;
  files: number;
  comments: number;
  comment_chars: number;
  pages_edited: number;
  open_now: number;
  overdue_now: number;
};
type Team = {
  former: { created: number; completed: number };
  created: number;
  completed: number;
  lead_days_median: number | null;
  lead_days_avg: number | null;
  on_time_share: number | null;
  overdue_now: number;
  open_now: number;
  stuck_now: number;
  reopened: number;
  weeks: { week: string; created: number; completed: number }[];
  pages_created: number;
  pages_updated: number;
  stale_pages: number;
  objects: Record<string, number>;
  survey_answers: number;
  active_people: number;
};
type Result = { ok: true; admin: boolean; people: PersonRow[]; team: Team | null } | { ok: false; error: string };

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${a.title} · ${t.app.name}` };
}

// Analytics for a period: everyone sees their own numbers; the workspace's owner and
// admins see everyone's and the team's (only counts and times, never contents).
export default async function AnalyticsPage({ params, searchParams }: PageProps<"/w/[wid]/analytics">) {
  const { wid } = await params;
  const asked = (await searchParams).days;
  const days = PERIODS.find((d) => String(d) === asked) ?? 30;
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  const db = await dataClient(wid);
  const { data } = await db.rpc("workspace_analytics", { ws: workspace.id, since: since.toISOString(), until: until.toISOString() });
  const result = (data ?? { ok: false, error: "unknown" }) as Result;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10" data-analytics>
      <h1 className="text-2xl font-semibold">📈 {a.title}</h1>
      <p className="mt-2 text-muted">{result.ok && result.admin ? a.introAdmin : a.introMine}</p>
      <nav className="mt-4 flex flex-wrap gap-1" aria-label={a.period}>
        {PERIODS.map((d) => (
          <Link
            key={d}
            href={workspacePath(wid, `/analytics?days=${d}`)}
            aria-current={d === days ? "page" : undefined}
            className={`min-h-11 rounded-full border px-4 py-2 text-sm md:min-h-9 md:py-1.5 ${d === days ? "border-accent bg-accent/10 font-medium" : "border-border text-muted hover:text-foreground"}`}
          >
            {a.days(d)}
          </Link>
        ))}
      </nav>

      {!result.ok ? (
        <p role="alert" className="mt-6 text-danger">{t.common.unknownError}</p>
      ) : (
        <>
          {result.team && <TeamBlock team={result.team} />}
          <section className="mt-8" aria-label={a.people}>
            <h2 className="text-lg font-semibold">{result.admin ? a.people : a.mine}</h2>
            <div className="mt-3 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[720px] text-sm" data-analytics-people>
                <thead className="bg-surface text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">{a.cols.person}</th>
                    {(["created", "completed", "passed", "files", "comments", "comment_chars", "pages_edited", "open_now", "overdue_now"] as const).map((key) => (
                      <th key={key} className="px-3 py-2 text-right font-medium" title={a.hints[key]}>
                        {a.cols[key]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.people.map((p) => (
                    <tr key={p.user_id} className="border-t border-border" data-analytics-person={p.name ?? ""}>
                      <td className="px-3 py-2">
                        {p.name ?? a.former}
                        {p.role === "guest" && <span className="ml-2 rounded-full bg-surface px-2 text-xs text-muted">{t.workspace.roles.guest}</span>}
                        {!p.active && <span className="ml-2 rounded-full bg-surface px-2 text-xs text-muted">{a.left}</span>}
                      </td>
                      {[p.created, p.completed, p.passed, p.files, p.comments, p.comment_chars, p.pages_edited, p.open_now, p.overdue_now].map((n, i) => (
                        <td key={i} className={`px-3 py-2 text-right tabular-nums ${i === 8 && n > 0 ? "text-danger" : ""}`}>
                          {n.toLocaleString()}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border p-3" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function TeamBlock({ team }: { team: Team }) {
  const top = Math.max(1, ...team.weeks.flatMap((w) => [w.created, w.completed]));
  return (
    <section className="mt-8" aria-label={a.team} data-analytics-team>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {a.team}
        <span className="rounded-full bg-accent/10 px-2 text-xs font-medium text-accent" title={a.teamPlanHint}>
          Team
        </span>
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={a.tiles.created} value={team.created} />
        <Tile label={a.tiles.completed} value={team.completed} />
        <Tile label={a.tiles.lead} value={team.lead_days_median ?? "—"} hint={a.tiles.leadHint(team.lead_days_avg)} />
        <Tile label={a.tiles.onTime} value={team.on_time_share === null ? "—" : `${team.on_time_share}%`} />
        <Tile label={a.tiles.overdue} value={team.overdue_now} />
        <Tile label={a.tiles.stuck} value={team.stuck_now} hint={a.tiles.stuckHint} />
        <Tile label={a.tiles.open} value={team.open_now} />
        <Tile label={a.tiles.reopened} value={team.reopened} hint={a.tiles.reopenedHint} />
        <Tile label={a.tiles.active} value={team.active_people} />
        <Tile label={a.tiles.pages} value={`${team.pages_created} / ${team.pages_updated}`} hint={a.tiles.pagesHint} />
        <Tile label={a.tiles.stale} value={team.stale_pages} hint={a.tiles.staleHint} />
        <Tile label={a.tiles.surveys} value={team.survey_answers} />
      </div>

      <h3 className="mt-6 text-sm font-medium text-muted">{a.weeks}</h3>
      <div className="mt-2 flex items-end gap-2 overflow-x-auto pb-2" data-analytics-weeks>
        {team.weeks.map((w) => (
          <div key={w.week} className="flex shrink-0 flex-col items-center gap-1" title={a.weekHint(w.created, w.completed)}>
            <div className="flex h-28 items-end gap-0.5">
              <span className="w-3 rounded-t bg-sky-500" style={{ height: `${(w.created / top) * 100}%` }} />
              <span className="w-3 rounded-t bg-emerald-500" style={{ height: `${(w.completed / top) * 100}%` }} />
            </div>
            <span className="text-[10px] text-muted">{w.week.slice(5)}</span>
          </div>
        ))}
      </div>
      <p className="mt-1 flex gap-4 text-xs text-muted">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500" />{a.tiles.created}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />{a.tiles.completed}</span>
      </p>
      {Object.keys(team.objects).length > 0 && (
        <p className="mt-4 text-sm text-muted">
          {a.objects}: {Object.entries(team.objects).map(([service, n]) => `${t.services.items[service as keyof typeof t.services.items]?.name ?? service} — ${n}`).join(", ")}
        </p>
      )}
      {(team.former.created > 0 || team.former.completed > 0) && <p className="mt-2 text-xs text-muted">{a.formerNote(team.former.created, team.former.completed)}</p>}
    </section>
  );
}
