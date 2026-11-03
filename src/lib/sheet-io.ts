// Tables, step Т2: opening and saving Excel (XLSX) and CSV files, in the browser.
// Kept across: values, formulas (with their last result), number and date
// formats, bold/italic/underline/strikethrough, font, size, colours, fill,
// alignment and wrapping, column widths and row heights, merged cells, frozen
// panes. Pictures, charts, macros and pivot tables of Excel files stay behind.
import { update as formatValue } from "@fortune-sheet/core";
import type { SheetData } from "./sheets";

type FortuneCell = {
  v?: unknown;
  m?: string;
  f?: string;
  ct?: { fa?: string; t?: string; s?: { v?: string }[] };
  bl?: number;
  it?: number;
  un?: number;
  cl?: number;
  ff?: string | number;
  fs?: number;
  fc?: string;
  bg?: string;
  ht?: number | string;
  vt?: number | string;
  tb?: number | string;
  mc?: { r: number; c: number; rs?: number; cs?: number };
};
type FortuneSheet = {
  name: string;
  order?: number;
  row?: number;
  column?: number;
  status?: number;
  celldata?: { r: number; c: number; v: FortuneCell | null }[];
  config?: { merge?: Record<string, { r: number; c: number; rs: number; cs: number }>; columnlen?: Record<string, number>; rowlen?: Record<string, number> };
  frozen?: { type: string; range?: { row_focus: number; column_focus: number } };
};

export const MAX_ROWS = 10_000;
export const MAX_COLUMNS = 1000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

const toSerial = (date: Date) => (date.getTime() - EXCEL_EPOCH) / 86_400_000;
const argb = (hex: string | undefined) => {
  const clean = String(hex ?? "").replace("#", "");
  return /^[0-9a-f]{6}$/i.test(clean) ? `FF${clean.toUpperCase()}` : undefined;
};
const hex = (color: { argb?: string } | undefined) => (color?.argb && /^[0-9a-f]{8}$/i.test(color.argb) ? `#${color.argb.slice(2)}` : undefined);
const shown = (fa: string, value: unknown) => {
  try {
    return String(formatValue(fa, value as never));
  } catch {
    return String(value ?? "");
  }
};
const textOf = (cell: FortuneCell) => {
  if (cell.ct?.t === "inlineStr" && Array.isArray(cell.ct.s)) return cell.ct.s.map((part) => part.v ?? "").join("");
  return cell.m ?? (cell.v === null || cell.v === undefined ? "" : String(cell.v));
};

const loadExcel = async () => (await import("exceljs")).default;

// --- Excel file → table -------------------------------------------------------------------------------

export async function readXlsx(file: ArrayBuffer): Promise<{ data: SheetData; cut: boolean }> {
  const ExcelJS = await loadExcel();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file);
  let cut = false;
  const sheets: FortuneSheet[] = [];
  book.eachSheet((ws, index) => {
    const celldata: NonNullable<FortuneSheet["celldata"]> = [];
    let lastRow = 0;
    let lastColumn = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS) {
        cut = true;
        return;
      }
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        if (columnNumber > MAX_COLUMNS) {
          cut = true;
          return;
        }
        const out = fromExcelCell(cell);
        if (!out) return;
        celldata.push({ r: rowNumber - 1, c: columnNumber - 1, v: out });
        lastRow = Math.max(lastRow, rowNumber);
        lastColumn = Math.max(lastColumn, columnNumber);
      });
    });
    // Merged cells: the top-left one carries the size, the others point to it.
    const merge: NonNullable<NonNullable<FortuneSheet["config"]>["merge"]> = {};
    const merges = (ws.model as unknown as { merges?: string[] }).merges ?? [];
    for (const range of merges) {
      const [from, to] = range.split(":").map(address);
      if (!from || !to) continue;
      const block = { r: from.r, c: from.c, rs: to.r - from.r + 1, cs: to.c - from.c + 1 };
      merge[`${block.r}_${block.c}`] = block;
      for (let r = block.r; r < block.r + block.rs; r++) {
        for (let c = block.c; c < block.c + block.cs; c++) {
          let item = celldata.find((d) => d.r === r && d.c === c);
          if (!item) celldata.push((item = { r, c, v: {} }));
          item.v = { ...(item.v ?? {}), mc: r === block.r && c === block.c ? block : { r: block.r, c: block.c } };
        }
      }
    }
    const columnlen: Record<string, number> = {};
    (ws.columns ?? []).forEach((column, i) => {
      if (column?.width && i < MAX_COLUMNS) columnlen[i] = Math.round(column.width * 7 + 5);
    });
    const rowlen: Record<string, number> = {};
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (row.height && rowNumber <= MAX_ROWS) rowlen[rowNumber - 1] = Math.round(row.height / 0.75);
    });
    const view = (ws.views ?? [])[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
    const frozen =
      view?.state === "frozen" && (view.xSplit || view.ySplit)
        ? {
            type: view.xSplit && view.ySplit ? "rangeBoth" : view.ySplit ? "rangeRow" : "rangeColumn",
            range: { row_focus: Math.max(0, (view.ySplit ?? 1) - 1), column_focus: Math.max(0, (view.xSplit ?? 1) - 1) },
          }
        : undefined;
    sheets.push({
      name: ws.name.slice(0, 31) || `Sheet${index}`,
      order: sheets.length,
      status: sheets.length === 0 ? 1 : 0,
      row: Math.min(MAX_ROWS, Math.max(100, lastRow + 20)),
      column: Math.min(MAX_COLUMNS, Math.max(26, lastColumn + 5)),
      celldata,
      config: { merge, columnlen, rowlen },
      ...(frozen ? { frozen } : {}),
    });
  });
  return { data: { sheets: sheets as unknown as SheetData["sheets"] }, cut };
}

function address(ref: string): { r: number; c: number } | null {
  const m = ref.trim().match(/^\$?([A-Z]+)\$?(\d+)$/i);
  if (!m) return null;
  const c = m[1].toUpperCase().split("").reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { r: Number(m[2]) - 1, c };
}

// The format engine reads a dot as the decimal mark: in dates it is escaped (dd\.mm\.yyyy).
function forFortune(format: string) {
  const isDate = /[dmyhs]/i.test(format.replace(/"[^"]*"/g, "")) && !/[0#]/.test(format);
  return isDate ? format.replace(/(^|[^\\])\./g, "$1\\.") : format;
}

type ExcelCell = {
  value: unknown;
  numFmt?: string;
  font?: { bold?: boolean; italic?: boolean; underline?: unknown; strike?: boolean; name?: string; size?: number; color?: { argb?: string } };
  fill?: { type?: string; pattern?: string; fgColor?: { argb?: string } };
  alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean };
};

function fromExcelCell(cell: ExcelCell): FortuneCell | null {
  const raw = cell.value as unknown;
  const out: FortuneCell = {};
  let value: unknown = raw;
  if (raw && typeof raw === "object" && !(raw instanceof Date)) {
    const object = raw as { formula?: string; sharedFormula?: string; result?: unknown; richText?: { text: string }[]; text?: string; hyperlink?: string; error?: string };
    if (object.formula || object.sharedFormula) {
      out.f = `=${object.formula ?? object.sharedFormula}`;
      value = object.result;
      if (value && typeof value === "object" && "error" in (value as object)) value = (value as { error: string }).error;
    } else if (object.richText) value = object.richText.map((part) => part.text).join("");
    else if (object.text !== undefined) value = object.text;
    else if (object.error) value = object.error;
  }
  const format = cell.numFmt && cell.numFmt !== "General" ? forFortune(cell.numFmt) : undefined;
  if (value instanceof Date) {
    const fa = format ?? "dd\\.mm\\.yyyy";
    out.v = toSerial(value);
    out.ct = { fa, t: "d" };
    out.m = shown(fa, out.v);
  } else if (typeof value === "number") {
    const fa = format ?? "General";
    out.v = value;
    out.ct = { fa, t: "n" };
    out.m = shown(fa, value);
  } else if (typeof value === "boolean") {
    out.v = value;
    out.ct = { fa: "General", t: "b" };
    out.m = value ? "TRUE" : "FALSE";
  } else if (value !== null && value !== undefined && value !== "") {
    out.v = String(value);
    out.ct = { fa: "General", t: "g" };
    out.m = String(value);
  } else if (!out.f && !cell.fill && !cell.font?.bold) return null;
  const font = cell.font;
  if (font?.bold) out.bl = 1;
  if (font?.italic) out.it = 1;
  if (font?.underline) out.un = 1;
  if (font?.strike) out.cl = 1;
  // Excel's default font (Calibri 11) is left out: the table's own default shows instead.
  if (font?.name && !(font.name === "Calibri" && (font.size ?? 11) === 11)) out.ff = font.name;
  if (font?.size && font.size !== 11) out.fs = font.size;
  const color = hex(font?.color);
  if (color && color !== "#000000") out.fc = color;
  const fill = cell.fill?.type === "pattern" && cell.fill.pattern === "solid" ? hex(cell.fill.fgColor) : undefined;
  if (fill) out.bg = fill;
  const horizontal = cell.alignment?.horizontal;
  if (horizontal) out.ht = horizontal === "center" ? 0 : horizontal === "right" ? 2 : 1;
  const vertical = cell.alignment?.vertical;
  if (vertical) out.vt = vertical === "middle" ? 0 : vertical === "top" ? 1 : 2;
  if (cell.alignment?.wrapText) out.tb = 2;
  return out;
}

// --- table → Excel file -------------------------------------------------------------------------------

export async function writeXlsx(data: SheetData): Promise<Blob> {
  const ExcelJS = await loadExcel();
  const book = new ExcelJS.Workbook();
  book.creator = "EdgeKnow";
  const used = new Set<string>();
  for (const raw of [...(data.sheets as unknown as FortuneSheet[])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    let name = String(raw.name || "Sheet").replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${used.size}`;
    used.add(name.toLowerCase());
    const range = raw.frozen?.range;
    const views =
      raw.frozen && range
        ? [{ state: "frozen" as const, xSplit: /Column|both|Both/.test(raw.frozen.type) ? range.column_focus + 1 : 0, ySplit: /Row|row|both|Both/.test(raw.frozen.type) ? range.row_focus + 1 : 0 }]
        : undefined;
    const ws = book.addWorksheet(name, views ? { views } : undefined);
    for (const [c, px] of Object.entries(raw.config?.columnlen ?? {})) ws.getColumn(Number(c) + 1).width = Math.max(1, (Number(px) - 5) / 7);
    for (const [r, px] of Object.entries(raw.config?.rowlen ?? {})) ws.getRow(Number(r) + 1).height = Number(px) * 0.75;
    for (const item of raw.celldata ?? []) {
      const cellData = item.v;
      if (!cellData) continue;
      const cell = ws.getCell(item.r + 1, item.c + 1);
      const fa = cellData.ct?.fa && cellData.ct.fa !== "General" ? cellData.ct.fa : undefined;
      if (cellData.f) {
        cell.value = { formula: cellData.f.replace(/^=/, ""), result: cellData.v as never } as never;
      } else if (cellData.ct?.t === "inlineStr") {
        cell.value = textOf(cellData);
      } else if (typeof cellData.v === "number" || ((cellData.ct?.t === "n" || cellData.ct?.t === "d") && cellData.v !== "" && !Number.isNaN(Number(cellData.v)))) {
        cell.value = Number(cellData.v);
      } else if (typeof cellData.v === "boolean") {
        cell.value = cellData.v;
      } else if (cellData.v !== undefined && cellData.v !== null) {
        cell.value = String(cellData.v);
      }
      if (fa) cell.numFmt = fa;
      const font: Record<string, unknown> = {};
      if (cellData.bl) font.bold = true;
      if (cellData.it) font.italic = true;
      if (cellData.un) font.underline = true;
      if (cellData.cl) font.strike = true;
      if (typeof cellData.ff === "string") font.name = cellData.ff;
      if (cellData.fs) font.size = Number(cellData.fs);
      const fc = argb(cellData.fc);
      if (fc) font.color = { argb: fc };
      if (Object.keys(font).length) cell.font = font as never;
      const bg = argb(cellData.bg);
      if (bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      const alignment: Record<string, unknown> = {};
      const ht = Number(cellData.ht);
      if (cellData.ht !== undefined) alignment.horizontal = ht === 0 ? "center" : ht === 2 ? "right" : "left";
      const vt = Number(cellData.vt);
      if (cellData.vt !== undefined) alignment.vertical = vt === 0 ? "middle" : vt === 1 ? "top" : "bottom";
      if (String(cellData.tb) === "2") alignment.wrapText = true;
      if (Object.keys(alignment).length) cell.alignment = alignment as never;
    }
    for (const block of Object.values(raw.config?.merge ?? {})) {
      if (block.rs > 1 || block.cs > 1) ws.mergeCells(block.r + 1, block.c + 1, block.r + block.rs, block.c + block.cs);
    }
  }
  const buffer = await book.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// --- CSV ---------------------------------------------------------------------------------------------

// The delimiter Excel would have used: the one most common in the first lines (, ; or tab).
function guessDelimiter(text: string) {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts = [",", ";", "\t"].map((d) => [d, head.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const delimiter = guessDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// A CSV becomes one sheet; numbers (with . or , as decimal mark) become numbers.
export function csvToSheet(text: string, name: string): { data: SheetData; cut: boolean } {
  const rows = parseCsv(text);
  const cut = rows.length > MAX_ROWS || rows.some((r) => r.length > MAX_COLUMNS);
  const celldata: NonNullable<FortuneSheet["celldata"]> = [];
  let width = 0;
  rows.slice(0, MAX_ROWS).forEach((row, r) => {
    row.slice(0, MAX_COLUMNS).forEach((value, c) => {
      if (value === "") return;
      width = Math.max(width, c + 1);
      const normal = value.trim().replace(/\s/g, "").replace(/^(-?\d+),(\d+)$/, "$1.$2");
      const number = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(normal) ? Number(normal) : null;
      celldata.push({ r, c, v: number !== null ? { v: number, m: value.trim(), ct: { fa: "General", t: "n" } } : value.startsWith("=") ? { f: value, v: "", m: "" } : { v: value, m: value, ct: { fa: "General", t: "g" } } });
    });
  });
  const sheet: FortuneSheet = { name: name.slice(0, 31) || "Sheet1", order: 0, status: 1, row: Math.min(MAX_ROWS, Math.max(100, rows.length + 20)), column: Math.min(MAX_COLUMNS, Math.max(26, width + 5)), celldata, config: {} };
  return { data: { sheets: [sheet] as unknown as SheetData["sheets"] }, cut };
}

// One sheet as CSV, the way Excel saves it: shown values, commas, UTF-8 with a mark Excel recognises.
export function sheetToCsv(sheet: Record<string, unknown>): Blob {
  const cells = ((sheet as FortuneSheet).celldata ?? []).filter((d) => d.v);
  const height = Math.max(0, ...cells.map((d) => d.r + 1));
  const width = Math.max(0, ...cells.map((d) => d.c + 1));
  const grid: string[][] = Array.from({ length: height }, () => Array(width).fill(""));
  for (const d of cells) grid[d.r][d.c] = textOf(d.v!);
  const quote = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return new Blob(["﻿" + grid.map((row) => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
