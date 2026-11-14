import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { Icon } from "@/components/ui/icon";
import { RoadmapView } from "./roadmap-view";
import { createClient } from "@/lib/supabase/server";
import { Monitoring, type DailyStat, type WorkspaceLoad } from "./monitoring";

// The plan's limits of the main project (free plan by default; set when the plan changes).
const limitMb = (value: string | undefined, fallback: number) => (Number(value) > 0 ? Number(value) : fallback);

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.platform.roadmap.title} · ${t.app.name}` };
}

// ADMIN-1: the ecosystem's road map, for the platform admin only (no team's data is read).
export default async function RoadmapPage() {
  const user = await getCurrentUser();
  const r = t.platform.roadmap;
  if (!user.isPlatformAdmin) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Link href="/" className="text-sm text-muted hover:underline">
          <Icon name="arrow-left" className="mr-1 inline" />
          {t.workspace.toMyWorkspaces}
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">{t.platform.title}</h1>
        <p className="mt-3 text-muted" data-roadmap-forbidden>
          {t.platform.forbidden}
        </p>
      </main>
    );
  }
  const supabase = await createClient();
  const [{ data: size }, { data: history }, { data: load }] = await Promise.all([
    supabase.rpc("platform_database_size"),
    supabase.rpc("platform_stats_history"),
    supabase.rpc("platform_workspace_load"),
  ]);
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10" data-roadmap>
      <Link href="/admin" className="text-sm text-muted hover:underline">
        <Icon name="arrow-left" className="mr-1 inline" />
        {r.back}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">{r.title}</h1>
      <p className="mt-2 text-muted">{r.intro}</p>
      <Monitoring
        size={size as { database_bytes: number; storage_bytes: number } | null}
        history={(history ?? []) as DailyStat[]}
        workspaces={(load ?? []) as WorkspaceLoad[]}
        limits={{ databaseMb: limitMb(process.env.PLATFORM_DATABASE_LIMIT_MB, 500), storageMb: limitMb(process.env.PLATFORM_STORAGE_LIMIT_MB, 1024) }}
      />
      <RoadmapView />
    </main>
  );
}
