import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { workspacePath } from "@/lib/paths";
import { loadProfileStats } from "@/lib/profile-stats";
import { getWorkspace } from "@/lib/workspace";
import { ProfileView } from "../profile-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.profile.othersTitle} · ${t.app.name}` };
}

// Someone's statistics, only if they showed them to this workspace; otherwise it
// looks the same as a missing profile.
export default async function PersonProfilePage({ params }: PageProps<"/w/[wid]/profile/[uid]">) {
  const { wid, uid } = await params;
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const user = await getCurrentUser();
  if (uid === user.id) redirect(workspacePath(workspace.shortId, "/profile"));
  const stats = UUID.test(uid) ? await loadProfileStats(workspace.id, uid) : null;

  if (!stats) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">{t.profile.hiddenTitle}</h1>
        <p className="mt-3 text-muted">{t.profile.hidden}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold">👤 {stats.name}</h1>
      <p className="mt-2 text-muted">{t.profile.othersIntro(workspace.name)}</p>
      <ProfileView stats={stats} />
    </main>
  );
}
