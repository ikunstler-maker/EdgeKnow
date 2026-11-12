import Link from "next/link";
import { dateLocale, t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { pagePath, workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace, isWorkspaceAdmin } from "@/lib/workspace";
import { ServiceTiles } from "@/components/services/service-tiles";
import { BirthdaysBlock } from "@/components/home/birthdays-block";
import { Onboarding, type OnboardingStep } from "@/components/onboarding";
import { createClient } from "@/lib/supabase/server";
import { workspaceData } from "@/lib/team-db/data";
import { Icon } from "@/components/ui/icon";
import { iconButtonClass } from "@/components/ui/button";

type MentionRow = {
  id: string;
  body: string;
  created_at: string;
  author: { name: string | null; email: string } | null;
  thread: { id: string; page: { id: string; title: string; icon: string | null } };
};

type PageMentionRow = {
  page_id: string;
  created_at: string;
  author: { name: string | null; email: string } | null;
  page: { id: string; title: string; icon: string | null };
};

// One list for both kinds: in a comment, or with a person chip in the text.
type Mention = {
  key: string;
  href: string;
  at: string;
  who: string;
  page: string;
  text: string;
};

const dateFormat = () => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "short", timeStyle: "short" });

export default async function WorkspaceHome({ params }: PageProps<"/w/[wid]">) {
  const { wid } = await params;
  const [user, workspace] = await Promise.all([getCurrentUser(), getWorkspace(wid)]);
  if (!workspace) return null;

  // Comments that mention me on pages I can still see (RLS filters the rest).
  const supabase = await dataClient(wid);
  const { data: mentions } = await supabase
    .from("comments")
    .select(
      "id, body, created_at, author:profiles!comments_author_id_fkey(name, email), thread:comment_threads!inner(id, page:pages!inner(id, title, icon))",
    )
    .eq("workspace_id", workspace.id)
    .contains("mentions", [user.id])
    .order("created_at", { ascending: false })
    .limit(20)
    .overrideTypes<MentionRow[], { merge: false }>();
  // Person chips in pages' text (RLS: only my own, on pages I can open).
  const { data: pageMentions } = await supabase
    .from("page_mentions")
    .select("page_id, created_at, author:profiles!page_mentions_mentioned_by_fkey(name, email), page:pages!inner(id, title, icon)")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20)
    .overrideTypes<PageMentionRow[], { merge: false }>();

  const pageLabel = (p: { title: string; icon: string | null }) => `${p.icon ? `${p.icon} ` : ""}${p.title || t.pages.untitled}`;
  const list: Mention[] = [
    ...(mentions ?? []).map((m) => ({
      key: `c-${m.id}`,
      href: `${pagePath(workspace.shortId, m.thread.page.id)}?thread=${m.thread.id}`,
      at: m.created_at,
      who: m.author?.name || m.author?.email || t.comments.formerMember,
      page: pageLabel(m.thread.page),
      text: m.body,
    })),
    ...(pageMentions ?? []).map((m) => ({
      key: `p-${m.page_id}`,
      href: pagePath(workspace.shortId, m.page.id),
      at: m.created_at,
      who: m.author?.name || m.author?.email || t.comments.formerMember,
      page: pageLabel(m.page),
      text: t.mentions.inText,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);

  // First steps (owner and admins) while the workspace is still new.
  let steps: OnboardingStep[] | null = null;
  let canAddExamples = false;
  if (isWorkspaceAdmin(workspace)) {
    const central = await createClient();
    const data = await workspaceData(wid);
    const [{ count: pageCount }, { count: memberCount }, { data: storage }, { data: centralAllowed }] = await Promise.all([
      supabase.from("pages").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).is("deleted_at", null),
      central.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "active"),
      central.rpc("workspace_storage_status", { ws: workspace.id }),
      central.rpc("central_pages_allowed", { ws: workspace.id }),
    ]);
    const pages = pageCount ?? 0;
    if (pages < 5) {
      const needsDatabase = data?.location === "central" && !centralAllowed;
      const settings = (tab: string) => workspacePath(workspace.shortId, `/settings?tab=${tab}`);
      steps = [
        ...(data?.location !== "central" || needsDatabase
          ? [{ key: "database" as const, done: data?.location === "team", href: settings("data") }]
          : []),
        { key: "page", done: pages > 0, href: workspacePath(workspace.shortId) },
        { key: "people", done: (memberCount ?? 0) > 1, href: settings("people") },
        { key: "drive", done: Boolean((storage as { drive: unknown } | null)?.drive), href: settings("data") },
        { key: "help", done: false, href: "/help" },
      ];
      canAddExamples = pages === 0 && !needsDatabase && (data?.location === "central" || data?.location === "team");
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:py-10">
      {/* The start page is a launcher: services first, then what needs attention. */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-muted">{workspace.name}</p>
          <h1 className="text-xl font-semibold tracking-tight">{t.home.greeting(user.name ?? user.email)}</h1>
        </div>
        {isWorkspaceAdmin(workspace) && (
          <Link
            href={workspacePath(workspace.shortId, "/settings")}
            aria-label={t.home.settingsLink}
            title={t.home.settingsLink}
            className={iconButtonClass("subtle")}
          >
            <Icon name="settings" size={18} />
          </Link>
        )}
      </div>

      {workspace.role !== "guest" && <BirthdaysBlock db={supabase} workspaceId={workspace.id} shortId={workspace.shortId} />}

      <ServiceTiles db={supabase} workspaceId={workspace.id} shortId={workspace.shortId} userId={user.id} />

      {steps && <Onboarding workspaceId={workspace.id} shortId={workspace.shortId} steps={steps} canAddExamples={canAddExamples} />}

      <section className="mt-10">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">{t.mentions.heading}</h2>
        {!list.length ? (
          <p className="mt-2 text-sm text-muted">{t.mentions.empty}</p>
        ) : (
          <ul className="mt-2.5 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {list.map((m) => (
              <li key={m.key}>
                <Link href={m.href} className="block px-3.5 py-2.5 hover:bg-hover">
                  <span className="block text-xs text-muted">
                    {m.who} · {t.mentions.on(m.page)} · {dateFormat().format(new Date(m.at))}
                  </span>
                  <span className="line-clamp-2 text-sm">{m.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
