import Link from "next/link";
import { t } from "@/i18n";
import { pagePath, workspacePath } from "@/lib/paths";
import { SERVICE_BRANDS, SERVICE_CATEGORIES, brandGradients, serviceByKey } from "@/lib/services";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ServiceIcon } from "./service-icon";
import { Icon } from "@/components/ui/icon";

const s = t.services;

type RecentPage = { id: string; title: string; icon: string | null };
type RecentTask = { number: number; title: string; project: { key: string } | null };

// The start page: services in their four groups, each tile with what was used
// last; services still being built show as "Soon".
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
    wiki: ((pages ?? []) as RecentPage[]).map((p) => ({ href: pagePath(shortId, p.id), label: `${p.icon ? `${p.icon} ` : ""}${p.title || t.pages.untitled}` })),
    nodes: ((maps ?? []) as { id: string; title: string; kind: string }[]).map((m) => ({ href: workspacePath(shortId, `/nodes/${m.id}`), label: m.title || t.nodes.untitled })),
    boards: ((boards ?? []) as { id: string; title: string }[]).map((m) => ({ href: workspacePath(shortId, `/boards/${m.id}`), label: m.title || t.boards.untitled })),
    sheets: ((sheets ?? []) as { id: string; title: string }[]).map((m) => ({ href: workspacePath(shortId, `/sheets/${m.id}`), label: m.title || t.sheets.untitled })),
    surveys: ((surveys ?? []) as { id: string; title: string }[]).map((m) => ({ href: workspacePath(shortId, `/surveys/${m.id}`), label: m.title || t.surveys.untitled })),
    tasks: (tasks ?? []).flatMap((task) =>
      task.project ? [{ href: workspacePath(shortId, `/tasks/${task.project.key}/${task.number}`), label: `${task.project.key}-${task.number} ${task.title}` }] : [],
    ),
  };

  // Where a tile leads: the wiki to its latest page (or the start), the others to their section.
  const hrefOf = (key: string, path: string | null) =>
    key === "wiki" ? (recent.wiki[0]?.href ?? null) : path !== null ? workspacePath(shortId, path) : null;

  return (
    <div className="mt-6 space-y-7" aria-label={s.heading} role="region">
      {SERVICE_CATEGORIES.map((category) => (
        <section key={category.key} aria-labelledby={`services-${category.key}`}>
          <h2 id={`services-${category.key}`} className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted">
            {s.categories[category.key]}
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {category.services.map((key) => {
              const service = serviceByKey(key);
              const item = s.items[key];
              const brand = brandGradients(key);
              const href = service.ready ? hrefOf(key, service.path) : null;
              const extra = key === "tasks" ? s.myOpenTasks(myOpen ?? 0) : null;
              const items = service.ready ? (recent[key] ?? []) : [];
              return (
                <li
                  key={key}
                  data-service={key}
                  style={{ "--brand-dark": brand.dark, "--brand-light": brand.light } as React.CSSProperties}
                  className={`group relative flex flex-col rounded-xl border p-3.5 transition-colors ${
                    service.ready ? "border-border bg-surface hover:border-border-strong" : "border-dashed border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="shrink-0" data-service-mark>
                      <ServiceIcon serviceId={key} size={36} muted={!service.ready} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[15px] font-semibold leading-tight tracking-tight" data-service-brand>
                        {href ? (
                          // The whole tile opens the service; recent items stay their own links.
                          <Link prefetch={false} href={href} className="after:absolute after:inset-0 after:rounded-xl">
                            {SERVICE_BRANDS[key].name}
                          </Link>
                        ) : (
                          SERVICE_BRANDS[key].name
                        )}
                      </h3>
                      <p className="truncate text-xs text-muted">{item.name}</p>
                    </div>
                    {!service.ready && <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">{s.soon}</span>}
                  </div>
                  <p className="mt-2.5 truncate text-[13px] text-muted" title={item.about}>
                    {item.about}
                  </p>
                  {extra && <p className="mt-1 text-xs text-muted">{extra}</p>}
                  {items.length > 0 ? (
                    <ul className="relative z-10 -mx-1.5 mt-2 hidden border-t border-border pt-1.5 text-[13px] md:block" aria-label={`${item.name}: ${s.recent}`}>
                      {items.map((r) => (
                        <li key={r.href}>
                          <Link prefetch={false} href={r.href} className="block truncate rounded-md px-1.5 py-0.5 text-muted hover:bg-hover hover:text-foreground">
                            {r.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    service.ready &&
                    key !== "wiki" &&
                    service.path && (
                      <Link prefetch={false} href={workspacePath(shortId, service.path)} className="relative z-10 mt-2 hidden items-center gap-1 self-start rounded-md px-1.5 py-0.5 text-[13px] text-muted hover:bg-hover hover:text-foreground md:inline-flex" data-service-create>
                        <Icon name="plus" size={14} />
                        {s.create}
                      </Link>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
