import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { loadProject } from "@/lib/tasks-server";
import { SERVICE_BRANDS } from "@/lib/services";
import { getCurrentUser } from "@/lib/auth";
import { TaskView } from "@/components/tasks/task-view";
import { Icon } from "@/components/ui/icon";

export async function generateMetadata({ params }: PageProps<"/w/[wid]/tasks/[key]/[number]">): Promise<Metadata> {
  const { key, number } = await params;
  return { title: `${key.toUpperCase()}-${number} · ${SERVICE_BRANDS.tasks.name}` };
}

// A task on its own page (the address people share); the board opens the same card in a panel.
export default async function TaskPage({ params }: PageProps<"/w/[wid]/tasks/[key]/[number]">) {
  const { wid, key, number } = await params;
  const [view, user] = await Promise.all([loadProject(wid, key), getCurrentUser()]);
  if (!view) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
        <p className="text-muted">{t.tasks.notFound}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <Link href={workspacePath(view.workspace.shortId, `/tasks/${view.project.key}`)} className="text-sm text-muted hover:text-foreground hover:underline">
        <Icon name="arrow-left" className="mr-1 inline" />
        {t.tasks.backToProject(view.project.name)}
      </Link>
      <TaskView wid={wid} view={view} number={number} userId={user.id} />
    </main>
  );
}
