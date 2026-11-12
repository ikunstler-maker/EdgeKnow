import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { workspacePath } from "@/lib/paths";
import { loadProfileStats } from "@/lib/profile-stats";
import { getWorkspace } from "@/lib/workspace";
import { loadMemberCard } from "@/lib/member-card";
import { ProfileView } from "./profile-view";
import { ProfileCard } from "./profile-card";
import { VisibilitySwitch } from "./visibility-switch";
import { BirthdayForm } from "./birthday-form";
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
  const [stats, card] = await Promise.all([
    loadProfileStats(workspace.shortId, workspace.id, user.id),
    loadMemberCard(workspace.shortId, workspace.id, user.id),
  ]);
  if (!stats || !card) return null;
  const host = (await headers()).get("host") ?? "";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const shareUrl = `${protocol}://${host}${workspacePath(workspace.shortId, `/profile/${user.id}`)}`;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6 md:py-8">
      <ProfileCard
        card={card}
        person={user.id}
        self
        shortId={workspace.shortId}
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        roleLabel={t.workspace.roles[workspace.role]}
        actions={
          <>
            <Link href={workspacePath(workspace.shortId, "/analytics")} className={buttonClass("subtle")} data-analytics-link>
              <Icon name="chart" />
              {t.analytics.link}
            </Link>
            <Link href="/changelog" className={buttonClass("ghost")} data-changelog-link>
              <Icon name="sparkle" />
              {t.changelog.footerLink}
            </Link>
          </>
        }
      />
      <p className="sr-only">{t.profile.intro(stats.name, workspace.name)}</p>
      <VisibilitySwitch workspaceId={workspace.id} initial={stats.visibility} shareUrl={shareUrl} />
      {workspace.role !== "guest" && <BirthdayForm shortId={workspace.shortId} workspaceId={workspace.id} />}
      <ProfileView stats={stats} />
      <AppearanceSettings />
      <MyDevices />
      <MyData email={user.email} />
    </main>
  );
}
