import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { loadProject } from "@/lib/tasks-server";
import { FieldsEditor } from "@/components/tasks/fields-editor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.tasks.customFields.title} · ${t.app.name}` };
}

// The project's own fields and which task types have them (the types' templates).
export default async function ProjectFieldsPage({ params }: PageProps<"/w/[wid]/tasks/[key]/fields">) {
  const { wid, key } = await params;
  const view = await loadProject(wid, key);
  if (!view || view.role !== "owner") {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
        <p className="text-muted">{t.tasks.projectNotFound}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Link href={workspacePath(view.workspace.shortId, `/tasks/${view.project.key}`)} className="text-sm text-muted hover:text-foreground hover:underline">
        {t.tasks.backToProject(view.project.name)}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">🧩 {t.tasks.customFields.title}</h1>
      <p className="mt-2 text-sm text-muted">{t.tasks.customFields.intro}</p>
      <FieldsEditor projectId={view.project.id} fields={view.fields} />
    </main>
  );
}
