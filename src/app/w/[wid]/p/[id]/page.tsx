import type { Metadata } from "next";
import { cookies } from "next/headers";
import { after } from "next/server";
import { refreshIfStale } from "@/lib/external-source";
import { createAdminClient } from "@/lib/supabase/admin";
import { EXTERNAL_LANG_COOKIE } from "@/lib/external-lang";
import { ExternalSourceBar, type ExternalSourceInfo } from "@/components/pages/external-source-bar";
import { currentLocale, t } from "@/i18n";
import { dataClient } from "@/lib/team-db/data";
import { getCurrentUser } from "@/lib/auth";
import { THREAD_COLUMNS, toThread, type PeopleNames, type ThreadRow } from "@/lib/comments";
import { canEdit, type PageRole } from "@/lib/pages";
import { getWorkspace, isWorkspaceAdmin } from "@/lib/workspace";
import { PageBody } from "@/components/editor/page-body";
import { PageCover } from "@/components/pages/page-cover";
import { PageHeader } from "@/components/pages/page-header";
import { ShareButton } from "@/components/pages/share-dialog";
import { PageMeta } from "@/components/pages/page-meta";
import { TrashedBanner } from "@/components/pages/trashed-banner";
import { ClearNewFlag } from "@/components/pages/clear-new-flag";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type PageRecord = {
  id: string;
  workspace_id: string;
  title: string;
  icon: string | null;
  content: unknown;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  trashed_with: string | null;
  my_role: PageRole;
  cover: unknown;
  author: { name: string | null; email: string } | null;
};

async function loadPage(wid: string, id: string): Promise<PageRecord | null> {
  if (!UUID.test(id)) return null;
  const supabase = await dataClient(wid);
  // RLS returns nothing for pages the user has no role on (in this workspace or
  // any other), so a foreign link looks exactly like a missing page.
  const { data } = await supabase
    .from("pages")
    .select(
      "id, workspace_id, title, icon, content, version, created_at, updated_at, deleted_at, trashed_with, my_role, cover, author:profiles!pages_created_by_fkey(name, email)",
    )
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<PageRecord, { merge: false }>();
  return data;
}

// Threads of the page and display names of everyone who wrote or was mentioned.
async function loadComments(wid: string, pageId: string) {
  const supabase = await dataClient(wid);
  const { data } = await supabase
    .from("comment_threads")
    .select(THREAD_COLUMNS)
    .eq("page_id", pageId)
    .order("created_at")
    .overrideTypes<ThreadRow[], { merge: false }>();
  const threads = (data ?? []).map(toThread);
  const ids = [
    ...new Set(threads.flatMap((th) => th.comments.flatMap((cm) => [cm.authorId, ...cm.mentions]))),
  ].filter((id): id is string => Boolean(id));
  const people: PeopleNames = {};
  if (ids.length) {
    // People who left every shared workspace aren't visible and show as "former member".
    const { data: profiles } = await supabase.from("profiles").select("id, name, email").in("id", ids);
    for (const pr of (profiles ?? []) as { id: string; name: string | null; email: string }[]) {
      people[pr.id] = pr.name || pr.email;
    }
  }
  return { threads, people };
}

// The page's external source, if any (decision 2026-12-31). Read with the secret
// key because the table is server-only; the key itself is never selected.
async function loadSource(workspaceId: string, pageId: string) {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data } = await admin
    .from("external_sources")
    .select("id, url, languages, translations, synced_at, last_error")
    .eq("workspace_id", workspaceId)
    .eq("page_id", pageId)
    .maybeSingle();
  if (!data) return null;
  const languages = (data.languages ?? []) as string[];
  const translations = (data.translations ?? {}) as Record<string, unknown>;
  // Shown language: the reader's own choice, else the interface language, else the main one.
  const available = languages.filter((l, i) => i === 0 || l in translations);
  const chosen = (await cookies()).get(EXTERNAL_LANG_COOKIE)?.value;
  const lang = [chosen, currentLocale()].find((l) => l && available.includes(l)) ?? languages[0] ?? null;
  const info: ExternalSourceInfo = {
    host: new URL(data.url.replaceAll("{lang}", "xx")).host,
    syncedAt: data.synced_at,
    lastError: data.last_error,
    languages: available,
    lang,
  };
  // The main language is the page itself; another one replaces only what is shown.
  const content = lang && lang !== languages[0] ? translations[lang] : undefined;
  return { id: data.id as string, info, content };
}

export async function generateMetadata({ params }: PageProps<"/w/[wid]/p/[id]">): Promise<Metadata> {
  const { wid, id } = await params;
  const page = await loadPage(wid, id);
  return { title: page ? `${page.title || t.pages.untitled} · ${t.app.name}` : t.app.name };
}

// A page this browser has just made (?new=1) opens at once, empty, even if the
// database has not finished making it: its saves wait in the browser until it has.
async function loadNewPage(wid: string, id: string, isNew: boolean, workspaceId: Promise<string | null>): Promise<PageRecord | null> {
  const page = await loadPage(wid, id);
  if (page || !isNew || !UUID.test(id)) return page;
  const ws = await workspaceId;
  if (!ws) return null;
  const now = new Date().toISOString();
  return { id, workspace_id: ws, title: "", icon: null, content: null, version: 1, created_at: now, updated_at: now, deleted_at: null, trashed_with: null, my_role: "owner", cover: null, author: null };
}

export default async function WikiPage({ params, searchParams }: PageProps<"/w/[wid]/p/[id]">) {
  const { wid, id } = await params;
  const isNew = (await searchParams).new === "1";
  const workspaceLoad = getWorkspace(wid);
  const [workspace, page, user, comments] = await Promise.all([
    workspaceLoad,
    loadNewPage(wid, id, isNew, workspaceLoad.then((w) => w?.id ?? null)),
    getCurrentUser(),
    loadComments(wid, id),
  ]);
  if (!workspace) return null;

  if (!page || page.workspace_id !== workspace.id) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">{t.pages.notFoundTitle}</h1>
        <p className="mt-3 text-muted">{t.pages.notFound}</p>
      </main>
    );
  }

  const source = await loadSource(workspace.id, page.id);
  // Opening the page refreshes its source at most once an hour, after the response.
  if (source && !page.deleted_at) after(() => refreshIfStale(createAdminClient()!, source.id));

  // Owners and editors edit; commenters and viewers only read, and so does everyone
  // in the trash. A page fed by an external source is never edited by hand.
  const editableMeta = canEdit(page.my_role) && !page.deleted_at;
  const editable = editableMeta && !source;
  const canComment = page.my_role !== "viewer" && !page.deleted_at;

  return (
    <div className="flex flex-1 flex-col">
    <PageCover key={`cover-${page.id}`} pageId={page.id} initialCover={page.cover} editable={editableMeta} />
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-6 md:px-12 md:pt-12 xl:max-w-6xl">
      {isNew && <ClearNewFlag />}
      {page.deleted_at && <TrashedBanner trashRootId={page.trashed_with ?? page.id} canRestore={page.my_role === "owner"} />}
      {!page.deleted_at && (
        <div className="mb-2 flex flex-wrap justify-end gap-2">
          <ExternalSourceBar shortId={wid} pageId={page.id} source={source?.info ?? null} isAdmin={isWorkspaceAdmin(workspace)} />
          <ShareButton pageId={page.id} />
        </div>
      )}
      <PageHeader
        key={page.id}
        id={page.id}
        initialTitle={page.title}
        initialIcon={page.icon}
        readOnly={!editableMeta}
      />
      <PageMeta
        author={page.author?.name || page.author?.email || null}
        createdAt={page.created_at}
        updatedAt={page.updated_at}
      />
      <div className="mt-6">
        <PageBody
          key={`${page.id}-${source?.info.lang ?? ""}`}
          pageId={page.id}
          initialContent={source?.content ?? page.content}
          initialVersion={page.version}
          editable={editable}
          canComment={canComment}
          userId={user.id}
          threads={comments.threads}
          people={comments.people}
        />
      </div>
    </main>
    </div>
  );
}
