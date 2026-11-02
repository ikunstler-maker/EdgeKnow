import type { Metadata } from "next";
import Link from "next/link";
import { dateLocale, t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { NewNodeMapButton, NodeBinActions } from "@/components/nodes/node-list-actions";

export const metadata: Metadata = { title: `${t.nodes.title} · ${t.app.name}` };

type Row = { id: string; title: string; kind: string; updated_at: string; deleted_at: string | null };

// The node space: the maps and diagrams the person can open (RLS decides), or the bin.
export default async function NodeSpacePage({ params, searchParams }: PageProps<"/w/[wid]/nodes">) {
  const { wid } = await params;
  const bin = (await searchParams).bin === "1";
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const db = await dataClient(wid);
  let request = db.from("service_objects").select("id, title, kind, updated_at, deleted_at").eq("workspace_id", workspace.id).eq("service", "nodes");
  request = bin ? request.not("deleted_at", "is", null) : request.is("deleted_at", null);
  const { data } = await request.order("updated_at", { ascending: false }).limit(500);
  const rows = (data ?? []) as Row[];
  const when = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const base = workspacePath(workspace.shortId, "/nodes");

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold">🧠 {bin ? `${t.nodes.title} · ${t.nodes.bin}` : t.nodes.title}</h1>
        <Link href={bin ? base : `${base}?bin=1`} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
          {bin ? t.nodes.hideBin : t.nodes.showBin}
        </Link>
      </div>
      {!bin && (
        <>
          <p className="mt-1 text-muted">{t.nodes.intro}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <NewNodeMapButton shortId={workspace.shortId} />
            <span className="inline-flex min-h-11 items-center rounded-lg border border-dashed border-border px-4 text-sm text-muted md:min-h-9" title={t.nodes.flowSoon}>
              {t.nodes.newFlow} · {t.services.soon}
            </span>
          </div>
        </>
      )}
      {rows.length === 0 ? (
        <p className="mt-6 text-muted">{bin ? t.nodes.binEmpty : t.nodes.none}</p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-lg border border-border" data-node-maps>
          {rows.map((row) => (
            <li key={row.id} className="flex min-h-14 flex-wrap items-center gap-3 px-3 py-2" data-node-map={row.title || t.nodes.untitled}>
              <span aria-hidden="true" className="text-xl">
                {row.kind === "flow" ? "🔀" : "🧠"}
              </span>
              <div className="min-w-0 flex-1">
                {bin ? (
                  <span className="block truncate font-medium">{row.title || t.nodes.untitled}</span>
                ) : (
                  <Link href={`${base}/${row.id}`} className="block truncate font-medium hover:underline">
                    {row.title || t.nodes.untitled}
                  </Link>
                )}
                <span className="text-xs text-muted">
                  {t.nodes.kinds[row.kind]} · {t.nodes.updated(when(row.updated_at))}
                </span>
              </div>
              {bin && <NodeBinActions shortId={workspace.shortId} id={row.id} title={row.title || t.nodes.untitled} />}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
