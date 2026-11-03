// Tables (step Т1): what is stored of a workbook — its sheets as the editor
// (Fortune-sheet) keeps them: name, order, cells (celldata), sizes, merges,
// formats, frozen panes, filters and conditional formats.

export type SheetData = { sheets: Record<string, unknown>[] };

export const newSheet = (name: string) => ({ name, order: 0, row: 100, column: 26, celldata: [], config: {}, status: 1 });

export const emptyWorkbook = (name: string): SheetData => ({ sheets: [newSheet(name)] });

// Only well-formed sheets survive (a broken save never breaks the editor).
export function readWorkbook(data: unknown, name: string): SheetData {
  const list = Array.isArray((data as SheetData | null)?.sheets) ? (data as SheetData).sheets.filter((s) => s && typeof s === "object") : [];
  return list.length ? { sheets: list } : emptyWorkbook(name);
}

// What is kept of a sheet: the editor's working copy also holds the whole grid
// ("data"), which is rebuilt from celldata when the table opens.
export function toStored(sheets: Record<string, unknown>[]): SheetData {
  return {
    sheets: sheets.map((sheet) => {
      const { data, ...rest } = sheet as { data?: unknown[][] } & Record<string, unknown>;
      if (!Array.isArray(data)) return rest;
      const celldata: { r: number; c: number; v: unknown }[] = [];
      data.forEach((row, r) => row?.forEach((cell, c) => cell !== null && cell !== undefined && celldata.push({ r, c, v: cell })));
      return { ...rest, celldata };
    }),
  };
}
