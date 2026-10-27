import type { Metadata } from "next";
import { t } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/pages/page-header";
import { PageMeta } from "@/components/pages/page-meta";
import { TrashedBanner } from "@/components/pages/trashed-banner";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type PageRecord = {
  id: string;
  workspace_id: string;
  title: string;
  icon: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  trashed_with: string | null;
  author: { name: string | null; email: string } | null;
};

async function loadPage(id: string): Promise<PageRecord | null> {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  // RLS returns nothing for pages the user has no role on (in this workspace or
  // any other), so a foreign link looks exactly like a missing page.
  const { data } = await supabase
    .from("pages")
    .select(
      "id, workspace_id, title, icon, created_at, updated_at, deleted_at, trashed_with, author:profiles!pages_created_by_fkey(name, email)",
    )
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<PageRecord, { merge: false }>();
  return data;
}

export async function generateMetadata({ params }: PageProps<"/w/[wid]/p/[id]">): Promise<Metadata> {
  const page = await loadPage((await params).id);
  return { title: page ? `${page.title || t.pages.untitled} · ${t.app.name}` : t.app.name };
}

export default async function WikiPage({ params }: PageProps<"/w/[wid]/p/[id]">) {
  const { wid, id } = await params;
  const [workspace, page] = await Promise.all([getWorkspace(wid), loadPage(id)]);
  if (!workspace) return null;

  if (!page || page.workspace_id !== workspace.id) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">{t.pages.notFoundTitle}</h1>
        <p className="mt-3 text-muted">{t.pages.notFound}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-6 md:px-12 md:pt-12">
      {page.deleted_at && <TrashedBanner trashRootId={page.trashed_with ?? page.id} />}
      <PageHeader
        key={page.id}
        id={page.id}
        initialTitle={page.title}
        initialIcon={page.icon}
        readOnly={Boolean(page.deleted_at)}
      />
      <PageMeta
        author={page.author?.name || page.author?.email || null}
        createdAt={page.created_at}
        updatedAt={page.updated_at}
      />
      <p className="mt-8 text-muted">{t.pages.bodyPlaceholder}</p>
    </main>
  );
}
