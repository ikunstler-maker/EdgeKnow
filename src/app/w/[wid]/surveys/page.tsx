import type { Metadata } from "next";
import Link from "next/link";
import { dateLocale, t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { SurveyBinActions, NewSurveyButton } from "@/components/surveys/survey-list-actions";

export const metadata: Metadata = { title: `${t.surveys.title} · ${t.app.name}` };

type Row = { id: string; title: string; updated_at: string };

// Surveys (step О1): the surveys the person can open (RLS decides), or the bin.
export default async function SurveysPage({ params, searchParams }: PageProps<"/w/[wid]/surveys">) {
  const { wid } = await params;
  const bin = (await searchParams).bin === "1";
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const db = await dataClient(wid);
  let request = db.from("service_objects").select("id, title, updated_at").eq("workspace_id", workspace.id).eq("service", "surveys");
  request = bin ? request.not("deleted_at", "is", null) : request.is("deleted_at", null);
  const { data } = await request.order("updated_at", { ascending: false }).limit(500);
  const rows = (data ?? []) as Row[];
  const when = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const base = workspacePath(workspace.shortId, "/surveys");
  const b = t.surveys;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold">📝 {bin ? `${b.title} · ${b.bin}` : b.title}</h1>
        <Link href={bin ? base : `${base}?bin=1`} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
          {bin ? b.hideBin : b.showBin}
        </Link>
      </div>
      {!bin && (
        <>
          <p className="mt-1 text-muted">{b.intro}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <NewSurveyButton shortId={workspace.shortId} />
          </div>
        </>
      )}
      {rows.length === 0 ? (
        <p className="mt-6 text-muted">{bin ? b.binEmpty : b.none}</p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-lg border border-border" data-surveys>
          {rows.map((row) => (
            <li key={row.id} className="flex min-h-14 flex-wrap items-center gap-3 px-3 py-2" data-survey={row.title || b.untitled}>
              <span aria-hidden="true" className="text-xl">
                📝
              </span>
              <div className="min-w-0 flex-1">
                {bin ? (
                  <span className="block truncate font-medium">{row.title || b.untitled}</span>
                ) : (
                  <Link href={`${base}/${row.id}`} className="block truncate font-medium hover:underline">
                    {row.title || b.untitled}
                  </Link>
                )}
                <span className="text-xs text-muted">{b.updated(when(row.updated_at))}</span>
              </div>
              {bin && <SurveyBinActions shortId={workspace.shortId} id={row.id} title={row.title || b.untitled} />}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
