import Link from "next/link";
import { t } from "@/i18n";
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

const dateFormat = new Intl.DateTimeFormat("uk-UA", { dateStyle: "short", timeStyle: "short" });

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
        {!mentions?.length ? (
          <p className="mt-2 text-sm text-muted">{t.mentions.empty}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {mentions.map((m) => (
              <li key={m.id}>
                <Link
                  href={`${pagePath(workspace.shortId, m.thread.page.id)}?thread=${m.thread.id}`}
                  className="block px-3 py-2 hover:bg-surface"
                >
                  <span className="block text-xs text-muted">
                    {m.author?.name || m.author?.email || t.comments.formerMember} ·{" "}
                    {t.mentions.on(`${m.thread.page.icon ? `${m.thread.page.icon} ` : ""}${m.thread.page.title || t.pages.untitled}`)} ·{" "}
                    {dateFormat.format(new Date(m.created_at))}
                  </span>
                  <span className="line-clamp-2 text-sm">{m.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
