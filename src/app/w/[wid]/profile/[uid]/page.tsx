import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { workspacePath } from "@/lib/paths";
import { loadProfileStats } from "@/lib/profile-stats";
import { getWorkspace } from "@/lib/workspace";
import { loadMemberCard } from "@/lib/member-card";
import { ProfileView } from "../profile-view";
import { ProfileCard } from "../profile-card";
import { loadWishlistsOf } from "@/app/wishlist-actions";
import { WishlistCards } from "@/components/wishlists/wishlist-cards";
import { Hint } from "@/components/ui/hint";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.profile.othersTitle} · ${t.app.name}` };
}

// Someone's card (job title, units, birthday) for colleagues, and their statistics
// only if they showed them to this workspace. A guest or a stranger gets the missing page.
export default async function PersonProfilePage({ params }: PageProps<"/w/[wid]/profile/[uid]">) {
  const { wid, uid } = await params;
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const user = await getCurrentUser();
  if (uid === user.id) redirect(workspacePath(workspace.shortId, "/profile"));
  const [stats, card] = UUID.test(uid)
    ? await Promise.all([loadProfileStats(workspace.shortId, workspace.id, uid), loadMemberCard(workspace.shortId, workspace.id, uid)])
    : [null, null];
  const wishlists = card ? await loadWishlistsOf(workspace.shortId, workspace.id, uid) : [];

  if (!card) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{t.profile.hiddenTitle}</h1>
        <p className="mt-3 text-muted">{t.profile.hidden}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6 md:py-8">
      <ProfileCard
        card={card}
        person={uid}
        self={false}
        shortId={workspace.shortId}
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        roleLabel={t.workspace.roles[card.role]}
      />
      {wishlists.length > 0 && (
        <section aria-labelledby="their-wishlists" className="rounded-xl border border-border bg-surface p-4" data-their-wishlists>
          <h2 id="their-wishlists" className="mb-3 text-sm font-semibold">{t.wishlists.othersHeading}</h2>
          <WishlistCards items={wishlists} shortId={workspace.shortId} mine={false} today={new Date().toISOString().slice(0, 10)} />
        </section>
      )}
      {stats ? (
        <>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {t.profile.othersTitle}
            <Hint label={t.common.about} text={t.profile.othersIntro(workspace.name)} />
          </h2>
          <ProfileView stats={stats} />
        </>
      ) : (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted" data-stats-hidden>{t.profile.statsHidden}</p>
      )}
    </main>
  );
}
