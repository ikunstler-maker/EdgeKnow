import Link from "next/link";
import { t } from "@/i18n";
import { pagePath, workspacePath } from "@/lib/paths";
import { SERVICES, SERVICE_BRANDS, brandGradients } from "@/lib/services";
import type { SupabaseClient } from "@supabase/supabase-js";

const s = t.services;

type RecentPage = { id: string; title: string; icon: string | null };
type RecentTask = { number: number; title: string; project: { key: string } | null };

// The start page: a tile per service with what was used last; services still
// being built show as "Soon", so they can be seen (and tried) as they appear.
export async function ServiceTiles({ db, workspaceId, shortId, userId }: { db: SupabaseClient; workspaceId: string; shortId: string; userId: string }) {
  const [{ data: pages }, { data: tasks }, { count: myOpen }, { data: maps }, { data: boards }, { data: sheets }, { data: surveys }] = await Promise.all([
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
    db.from("service_objects").select("id, title").eq("workspace_id", workspaceId).eq("service", "boards").is("deleted_at", null).order("updated_at", { ascending: false }).limit(3),
    db.from("service_objects").select("id, title").eq("workspace_id", workspaceId).eq("service", "sheets").is("deleted_at", null).order("updated_at", { ascending: false }).limit(3),
    db.from("service_objects").select("id, title").eq("workspace_id", workspaceId).eq("service", "surveys").is("deleted_at", null).order("updated_at", { ascending: false }).limit(3),
  ]);
  const recent: Record<string, { href: string; label: string }[]> = {
    wiki: ((pages ?? []) as RecentPage[]).map((p) => ({ href: pagePath(shortId, p.id), label: `${p.icon ?? "📄"} ${p.title || t.pages.untitled}` })),
    nodes: ((maps ?? []) as { id: string; title: string; kind: string }[]).map((m) => ({ href: workspacePath(shortId, `/nodes/${m.id}`), label: `${m.kind === "flow" ? "🔀" : "🧠"} ${m.title || t.nodes.untitled}` })),
    boards: ((boards ?? []) as { id: string; title: string }[]).map((m) => ({ href: workspacePath(shortId, `/boards/${m.id}`), label: `🎨 ${m.title || t.boards.untitled}` })),
    sheets: ((sheets ?? []) as { id: string; title: string }[]).map((m) => ({ href: workspacePath(shortId, `/sheets/${m.id}`), label: `📊 ${m.title || t.sheets.untitled}` })),
    surveys: ((surveys ?? []) as { id: string; title: string }[]).map((m) => ({ href: workspacePath(shortId, `/surveys/${m.id}`), label: `📝 ${m.title || t.surveys.untitled}` })),
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
        {SERVICES.map((service, index) => {
          const item = s.items[service.key];
          const brand = brandGradients(service.key);
          const href = service.ready ? hrefOf(service.key, service.path) : null;
          const extra = service.key === "tasks" ? s.myOpenTasks(myOpen ?? 0) : null;
          return (
            <li
              key={service.key}
              data-service={service.key}
              style={{ "--brand-dark": brand.dark, "--brand-light": brand.light } as React.CSSProperties}
              className={`group relative flex min-h-32 flex-col overflow-hidden rounded-3xl border p-4 pt-5 transition ${
                service.ready ? "border-border bg-background hover:shadow-md" : "border-dashed border-border bg-surface/50"
              }`}
            >
              {/* The service's colours: a thin bar on top, its squircle and its name. */}
              <span className="ek-brand-fill absolute inset-x-0 top-0 h-1.5 opacity-90 transition-all group-hover:h-2" aria-hidden="true" />
              <div className="flex items-start gap-3">
                <span
                  className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface font-mono text-sm font-black"
                  aria-hidden="true"
                  data-service-mark
                >
                  <span className="ek-brand-fill absolute inset-0 opacity-20" />
                  <span className="relative">{String(index + 1).padStart(2, "0")}</span>
                </span>
                <div className="min-w-0">
                  <span className="inline-block rounded-lg border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">{item.name}</span>
                  <h2 className="ek-brand-text mt-1 block text-lg font-extrabold leading-snug tracking-tight" data-service-brand>
                    {href ? (
                      // The whole tile opens the service; recent items stay their own links.
                      <Link href={href} className="after:absolute after:inset-0 after:rounded-3xl">
                        {SERVICE_BRANDS[service.key].name}
                      </Link>
                    ) : (
                      SERVICE_BRANDS[service.key].name
                    )}
                  </h2>
                </div>
              </div>
              {!service.ready ? (
                <>
                  <p className="mt-2 hidden text-sm text-muted sm:block">{item.about}</p>
                  <span className="mt-2 self-start rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">{s.soon}</span>
                </>
              ) : (
                <>
                  <p className="mt-2 hidden text-sm text-muted sm:block">{item.about}</p>
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
