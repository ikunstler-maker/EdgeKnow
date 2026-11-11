"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { readWorkbook, type SheetData } from "@/lib/sheets";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { createSheet, saveSheet, sheetView, sheetsForEmbed, type SheetSummary, type SheetView } from "@/app/sheet-actions";
import { Icon } from "@/components/ui/icon";

const SheetEditor = dynamic(() => import("@/components/sheets/sheet-editor"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted" data-export-loading>{t.sheets.embed.loading}</p> });
const SheetChartView = dynamic(() => import("@/components/sheets/sheet-chart"), { ssr: false });

const e = t.sheets.embed;
// The page editor must not see the table's keys, clipboard or drops.
const ISOLATED = ["keydown", "keyup", "keypress", "paste", "copy", "cut", "drop", "dragover", "dragstart", "beforeinput", "input", "compositionstart", "compositionend"];

// A table, or one of its charts, on a wiki page (step Т4). Only the ids are
// stored in the page; what shows is read live with the reader's own access.
// Who may edit the table changes it right here; saved a moment later.
export const sheetBlock = createReactBlockSpec(
  {
    type: "sheetEmbed",
    propSchema: { sheetId: { default: "" }, chartId: { default: "" } },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: ({ block, editor }) => (
      <SheetEmbed
        sheetId={block.props.sheetId}
        chartId={block.props.chartId}
        pageEditable={editor.isEditable}
        onPick={(sheetId, chartId) => editor.updateBlock(block, { props: { sheetId, chartId } })}
      />
    ),
    toExternalHTML: () => <p>[{e.title}]</p>,
  },
);

export function SheetEmbed({ sheetId, chartId, pageEditable, onPick }: { sheetId: string; chartId: string; pageEditable: boolean; onPick: (sheetId: string, chartId: string) => void }) {
  const pages = useOptionalPages();
  const shortId = pages?.workspace.shortId ?? "";
  const [view, setView] = useState<SheetView | null | undefined>(undefined);
  const [list, setList] = useState<SheetSummary[] | null>(null);
  const [picked, setPicked] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [tick, setTick] = useState(0);
  const version = useRef(0);
  const busy = useRef(false);
  // A fresh version read while a change was being saved: looked at again once it is saved.
  const missed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Read now, every 30 seconds while shown and when the tab comes back.
  useEffect(() => {
    if (!shortId || !sheetId) return;
    let alive = true;
    sheetView(shortId, sheetId).then((result) => {
      if (!alive) return;
      if (busy.current) {
        missed.current = true;
        return;
      }
      if (result && result.version === version.current) return;
      version.current = result?.version ?? 0;
      setView(result);
    });
    const again = () => document.visibilityState === "visible" && setTick((n) => n + 1);
    const poll = setInterval(again, 30_000);
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      alive = false;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, [shortId, sheetId, tick]);
  useEffect(() => {
    if (!sheetId && pageEditable && shortId && !list) sheetsForEmbed(shortId).then(setList);
  }, [sheetId, pageEditable, shortId, list]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const stop = (event: Event) => event.stopPropagation();
    for (const name of ISOLATED) element.addEventListener(name, stop);
    return () => {
      for (const name of ISOLATED) element.removeEventListener(name, stop);
    };
  }, [view]);

  const save = (data: SheetData) => {
    if (!view) return;
    busy.current = true;
    if (timer.current) clearTimeout(timer.current);
    // The table's charts stay as they are.
    const charts = readWorkbook(view.data, t.sheets.firstSheet).charts;
    timer.current = setTimeout(() => {
      startTransition(async () => {
        const result = await saveSheet(shortId, view.id, null, { ...data, charts }, version.current);
        busy.current = false;
        if (missed.current) {
          missed.current = false;
          setTick((n) => n + 1);
        }
        if (result.ok) {
          version.current = result.version;
          setNotice(null);
        } else {
          setNotice(result.error === "conflict" ? e.conflict : (t.sheets.errors[result.error] ?? t.common.unknownError));
          version.current = -1;
          setTick((n) => n + 1);
        }
      });
    }, 900);
  };

  let body: React.ReactNode;
  if (!sheetId) {
    const chosen = list?.find((item) => item.id === picked);
    body = pageEditable ? (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={picked} onChange={(event) => setPicked(event.target.value)} aria-label={e.choose} className="min-h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2">
          <option value="">{e.choose}</option>
          {(list ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.title || t.sheets.untitled}
            </option>
          ))}
        </select>
        {chosen && (
          <select defaultValue="" onChange={(event) => event.target.value && onPick(chosen.id, event.target.value)} aria-label={t.sheets.charts.heading} className="min-h-9 rounded-md border border-border bg-background px-2">
            <option value="">{t.sheets.charts.heading}…</option>
            {chosen.charts.map((chart) => (
              <option key={chart.id} value={chart.id}>
                {e.chart(chart.title || t.sheets.charts.untitled)}
              </option>
            ))}
          </select>
        )}
        {chosen && (
          <button type="button" onClick={() => onPick(chosen.id, "")} className="min-h-9 rounded-md border border-border px-3 hover:bg-surface">
            {e.whole}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const made = await createSheet(shortId);
              if (made.ok) onPick(made.id, "");
              else setNotice(t.sheets.errors[made.error] ?? t.common.unknownError);
            })
          }
          className="min-h-9 rounded-md border border-border px-3 hover:bg-surface"
        >
          {t.sheets.newSheet}
        </button>
      </div>
    ) : (
      <p className="text-sm text-muted">{e.empty}</p>
    );
  } else if (view === undefined) {
    body = <p className="text-sm text-muted" data-export-loading>{e.loading}</p>;
  } else if (view === null) {
    body = <p className="text-sm text-muted"><Icon name="lock" className="mr-1.5 inline" />{e.noAccess}</p>;
  } else {
    const workbook = readWorkbook(view.data, t.sheets.firstSheet);
    const chart = chartId ? workbook.charts?.find((one) => one.id === chartId) : undefined;
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            <Icon name={chart ? "chart" : "table"} className="mr-1.5 inline text-muted" />
          {view.title || t.sheets.untitled}
            {chart && ` · ${chart.title || t.sheets.charts.untitled}`}
          </span>
          <span className="flex-1" />
          <Link href={workspacePath(shortId, `/sheets/${view.id}`)} className="text-sm text-accent hover:underline">
            {e.openEditor}
            <Icon name="arrow-up-right" size={14} className="ml-1 inline" />
          </Link>
        </div>
        {chartId ? (
          chart ? (
            <div className="h-72" data-sheet-embed-chart>
              <SheetChartView key={view.version} chart={chart} sheets={workbook.sheets} />
            </div>
          ) : (
            <p className="text-sm text-muted">{e.noChart}</p>
          )
        ) : (
          <div ref={box} className="h-[420px] overflow-hidden rounded-md border border-border bg-white text-black" data-sheet-embed-grid>
            <SheetEditor key={`${view.id}:${view.version}`} initial={workbook} editable={view.canEdit} onChange={save} />
          </div>
        )}
      </>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-border p-3" contentEditable={false} data-sheet-embed={view?.title ?? ""}>
      {body}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
