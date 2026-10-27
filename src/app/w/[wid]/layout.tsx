import Link from "next/link";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { toPageNode, type PageRow } from "@/lib/pages";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace, listMyWorkspaces } from "@/lib/workspace";
import { AppShell } from "@/components/app-shell";
import { PagesProvider } from "@/components/pages/pages-provider";

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

  const supabase = await createClient();
  // RLS returns only this workspace's pages that the user has a role on.
  const { data } = await supabase
    .from("pages")
    .select("id, parent_id, title, icon, position")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("position")
    .overrideTypes<PageRow[], { merge: false }>();

  return (
    <PagesProvider workspace={workspace} pages={(data ?? []).map(toPageNode)}>
      <AppShell user={user} workspaces={workspaces}>
        {children}
      </AppShell>
    </PagesProvider>
  );
}
