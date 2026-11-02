import Link from "next/link";
import { t } from "@/i18n";
import { pagePath, workspacePath } from "@/lib/paths";
import { SERVICES } from "@/lib/services";
import { NewPageButton } from "@/components/pages/new-page-button";
import { NewNodeMapButton } from "@/components/nodes/node-list-actions";
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

  return (
    <section className="mt-8" aria-label={s.heading}>
      <h2 className="text-lg font-semibold">{s.heading}</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICES.map((service) => {
          const item = s.items[service.key];
          const href = service.path !== null && service.key !== "wiki" ? workspacePath(shortId, service.path) : null;
          return (
            <li
              key={service.key}
              data-service={service.key}
              className={`flex flex-col rounded-xl border p-4 ${service.ready ? "border-border bg-background" : "border-dashed border-border bg-surface/50"}`}
            >
              <div className="flex items-start gap-3">
                <span className="text-3xl" aria-hidden="true">
                  {service.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">
                    {href ? (
                      <Link href={href} className="hover:underline">
                        {item.name}
                      </Link>
                    ) : (
                      item.name
                    )}
                    {!service.ready && <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 align-middle text-xs font-medium text-accent">{s.soon}</span>}
                  </h3>
                  <p className="text-sm text-muted">{item.about}</p>
                </div>
              </div>
              {service.ready ? (
                <div className="mt-3 flex flex-1 flex-col">
                  {service.key === "tasks" && <p className="text-xs text-muted">{s.myOpenTasks(myOpen ?? 0)}</p>}
                  <p className="mt-1 text-xs font-medium text-muted">{s.recent}</p>
                  {recent[service.key]?.length ? (
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {recent[service.key].map((r) => (
                        <li key={r.href}>
                          <Link href={r.href} className="block truncate rounded px-1 hover:bg-surface">
                            {r.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted">{s.nothingYet}</p>
                  )}
                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                    {service.key === "wiki" ? (
                      <NewPageButton />
                    ) : service.key === "nodes" ? (
                      <>
                        <NewNodeMapButton shortId={shortId} />
                        {href && (
                          <Link href={href} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm hover:bg-surface md:min-h-9">
                            {s.open}
                          </Link>
                        )}
                      </>
                    ) : (
                      href && (
                        <Link href={href} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm hover:bg-surface md:min-h-9">
                          {s.open}
                        </Link>
                      )
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted">{s.soonHint}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
