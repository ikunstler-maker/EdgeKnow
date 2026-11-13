import type { Metadata } from "next";
import Link from "next/link";
import { dateLocale, t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { SheetBinActions, NewSheetButton } from "@/components/sheets/sheet-list-actions";
import { OpenSheetFileButton } from "@/components/sheets/sheet-files";
import { Icon } from "@/components/ui/icon";
import { ServiceIcon } from "@/components/services/service-icon";
import { ObjectRowActions } from "@/components/services/object-row-actions";
import { rolesOf } from "@/lib/object-roles";
import { Hint } from "@/components/ui/hint";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: `${t.sheets.title} · ${t.app.name}` };

type Row = { id: string; title: string; updated_at: string };

// Tables (step Т1): the tables the person can open (RLS decides), or the bin.
export default async function SheetsPage({ params, searchParams }: PageProps<"/w/[wid]/sheets">) {
  const { wid } = await params;
  const bin = (await searchParams).bin === "1";
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const db = await dataClient(wid);
  let request = db.from("service_objects").select("id, title, updated_at").eq("workspace_id", workspace.id).eq("service", "sheets");
  request = bin ? request.not("deleted_at", "is", null) : request.is("deleted_at", null);
  const { data } = await request.order("updated_at", { ascending: false }).limit(500);
  const rows = (data ?? []) as Row[];
  const roles = bin ? new Map<string, string | null>() : await rolesOf(db, rows.map((row) => row.id));
  const when = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const base = workspacePath(workspace.shortId, "/sheets");
  const b = t.sheets;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 md:py-8">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-xl font-semibold tracking-tight">
          <ServiceIcon serviceId="sheets" size={28} />
          <span className="truncate">{bin ? `${b.title} · ${b.bin}` : b.title}</span>
          {!bin && <Hint label={b.title} text={b.intro} />}
        </h1>
        <Link href={bin ? base : `${base}?bin=1`} className={buttonClass("ghost")}>
          <Icon name={bin ? "arrow-left" : "trash"} />
          {bin ? b.hideBin : b.showBin}
        </Link>
        {!bin && (
          <>
          <NewSheetButton shortId={workspace.shortId} />
          <OpenSheetFileButton shortId={workspace.shortId} />
          </>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{bin ? b.binEmpty : b.none}</p>
      ) : (
        <ul className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" data-sheets>
          {rows.map((row) => (
            <li key={row.id} className="flex min-h-14 flex-wrap items-center gap-3 px-3 py-2" data-sheet={row.title || b.untitled}>
              <ServiceIcon serviceId="sheets" size={22} />
              <div className="min-w-0 flex-1">
                {bin ? (
                  <span className="block truncate text-sm font-medium">{row.title || b.untitled}</span>
                ) : (
                  <Link href={`${base}/${row.id}`} className="block truncate text-sm font-medium hover:underline">
                    {row.title || b.untitled}
                  </Link>
                )}
                <span className="text-xs text-muted">{b.updated(when(row.updated_at))}</span>
              </div>
              {bin && <SheetBinActions shortId={workspace.shortId} id={row.id} title={row.title || b.untitled} />}
              {!bin && <ObjectRowActions shortId={workspace.shortId} id={row.id} title={row.title || b.untitled} href={`${base}/${row.id}`} role={roles.get(row.id) ?? null} />}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
