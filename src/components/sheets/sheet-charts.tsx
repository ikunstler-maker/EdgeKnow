"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { Icon } from "@/components/ui/icon";
import { CHART_TYPES, chartData, parseRange, type ChartType, type SheetChart } from "@/lib/sheet-charts";

const SheetChartView = dynamic(() => import("./sheet-chart"), { ssr: false });

const c = t.sheets.charts;
const button = "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";
const field = "min-h-10 rounded-md border border-border bg-background px-2 text-sm";

const blank = (selection: { sheet: string; range: string } | null, names: string[]): SheetChart => ({ id: Math.random().toString(36).slice(2, 10), sheet: selection?.sheet ?? names[0] ?? "", range: selection?.range ?? "A1:B5", type: "bar", title: "" });

// The table's charts (step Т3), in a panel beside the sheets: each drawn from its range,
// redrawn on every change of the data.
export function SheetCharts({
  charts,
  sheets,
  selection,
  canEdit,
  onCharts,
  startNew = false,
  onStarted,
  onClose,
}: {
  charts: SheetChart[];
  sheets: Record<string, unknown>[];
  selection: { sheet: string; range: string } | null;
  canEdit: boolean;
  onCharts: (charts: SheetChart[]) => void;
  // "New chart" was pressed in the top bar: open the form, then say it was taken.
  startNew?: boolean;
  onStarted?: () => void;
  onClose?: () => void;
}) {
  const [editing, setEditing] = useState<SheetChart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = sheets.map((sheet) => String(sheet.name));
  const begin = () => {
    setError(null);
    setEditing(blank(selection, names));
  };
  useEffect(() => {
    if (!startNew) return;
    // Asked for from the top bar: the same as the panel's own button, once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    begin();
    onStarted?.();
  });

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
    <section className="space-y-3" aria-label={c.heading} data-sheet-charts>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">{c.heading}</h2>
        {canEdit && (
          <button
            type="button"
            className={button}
            onClick={begin}
          >
            {c.add}
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label={t.common.close} title={t.common.close} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-hover md:h-8 md:w-8">
            <Icon name="close" />
          </button>
        )}
      </div>
      {charts.length === 0 && !editing && <p className="rounded-xl border border-dashed border-border p-4 text-xs text-muted">{c.addHint}</p>}

      {editing && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3" role="dialog" aria-label={c.add} data-chart-form>
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

      <div className="grid gap-3">
        {charts.map((chart) => (
          <figure key={chart.id} className="rounded-xl border border-border bg-surface p-3" data-chart={chart.title || c.untitled}>
            <div className="h-56">
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
