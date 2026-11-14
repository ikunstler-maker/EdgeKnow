"use client";

import "@fortune-sheet/react/dist/index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Workbook, type WorkbookInstance } from "@fortune-sheet/react";
import Link from "next/link";
import { currentLocale, t } from "@/i18n";
import { formatForFormula, installSheetFunctions } from "@/lib/sheet-functions";
import { rangeOf } from "@/lib/sheet-charts";
import { toStored, type SheetData } from "@/lib/sheets";
import { fortuneUk } from "./fortune-uk";
import { cellChipOf, drawCellChip, onCellChips, rememberCellChip, type CellChip } from "./sheet-chips";
import { ChipPicker } from "./chip-picker";
import { applySpill, spillWrites } from "./sheet-spill";
import { Icon } from "@/components/ui/icon";

// The editor's own texts in Ukrainian (it ships none), read by its patched locale lookup.
if (typeof window !== "undefined") {
  (window as unknown as { __EK_SHEET_LOCALES?: Record<string, unknown> }).__EK_SHEET_LOCALES ??= { uk: fortuneUk };
  installSheetFunctions();
}

// No pivot tables, screenshots or pictures in cells in this step.
const TOOLBAR = ["undo", "redo", "format-painter", "clear-format", "|", "currency-format", "percentage-format", "number-decrease", "number-increase", "format", "|", "font", "|", "font-size", "|", "bold", "italic", "strike-through", "underline", "|", "font-color", "background", "border", "merge-cell", "|", "horizontal-align", "vertical-align", "text-wrap", "text-rotation", "|", "freeze", "conditionFormat", "filter", "link", "comment", "quick-formula", "dataVerification", "splitColumn", "locationCondition", "search"];
const CELL_MENU = ["copy", "paste", "|", "insert-row", "insert-column", "delete-row", "delete-column", "delete-cell", "hide-row", "hide-column", "set-row-height", "set-column-width", "|", "clear", "sort", "orderAZ", "orderZA", "filter", "link", "data", "cell-format"];

// A table (step Т1): Fortune-sheet (MIT) with the Excel functions it lacks
// added; every real change is reported (the screen saves it a moment later).
export default function SheetEditor({
  initial,
  editable,
  onChange,
  onSelection,
  chips,
}: {
  initial: SheetData;
  editable: boolean;
  onChange: (data: SheetData) => void;
  // The selected range (for a new chart), e.g. "Аркуш1", "A1:C6".
  onSelection?: (sheet: string, range: string) => void;
  // Chips in cells (UI-2): links to this workspace drawn with their live titles.
  chips?: { shortId: string; workspaceId: string };
}) {
  const book = useRef<WorkbookInstance>(null);
  const first = useRef(true);
  const last = useRef<string>("");
  // The editor takes its data once: a new workbook (another table, sheets added
  // from a file) opens it again under a new key. Handing it a new copy on every
  // render would make it start over each time.
  const [data] = useState(() => initial.sheets as never);
  const callbacks = useRef({ onChange, onSelection, chips, editable });
  useEffect(() => {
    callbacks.current = { onChange, onSelection, chips, editable };
  });
  // The selected cell's chip (for "Open"), and the "Insert chip" dialog.
  const [selected, setSelected] = useState<{ title: string; href: string } | null>(null);
  const [picking, setPicking] = useState(false);
  // Titles arrive after the first drawing: the table draws itself again (a resize does it
  // without touching the data).
  useEffect(() => {
    if (!chips) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onCellChips(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        window.dispatchEvent(new Event("resize"));
      }, 50);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [chips]);
  const hooks = useMemo(
    () => ({
      afterSelectionChange: (sheetId: string, selection: { row: number[]; column: number[] }) => {
        const where = callbacks.current.chips;
        if (where && selection?.row && selection?.column) {
          const value = book.current?.getCellValue(selection.row[0], selection.column[0]);
          const chip = cellChipOf(value, where.shortId, where.workspaceId);
          setSelected(chip?.state === "ok" ? { title: chip.title, href: chip.href } : null);
        }
        const notify = callbacks.current.onSelection;
        if (!notify || !selection?.row || !selection?.column) return;
        const sheet = book.current?.getAllSheets().find((one) => one.id === sheetId);
        if (sheet) notify(String(sheet.name), rangeOf(selection.row, selection.column));
      },
      // A date from =DATE(…) is shown as a date, as in Excel (the cell keeps its own format if it has one).
      afterRenderCell: (cell: { v?: unknown; m?: unknown; bg?: string } | null, info: { startX: number; startY: number; endX: number; endY: number }, ctx: CanvasRenderingContext2D) => {
        const where = callbacks.current.chips;
        if (!where || !cell) return;
        const chip = cellChipOf(cell.v ?? cell.m, where.shortId, where.workspaceId);
        if (chip) drawCellChip(ctx, info, chip, cell.bg || "#ffffff");
      },
      afterUpdateCell: (row: number, column: number, _old: unknown, cell: { f?: string; ct?: { fa?: string } } | null) => {
        const format = cell?.f ? formatForFormula(cell.f) : null;
        if (format && (!cell?.ct?.fa || cell.ct.fa === "General")) setTimeout(() => book.current?.setCellFormat(row, column, "ct", format), 0);
      },
    }),
    [],
  );
  const handleChange = useMemo(
    () => (sheets: Record<string, unknown>[]) => {
      const stored = toStored(sheets);
      const key = JSON.stringify(stored);
      // The first call is the workbook as loaded.
      if (first.current) {
        first.current = false;
        last.current = key;
        return;
      }
      if (key === last.current) return;
      last.current = key;
      callbacks.current.onChange(stored);
      // Tables a formula gives fill the cells next to it (SOTA-1); the writes come back here
      // once more and then find nothing left to do.
      if (callbacks.current.editable)
        // A moment later: a person's own value typed over a spilled cell is theirs by then.
        setTimeout(() => {
          const data = (book.current?.getSheet() as { data?: unknown[][] } | undefined)?.data;
          const writes = data ? spillWrites(data as never) : [];
          if (writes.length && book.current) applySpill(book.current, writes);
        }, 0);
    },
    [],
  );
  const insertChip = (path: string, chip: CellChip) => {
    const where = chips;
    const range = book.current?.getSelection()?.[0];
    setPicking(false);
    if (!where || !range) return;
    const url = `${window.location.origin}${path}`;
    rememberCellChip(url, where.shortId, chip);
    book.current?.setCellValue(range.row[0], range.column[0], url);
  };
  return (
    <div className="flex h-full w-full flex-col" data-sheet-editor>
      {chips && (editable || selected) && (
        <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-2 text-sm text-foreground md:min-h-8" data-sheet-chip-bar>
          {editable && (
            <button type="button" onClick={() => setPicking(true)} title={t.sheets.chips.insertHint} className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 hover:bg-surface md:min-h-7" data-sheet-insert-chip>
              <Icon name="plus" size={14} />
              {t.sheets.chips.insert}
            </button>
          )}
          {selected && (
            <Link href={selected.href} prefetch={false} className="inline-flex min-h-11 min-w-0 items-center gap-1 truncate rounded-md px-2 text-accent hover:bg-surface md:min-h-7" data-sheet-open-chip>
              <span className="truncate">{t.sheets.chips.open(selected.title)}</span>
            </Link>
          )}
        </div>
      )}
      {picking && <ChipPicker onClose={() => setPicking(false)} onPick={(picked) => insertChip(picked.path, { state: "ok", service: picked.service, title: picked.title, href: picked.path })} />}
      <div className="min-h-0 flex-1">
      <Workbook
        ref={book}
        data={data}
        hooks={hooks}
        lang={currentLocale() === "en" ? "en" : "uk"}
        currency={currentLocale() === "en" ? "$" : "₴"}
        allowEdit={editable}
        showToolbar={editable}
        toolbarItems={TOOLBAR}
        cellContextMenu={CELL_MENU}
        onChange={editable ? handleChange : undefined}
      />
      </div>
    </div>
  );
}
