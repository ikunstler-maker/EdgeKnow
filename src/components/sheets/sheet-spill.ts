"use client";

import type { WorkbookInstance } from "@fortune-sheet/react";

// Spilling (SOTA-1): a formula whose result is a table (FILTER, SORT, UNIQUE, SEQUENCE, MAP…)
// fills the cells below and to the right of it, as Excel's dynamic arrays do. The engine keeps
// the whole result in the formula's cell; here it is laid out into the neighbours, which are
// marked `ekSpill: "<row>,<column>"` of their formula. They follow every change of the result;
// where a neighbour already holds something of its own, nothing is written and the formula's
// cell shows #SPILL!, as in Excel.

type Cell = { v?: unknown; m?: unknown; f?: string; ekSpill?: string } | null | undefined;
type Write = { r: number; c: number; value: unknown; owner: string } | { r: number; c: number; clear: true } | { r: number; c: number; shown: string };

// What the spill itself last put in each cell: a different value there now was typed by a person.
const written = new Map<string, unknown>();
const plain = (value: unknown) => (value instanceof Error ? value.message : value);

const isEmpty = (cell: Cell) => !cell || ((cell.v === null || cell.v === undefined || cell.v === "") && !cell.f);
const shown = (value: unknown) => (value === null || value === undefined ? "" : value instanceof Error ? value.message : String(value));

export function spillWrites(data: Cell[][]): Write[] {
  const writes: Write[] = [];
  const wanted = new Map<string, unknown>(); // "r,c" → value of a spilled cell
  const owner = new Map<string, string>(); // "r,c" → its formula's key
  data.forEach((row, r) =>
    row?.forEach((cell, c) => {
      if (!cell?.f || !Array.isArray(cell.v)) return;
      const grid = (Array.isArray(cell.v[0]) ? cell.v : [cell.v]) as unknown[][];
      const key = `${r},${c}`;
      if (grid.length * (grid[0]?.length ?? 0) <= 1) return;
      const targets: [number, number, unknown][] = [];
      grid.forEach((line, i) => line.forEach((value, j) => (i || j) && targets.push([r + i, c + j, value])));
      const blocked = targets.some(([tr, tc]) => {
        const there = data[tr]?.[tc];
        if (isEmpty(there)) return false;
        if (there?.ekSpill !== key) return true;
        const at = `${tr},${tc}`;
        // A spilled cell from before this page was opened counts as the spill's own.
        if (!written.has(at)) written.set(at, there?.v);
        return written.get(at) !== there?.v;
      });
      const first = shown(grid[0]?.[0]);
      if (blocked) {
        if (cell.m !== "#SPILL!") writes.push({ r, c, shown: "#SPILL!" });
        return;
      }
      if (cell.m !== first) writes.push({ r, c, shown: first });
      for (const [tr, tc, value] of targets) {
        wanted.set(`${tr},${tc}`, value);
        owner.set(`${tr},${tc}`, key);
      }
    }),
  );
  // Spilled cells: written where they differ; ones no longer wanted are cleared.
  data.forEach((row, r) =>
    row?.forEach((cell, c) => {
      if (!cell?.ekSpill) return;
      const at = `${r},${c}`;
      // A person's own value in a cell that used to be spilled stays.
      if (written.has(at) && written.get(at) !== cell.v) return;
      if (!wanted.has(at) || owner.get(at) !== cell.ekSpill) writes.push({ r, c, clear: true });
    }),
  );
  for (const [at, value] of wanted) {
    const [r, c] = at.split(",").map(Number);
    const cell = data[r]?.[c];
    if (cell?.ekSpill === owner.get(at) && cell?.v === plain(value)) continue;
    writes.push({ r, c, value, owner: owner.get(at)! });
  }
  return writes;
}

// True while the spill's own writes go in (the editor's "a cell changed" hook ignores them).
export let spilling = false;

export function applySpill(book: WorkbookInstance, writes: Write[]) {
  spilling = true;
  try {
    applyAll(book, writes);
  } finally {
    spilling = false;
  }
}

function applyAll(book: WorkbookInstance, writes: Write[]) {
  for (const w of writes) {
    if ("shown" in w) book.setCellFormat(w.r, w.c, "m" as never, w.shown as never);
    else if ("clear" in w) {
      written.delete(`${w.r},${w.c}`);
      book.clearCell(w.r, w.c);
    } else {
      const value = plain(w.value);
      written.set(`${w.r},${w.c}`, value);
      book.setCellValue(w.r, w.c, value as never);
      book.setCellFormat(w.r, w.c, "ekSpill" as never, w.owner as never);
    }
  }
}
