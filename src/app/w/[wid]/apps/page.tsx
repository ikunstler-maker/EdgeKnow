import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { readApp } from "@/lib/apps";
import { workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { AppTile } from "@/components/apps/app-tile";
import { AppBinActions, NewAppButton } from "@/components/apps/app-form";

export const metadata: Metadata = { title: `${t.apps.title} · ${t.app.name}` };

type Row = { id: string; title: string; data: unknown };

const chipClass = (on: boolean) =>
  `inline-flex min-h-11 items-center rounded-full border px-3 text-sm md:min-h-9 ${on ? "border-accent bg-accent text-white" : "border-border hover:bg-surface"}`;

// Company apps (Obriy, step O-1): the gallery of the apps the person may see (RLS
// decides), with a category filter; owners and admins add apps and see the bin.
export default async function AppsPage({ params, searchParams }: PageProps<"/w/[wid]/apps">) {
  const { wid } = await params;
  const query = await searchParams;
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const manager = workspace.role === "owner" || workspace.role === "admin";
  const bin = manager && query.bin === "1";
  const chosen = typeof query.c === "string" ? query.c : "";
  const db = await dataClient(wid);
  let request = db.from("service_objects").select("id, title, data").eq("workspace_id", workspace.id).eq("service", "apps");
  request = bin ? request.not("deleted_at", "is", null) : request.is("deleted_at", null);
  const { data } = await request.order("title").limit(1000);
  const apps = ((data ?? []) as Row[]).map((row) => ({ ...row, app: readApp(row.data) }));
  const categories = [...new Set(apps.map((a) => a.app.category).filter((c): c is string => !!c))].sort((x, y) => x.localeCompare(y));
  const shown = chosen ? apps.filter((a) => a.app.category === chosen) : apps;
  const base = workspacePath(workspace.shortId, "/apps");
  const s = t.apps;
  const withCategory = (c: string) => (c ? `${base}?c=${encodeURIComponent(c)}` : base);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold">🧩 {bin ? `${s.title} · ${s.bin}` : s.title}</h1>
        {manager && (
          <Link href={bin ? base : `${base}?bin=1`} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
            {bin ? s.hideBin : s.showBin}
          </Link>
        )}
      </div>
      {bin ? (
        apps.length === 0 ? (
          <p className="mt-6 text-muted">{s.binEmpty}</p>
        ) : (
          <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
            {apps.map((a) => (
              <li key={a.id} className="flex min-h-14 flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-medium">{a.title || s.untitled}</span>
                <AppBinActions shortId={workspace.shortId} id={a.id} title={a.title || s.untitled} />
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <p className="mt-1 text-muted">{s.intro}</p>
          {manager && (
            <div className="mt-4">
              <NewAppButton shortId={workspace.shortId} categories={categories} />
            </div>
          )}
          {categories.length > 0 && (
            <nav aria-label={s.categories} className="mt-4 flex flex-wrap gap-2" data-app-categories>
              <Link href={withCategory("")} aria-current={!chosen ? "page" : undefined} className={chipClass(!chosen)}>
                {s.all}
              </Link>
              {categories.map((c) => (
                <Link key={c} href={withCategory(c)} aria-current={chosen === c ? "page" : undefined} className={chipClass(chosen === c)}>
                  {c}
                </Link>
              ))}
            </nav>
          )}
          {shown.length === 0 ? (
            <p className="mt-6 text-muted">{chosen ? s.noneInCategory : manager ? s.noneAdmin : s.none}</p>
          ) : (
            <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2" data-apps>
              {shown.map((a) => (
                <AppTile key={a.id} shortId={workspace.shortId} id={a.id} title={a.title} app={a.app} settingsHref={manager ? `${base}/${a.id}` : null} />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
