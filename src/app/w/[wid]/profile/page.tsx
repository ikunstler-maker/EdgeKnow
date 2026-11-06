import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { workspacePath } from "@/lib/paths";
import { loadProfileStats } from "@/lib/profile-stats";
import { getWorkspace } from "@/lib/workspace";
import { ProfileView } from "./profile-view";
import { VisibilitySwitch } from "./visibility-switch";
import { MyData } from "./my-data";
import { AppearanceSettings } from "@/components/angler/appearance-settings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.profile.title} · ${t.app.name}` };
}

// The person's own statistics in this workspace, and who else may see them.
export default async function MyProfilePage({ params }: PageProps<"/w/[wid]/profile">) {
  const workspace = await getWorkspace((await params).wid);
  if (!workspace) return null;
  const user = await getCurrentUser();
  const stats = await loadProfileStats(workspace.shortId, workspace.id, user.id);
  if (!stats) return null;
  const host = (await headers()).get("host") ?? "";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const shareUrl = `${protocol}://${host}${workspacePath(workspace.shortId, `/profile/${user.id}`)}`;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold">👤 {t.profile.title}</h1>
      <p className="mt-2 text-muted">{t.profile.intro(stats.name, workspace.name)}</p>
      <Link href={workspacePath(workspace.shortId, "/analytics")} className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm hover:bg-surface md:min-h-9" data-analytics-link>
        {t.analytics.link}
      </Link>
      <VisibilitySwitch workspaceId={workspace.id} initial={stats.visibility} shareUrl={shareUrl} />
      <ProfileView stats={stats} />
      <AppearanceSettings />
      <MyData email={user.email} />
    </main>
  );
}
