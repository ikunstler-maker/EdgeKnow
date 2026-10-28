import type { Metadata } from "next";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { listMyWorkspaces } from "@/lib/workspace";
import { NewWorkspaceForm } from "./new-workspace-form";

// Read per request, so the title follows the interface language.
export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.newWorkspace.title} · ${t.app.name}` };
}

export default async function NewWorkspacePage() {
  await getCurrentUser();
  const workspaces = await listMyWorkspaces();
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">{t.newWorkspace.title}</h1>
        <p className="mt-2 text-muted">{t.newWorkspace.intro}</p>
        <NewWorkspaceForm canGoBack={workspaces.length > 0} />
      </div>
    </main>
  );
}
