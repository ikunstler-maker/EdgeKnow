import Link from "next/link";
import { t } from "@/i18n";
import { pagePath, workspacePath } from "@/lib/paths";
import { SERVICES } from "@/lib/services";
import type { SupabaseClient } from "@supabase/supabase-js";

const s = t.services;

type RecentPage = { id: string; title: string; icon: string | null };
type RecentTask = { number: number; title: string; project: { key: string } | null };

// The start page: a tile per service with what was used last; services still
// being built show as "Soon", so they can be seen (and tried) as they appear.
export async function ServiceTiles({ db, workspaceId, shortId, userId }: { db: SupabaseClient; workspaceId: string; shortId: string; userId: string }) {
  const [{ data: pages }, { data: tasks }, { count: myOpen }, { data: maps }] = await Promise.all([
    db.from("pages").select("id, title, icon").eq("workspace_id", workspaceId).is("deleted_at", null).order("updated_at", { ascending: false }).limit(3),
    db
      .from("tasks")
      .select("number, title, project:task_projects(key)")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(3)
      .overrideTypes<RecentTask[], { merge: false }>(),
    db.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("assignee_id", userId).is("deleted_at", null).is("done_at", null),
    db.from("service_objects").select("id, title, kind").eq("workspace_id", workspaceId).eq("service", "nodes").is("deleted_at", null).order("updated_at", { ascending: false }).limit(3),
  ]);
  const recent: Record<string, { href: string; label: string }[]> = {
    wiki: ((pages ?? []) as RecentPage[]).map((p) => ({ href: pagePath(shortId, p.id), label: `${p.icon ?? "📄"} ${p.title || t.pages.untitled}` })),
    nodes: ((maps ?? []) as { id: string; title: string; kind: string }[]).map((m) => ({ href: workspacePath(shortId, `/nodes/${m.id}`), label: `${m.kind === "flow" ? "🔀" : "🧠"} ${m.title || t.nodes.untitled}` })),
    tasks: (tasks ?? []).flatMap((task) =>
      task.project ? [{ href: workspacePath(shortId, `/tasks/${task.project.key}/${task.number}`), label: `${task.project.key}-${task.number} ${task.title}` }] : [],
    ),
  };

  // Where a tile leads: the wiki to its latest page (or the start), the others to their section.
  const hrefOf = (key: string, path: string | null) =>
    key === "wiki" ? (recent.wiki[0]?.href ?? null) : path !== null ? workspacePath(shortId, path) : null;

  return (
    <section className="mt-6" aria-label={s.heading}>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {SERVICES.map((service) => {
          const item = s.items[service.key];
          const href = service.ready ? hrefOf(service.key, service.path) : null;
          const extra = service.key === "tasks" ? s.myOpenTasks(myOpen ?? 0) : null;
          return (
            <li
              key={service.key}
              data-service={service.key}
              className={`relative flex min-h-32 flex-col rounded-2xl border p-4 transition ${
                service.ready ? "border-border bg-background hover:border-accent hover:shadow-md" : "border-dashed border-border bg-surface/50"
              }`}
            >
              <span className="text-4xl" aria-hidden="true">
                {service.icon}
              </span>
              <h2 className="mt-2 font-semibold leading-tight">
                {href ? (
                  // The whole tile opens the service; recent items stay their own links.
                  <Link href={href} className="after:absolute after:inset-0 after:rounded-2xl">
                    {item.name}
                  </Link>
                ) : (
                  item.name
                )}
              </h2>
              {!service.ready ? (
                <span className="mt-1 self-start rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">{s.soon}</span>
              ) : (
                <>
                  <p className="mt-1 hidden text-sm text-muted sm:block">{item.about}</p>
                  {extra && <p className="mt-1 text-xs text-muted">{extra}</p>}
                  {recent[service.key]?.length ? (
                    <ul className="relative z-10 mt-2 hidden space-y-0.5 text-sm md:block" aria-label={`${item.name}: ${s.recent}`}>
                      {recent[service.key].map((r) => (
                        <li key={r.href}>
                          <Link href={r.href} className="block truncate rounded px-1 text-muted hover:bg-surface hover:text-foreground">
                            {r.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
