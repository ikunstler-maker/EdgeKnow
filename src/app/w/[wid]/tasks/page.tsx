import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace, isWorkspaceAdmin } from "@/lib/workspace";
import type { ProjectSummary } from "@/lib/tasks";
import { NewProjectButton } from "@/components/tasks/new-project-button";
import { ServiceIcon } from "@/components/services/service-icon";
import { Icon } from "@/components/ui/icon";
import { Hint } from "@/components/ui/hint";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.tasks.title} · ${t.app.name}` };
}

// All task projects open to the person; the workspace's owner and admins make new ones.
export default async function TasksHome({ params }: PageProps<"/w/[wid]/tasks">) {
  const { wid } = await params;
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const db = await dataClient(wid);
  const { data } = await db
    .from("task_projects")
    .select("id, key, name, icon")
    .eq("workspace_id", workspace.id)
    .is("archived_at", null)
    .order("name")
    .overrideTypes<ProjectSummary[], { merge: false }>();
  const projects = data ?? [];
  // Admins, or a member whose role allows making projects (company structure, stage 2).
  const admin = isWorkspaceAdmin(workspace) || (await db.rpc("role_allows", { ws: workspace.id, perm: "create_projects" })).data === true;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 md:py-8">
      <header className="flex items-center gap-3">
        <ServiceIcon serviceId="tasks" size={32} />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-1 text-xl font-semibold tracking-tight">
            {t.tasks.title}
            <Hint label={t.tasks.title} text={t.tasks.intro} />
          </h1>
          <p className="truncate text-xs text-muted">{workspace.name}</p>
        </div>
        {admin && <NewProjectButton workspaceId={workspace.id} shortId={workspace.shortId} />}
      </header>
      {projects.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{admin ? t.tasks.noProjects : t.tasks.noProjectsMember}</p>
      ) : (
        <ul className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" aria-label={t.tasks.title}>
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={workspacePath(workspace.shortId, `/tasks/${p.key}`)} className="flex min-h-12 items-center gap-3 px-4 hover:bg-hover">
                {p.icon ? <span className="w-5 text-center text-lg">{p.icon}</span> : <Icon name="folder" size={20} className="text-muted" />}
                <span className="flex-1 text-sm font-medium">{p.name}</span>
                <span className="font-mono text-xs text-muted">{p.key}</span>
                <Icon name="chevron-right" size={14} className="text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
