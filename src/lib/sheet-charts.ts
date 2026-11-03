// Tables, step Т3: charts from a range of a sheet. A chart keeps only where its
// data is (sheet and range) and how to draw it; the numbers are read from the
// table every time, so it follows every change.

export type ChartType = "bar" | "line" | "pie" | "scatter" | "area" | "doughnut" | "horizontalBar";
export const CHART_TYPES: ChartType[] = ["bar", "horizontalBar", "line", "area", "pie", "doughnut", "scatter"];
export type SheetChart = { id: string; sheet: string; range: string; type: ChartType; title: string };

type Cell = { r: number; c: number; v: { v?: unknown; m?: string } | null };
type Sheet = { name?: string; celldata?: Cell[] };

const column = (letters: string) => letters.toUpperCase().split("").reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const columnName = (index: number) => {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

export function parseRange(range: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const m = range.trim().replace(/\$/g, "").match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
  if (!m) return null;
  const a = { r: Number(m[2]) - 1, c: column(m[1]) };
  const b = m[3] ? { r: Number(m[4]) - 1, c: column(m[3]) } : a;
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}

export const rangeOf = (rows: number[], columns: number[]) => `${columnName(columns[0])}${rows[0] + 1}:${columnName(columns[1])}${rows[1] + 1}`;

const asNumber = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/\s/g, "").replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }
  return null;
};

// The chart's labels and series, the way Excel reads a range: if the first row
// is text it names the series, if the first column is text it gives the labels;
// each other column is one series.
export function chartData(sheets: Sheet[], chart: SheetChart) {
  const box = parseRange(chart.range);
  const sheet = sheets.find((s) => s.name === chart.sheet) ?? sheets[0];
  if (!box || !sheet) return null;
  const grid = new Map((sheet.celldata ?? []).map((cell) => [`${cell.r}:${cell.c}`, cell.v]));
  const raw = (r: number, c: number) => grid.get(`${r}:${c}`)?.v;
  const text = (r: number, c: number) => {
    const v = grid.get(`${r}:${c}`);
    return String(v?.m ?? v?.v ?? "");
  };
  const height = box.r2 - box.r1 + 1;
  const width = box.c2 - box.c1 + 1;
  const headerRow = width > 0 && height > 1 && [...Array(width).keys()].some((i) => raw(box.r1, box.c1 + i) !== undefined && asNumber(raw(box.r1, box.c1 + i)) === null);
  const labelColumn = width > 1 && [...Array(height).keys()].slice(headerRow ? 1 : 0).some((i) => raw(box.r1 + i, box.c1) !== undefined && asNumber(raw(box.r1 + i, box.c1)) === null);
  const firstRow = box.r1 + (headerRow ? 1 : 0);
  const firstColumn = box.c1 + (labelColumn ? 1 : 0);
  const rows = [...Array(box.r2 - firstRow + 1).keys()].map((i) => firstRow + i);
  const labels = rows.map((r, i) => (labelColumn ? text(r, box.c1) : String(i + 1)));
  const datasets = [...Array(box.c2 - firstColumn + 1).keys()].map((i) => {
    const c = firstColumn + i;
    return { label: headerRow ? text(box.r1, c) : columnName(c), data: rows.map((r) => asNumber(raw(r, c))) };
  });
  return { labels, datasets };
}
