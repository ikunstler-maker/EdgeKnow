import Link from "next/link";
import { dateLocale, t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { pagePath, workspacePath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace, isWorkspaceAdmin } from "@/lib/workspace";
import { NewPageButton } from "@/components/pages/new-page-button";

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
  const supabase = await createClient();
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

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <p className="text-sm text-muted">{workspace.name}</p>
      <h1 className="text-3xl font-semibold">{t.home.greeting(user.name ?? user.email)}</h1>
      <p className="mt-3 text-muted">{t.home.intro}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <NewPageButton />
        {isWorkspaceAdmin(workspace) && (
          <Link
            href={workspacePath(workspace.shortId, "/settings")}
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 hover:bg-surface"
          >
            {t.home.settingsLink}
          </Link>
        )}
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">{t.mentions.heading}</h2>
        {!list.length ? (
          <p className="mt-2 text-sm text-muted">{t.mentions.empty}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {list.map((m) => (
              <li key={m.key}>
                <Link href={m.href} className="block px-3 py-2 hover:bg-surface">
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
