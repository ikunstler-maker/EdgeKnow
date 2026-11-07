import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace, isWorkspaceAdmin } from "@/lib/workspace";
import type { ProjectSummary } from "@/lib/tasks";
import { NewProjectForm } from "@/components/tasks/new-project-form";

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
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <p className="text-sm text-muted">{workspace.name}</p>
      <h1 className="text-3xl font-semibold">✅ {t.tasks.title}</h1>
      <p className="mt-2 text-muted">{t.tasks.intro}</p>
      {projects.length === 0 ? (
        <p className="mt-6 text-muted">{admin ? t.tasks.noProjects : t.tasks.noProjectsMember}</p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-lg border border-border" aria-label={t.tasks.title}>
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={workspacePath(workspace.shortId, `/tasks/${p.key}`)} className="flex min-h-12 items-center gap-3 px-4 hover:bg-surface">
                <span className="text-xl">{p.icon ?? "📋"}</span>
                <span className="flex-1 font-medium">{p.name}</span>
                <span className="font-mono text-sm text-muted">{p.key}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {admin && <NewProjectForm workspaceId={workspace.id} shortId={workspace.shortId} />}
    </main>
  );
}
