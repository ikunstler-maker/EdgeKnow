import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { SERVICE_BRANDS } from "@/lib/services";
import { getWorkspace, isWorkspaceAdmin } from "@/lib/workspace";
import { trackerState } from "@/app/task-import-actions";
import { ImportWizard } from "@/components/tasks/import-wizard";
import { Icon } from "@/components/ui/icon";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.tasks.importer.title} · ${SERVICE_BRANDS.tasks.name}` };
}

// Moving tasks in from another tracker: the workspace's owner and admins only.
export default async function ImportPage({ params }: PageProps<"/w/[wid]/tasks/import">) {
  const { wid } = await params;
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  if (!isWorkspaceAdmin(workspace)) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
        <p className="text-muted">{t.tasks.importer.errors.forbidden}</p>
      </main>
    );
  }
  // The tracker's key is encrypted with the same server key as the Drive accesses.
  const configured = (process.env.DRIVE_TOKEN_KEY ?? "").length >= 24 && Boolean(process.env.SUPABASE_SECRET_KEY);
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 md:py-8">
      <Link href={workspacePath(workspace.shortId, "/tasks")} className="text-sm text-muted hover:text-foreground hover:underline">
        <Icon name="arrow-left" className="mr-1 inline" />
        {t.tasks.title}
      </Link>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">{t.tasks.importer.title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t.tasks.importer.intro}</p>
      <ImportWizard shortId={workspace.shortId} initial={configured ? await trackerState(workspace.shortId) : null} configured={configured} />
    </main>
  );
}
