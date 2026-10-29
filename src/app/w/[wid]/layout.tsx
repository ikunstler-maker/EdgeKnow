import Link from "next/link";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { PAGE_TREE_COLUMNS, toPageNode, type PageRow } from "@/lib/pages";
import { workspaceData } from "@/lib/team-db/data";
import { checkWorkspaceHealth } from "@/lib/team-db/health";
import { getWorkspace, listMyWorkspaces } from "@/lib/workspace";
import { AppShell } from "@/components/app-shell";
import { PagesProvider } from "@/components/pages/pages-provider";
import { TeamHealthBanner } from "@/components/team-health-banner";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[wid]">) {
  const { wid } = await params;
  const [user, workspace, workspaces] = await Promise.all([
    getCurrentUser(),
    getWorkspace(wid),
    listMyWorkspaces(),
  ]);

  // Not a member (or no such workspace): the same answer either way, nothing leaks.
  if (!workspace) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">{t.workspace.noAccessTitle}</h1>
        <p className="mt-3 text-muted">{t.workspace.noAccess}</p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-border px-4 hover:bg-surface"
        >
          {t.workspace.toMyWorkspaces}
        </Link>
      </main>
    );
  }

  const data = await workspaceData(wid);
  const supabase = data!.client;
  // RLS returns only this workspace's pages that the user has a role on.
  const { data: pages, error } = await supabase
    .from("pages")
    .select(PAGE_TREE_COLUMNS)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("position")
    .overrideTypes<PageRow[], { merge: false }>();

  // The team's own database (path C): if it couldn't be read, or wasn't well at
  // the last check, look again now (this also wakes a sleeping one up).
  let health = data!.health ?? null;
  if (data!.location === "team" && (error || (health && health !== "ok" && health !== "almost_full"))) {
    health = (await checkWorkspaceHealth(workspace.id))?.health ?? health;
    // The project itself answers, but not to people's sign-ins: EdgeKnow's sign-in was removed there.
    if (error && (!health || health === "ok" || health === "almost_full")) health = error.code?.startsWith("PGRST3") ? "revoked" : "unreachable";
  }
  const showHealth =
    health && health !== "ok" && (health !== "almost_full" || workspace.role === "owner" || workspace.role === "admin") ? health : null;

  return (
    <PagesProvider workspace={workspace} pages={(pages ?? []).map(toPageNode)}>
      <AppShell user={user} workspaces={workspaces}>
        {/* Moving into the team's own database (path C): changes wait until it is done. */}
        {(data!.location === "setup" || data!.location === "returning") && (
          <p role="status" className="border-b border-border bg-surface px-4 py-2 text-center text-sm">
            {data!.location === "setup" ? t.workspace.movingBanner : t.workspace.returningBanner}
          </p>
        )}
        {showHealth && (
          <TeamHealthBanner health={showHealth} isOwner={workspace.role === "owner"} settingsHref={`/w/${wid}/settings?tab=team`} />
        )}
        {children}
      </AppShell>
    </PagesProvider>
  );
}
