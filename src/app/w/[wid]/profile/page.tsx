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
import { MyDevices } from "./my-devices";
import { AppearanceSettings } from "@/components/angler/appearance-settings";
import { Icon } from "@/components/ui/icon";
import { buttonClass } from "@/components/ui/button";

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
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6 md:py-8">
      {/* Who this is: the person, their role and the workspace. */}
      <header className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface p-5" data-profile-header>
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent/15 text-lg font-semibold text-accent" aria-hidden="true">
          {(stats.name || user.email).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{stats.name || user.email}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent">{t.workspace.roles[workspace.role]}</span>
            <span className="truncate">{workspace.name}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link href={workspacePath(workspace.shortId, "/analytics")} className={buttonClass("subtle")} data-analytics-link>
            <Icon name="chart" />
            {t.analytics.link}
          </Link>
          <Link href="/changelog" className={buttonClass("ghost")} data-changelog-link>
            <Icon name="sparkle" />
            {t.changelog.footerLink}
          </Link>
        </div>
      </header>
      <p className="sr-only">{t.profile.intro(stats.name, workspace.name)}</p>
      <VisibilitySwitch workspaceId={workspace.id} initial={stats.visibility} shareUrl={shareUrl} />
      <ProfileView stats={stats} />
      <AppearanceSettings />
      <MyDevices />
      <MyData email={user.email} />
    </main>
  );
}
