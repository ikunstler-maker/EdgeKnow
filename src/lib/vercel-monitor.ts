import "server-only";

// ADMIN-3: the hosting's numbers for the platform admin, read with a Vercel key kept in the
// environment (VERCEL_MONITOR_TOKEN — secret, server only) for the team VERCEL_MONITOR_TEAM_ID
// and this project (VERCEL_PROJECT_ID, set by the hosting itself). The free plan's API gives
// deployments only; traffic and function time need the paid plan (checked 2026-11-14).

export type HostingStats =
  | { state: "not_set" }
  | { state: "error" }
  | {
      state: "ok";
      last24h: number;
      days: { day: string; total: number; failed: number }[];
      failedShare: number;
      averageBuildSeconds: number | null;
      lastProduction: { state: string; at: number } | null;
    };

type Deployment = { state?: string; readyState?: string; target?: string | null; created: number; buildingAt?: number; ready?: number; projectId?: string };

const DAY = 86_400_000;

export async function hostingStats(now: number): Promise<HostingStats> {
  const token = process.env.VERCEL_MONITOR_TOKEN;
  const team = process.env.VERCEL_MONITOR_TEAM_ID;
  if (!token || !team) return { state: "not_set" };
  const project = process.env.VERCEL_MONITOR_PROJECT_ID || process.env.VERCEL_PROJECT_ID || "";
  const since = now - 7 * DAY;
  const list: Deployment[] = [];
  try {
    // The daily limit counts every deployment of the team, so all projects are read.
    let until: number | null = null;
    for (let page = 0; page < 10; page++) {
      const url = new URL("https://api.vercel.com/v6/deployments");
      url.searchParams.set("teamId", team);
      url.searchParams.set("since", String(since));
      url.searchParams.set("limit", "100");
      if (until) url.searchParams.set("until", String(until));
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok) return { state: "error" };
      const body = (await response.json()) as { deployments?: Deployment[]; pagination?: { next?: number | null } };
      list.push(...(body.deployments ?? []));
      until = body.pagination?.next ?? null;
      if (!until) break;
    }
  } catch {
    return { state: "error" };
  }
  const stateOf = (d: Deployment) => d.readyState ?? d.state ?? "";
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(now - (6 - i) * DAY);
    start.setUTCHours(0, 0, 0, 0);
    const from = start.getTime();
    const inDay = list.filter((d) => d.created >= from && d.created < from + DAY);
    return { day: start.toISOString().slice(0, 10), total: inDay.length, failed: inDay.filter((d) => stateOf(d) === "ERROR").length };
  });
  const finished = list.filter((d) => stateOf(d) === "READY" || stateOf(d) === "ERROR");
  const builds = list.filter((d) => stateOf(d) === "READY" && d.ready && d.buildingAt).map((d) => (d.ready! - d.buildingAt!) / 1000);
  const production = list.filter((d) => d.target === "production" && (!project || d.projectId === project || d.projectId === undefined)).sort((a, b) => b.created - a.created)[0];
  return {
    state: "ok",
    last24h: list.filter((d) => d.created >= now - DAY).length,
    days,
    failedShare: finished.length ? finished.filter((d) => stateOf(d) === "ERROR").length / finished.length : 0,
    averageBuildSeconds: builds.length ? Math.round(builds.reduce((a, b) => a + b, 0) / builds.length) : null,
    lastProduction: production ? { state: stateOf(production), at: production.created } : null,
  };
}
