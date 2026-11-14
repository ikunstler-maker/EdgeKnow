import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { Icon } from "@/components/ui/icon";
import { RoadmapView } from "./roadmap-view";

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
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10" data-roadmap>
      <Link href="/admin" className="text-sm text-muted hover:underline">
        <Icon name="arrow-left" className="mr-1 inline" />
        {r.back}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">{r.title}</h1>
      <p className="mt-2 text-muted">{r.intro}</p>
      <RoadmapView />
    </main>
  );
}
