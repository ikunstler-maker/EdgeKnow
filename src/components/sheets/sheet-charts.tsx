"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { t } from "@/i18n";
import { CHART_TYPES, chartData, parseRange, type ChartType, type SheetChart } from "@/lib/sheet-charts";

const SheetChartView = dynamic(() => import("./sheet-chart"), { ssr: false });

const c = t.sheets.charts;
const button = "inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";
const field = "min-h-10 rounded-md border border-border bg-background px-2 text-sm";

// The table's charts (step Т3), under the sheets: each drawn from its range,
// redrawn on every change of the data.
export function SheetCharts({
  charts,
  sheets,
  selection,
  canEdit,
  onCharts,
}: {
  charts: SheetChart[];
  sheets: Record<string, unknown>[];
  selection: { sheet: string; range: string } | null;
  canEdit: boolean;
  onCharts: (charts: SheetChart[]) => void;
}) {
  const [editing, setEditing] = useState<SheetChart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = sheets.map((sheet) => String(sheet.name));

  const save = () => {
    if (!editing) return;
    if (!parseRange(editing.range)) return setError(c.badRange);
    const data = chartData(sheets as never, editing);
    if (!data || !data.datasets.some((set) => set.data.some((n) => n !== null))) return setError(c.noNumbers);
    setError(null);
    onCharts(charts.some((one) => one.id === editing.id) ? charts.map((one) => (one.id === editing.id ? editing : one)) : [...charts, editing]);
    setEditing(null);
  };

  if (!charts.length && !canEdit) return null;
  return (
    <section className="mt-4 space-y-3" aria-label={c.heading} data-sheet-charts>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{c.heading}</h2>
        {canEdit && (
          <button
            type="button"
            className={button}
            onClick={() => {
              setError(null);
              setEditing({ id: Math.random().toString(36).slice(2, 10), sheet: selection?.sheet ?? names[0] ?? "", range: selection?.range ?? "A1:B5", type: "bar", title: "" });
            }}
          >
            {c.add}
          </button>
        )}
        <span className="text-xs text-muted">{canEdit ? c.addHint : ""}</span>
      </div>

      {editing && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3" role="dialog" aria-label={c.add} data-chart-form>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
            {c.title}
            <input value={editing.title} maxLength={120} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {c.type}
            <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as ChartType })} className={field}>
              {CHART_TYPES.map((type) => (
                <option key={type} value={type}>
                  {c.types[type]}
                </option>
              ))}
            </select>
          </label>
          {names.length > 1 && (
            <label className="flex flex-col gap-1 text-sm">
              {c.sheet}
              <select value={editing.sheet} onChange={(e) => setEditing({ ...editing, sheet: e.target.value })} className={field}>
                {names.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex w-40 flex-col gap-1 text-sm">
            {c.range}
            <input value={editing.range} onChange={(e) => setEditing({ ...editing, range: e.target.value.toUpperCase() })} className={field} />
          </label>
          <button type="button" onClick={save} className="min-h-10 rounded-md bg-accent px-4 text-sm font-medium text-white">
            {c.save}
          </button>
          <button type="button" onClick={() => setEditing(null)} className={button}>
            {c.cancel}
          </button>
          {error && (
            <p role="alert" className="w-full text-sm text-danger">
              {error}
            </p>
          )}
          <p className="w-full text-xs text-muted">{c.notInExcel}</p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {charts.map((chart) => (
          <figure key={chart.id} className="rounded-lg border border-border p-3" data-chart={chart.title || c.untitled}>
            <div className="h-72">
              <SheetChartView chart={chart} sheets={sheets} />
            </div>
            <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="flex-1 truncate">
                {chart.title || c.untitled} · {c.types[chart.type]} · {chart.sheet}!{chart.range}
              </span>
              {canEdit && (
                <>
                  <button type="button" className={button} onClick={() => setEditing(chart)}>
                    {c.edit}
                  </button>
                  <button type="button" className={`${button} text-danger`} onClick={() => confirm(c.removeConfirm(chart.title || c.untitled)) && onCharts(charts.filter((one) => one.id !== chart.id))}>
                    {c.remove}
                  </button>
                </>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
