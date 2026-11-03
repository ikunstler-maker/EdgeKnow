"use client";

import "@fortune-sheet/react/dist/index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Workbook, type WorkbookInstance } from "@fortune-sheet/react";
import { currentLocale } from "@/i18n";
import { formatForFormula, installSheetFunctions } from "@/lib/sheet-functions";
import { rangeOf } from "@/lib/sheet-charts";
import { toStored, type SheetData } from "@/lib/sheets";
import { fortuneUk } from "./fortune-uk";

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
}: {
  initial: SheetData;
  editable: boolean;
  onChange: (data: SheetData) => void;
  // The selected range (for a new chart), e.g. "Аркуш1", "A1:C6".
  onSelection?: (sheet: string, range: string) => void;
}) {
  const book = useRef<WorkbookInstance>(null);
  const first = useRef(true);
  const last = useRef<string>("");
  // The editor takes its data once: a new workbook (another table, sheets added
  // from a file) opens it again under a new key. Handing it a new copy on every
  // render would make it start over each time.
  const [data] = useState(() => initial.sheets as never);
  const callbacks = useRef({ onChange, onSelection });
  useEffect(() => {
    callbacks.current = { onChange, onSelection };
  });
  const hooks = useMemo(
    () => ({
      afterSelectionChange: (sheetId: string, selection: { row: number[]; column: number[] }) => {
        const notify = callbacks.current.onSelection;
        if (!notify || !selection?.row || !selection?.column) return;
        const sheet = book.current?.getAllSheets().find((one) => one.id === sheetId);
        if (sheet) notify(String(sheet.name), rangeOf(selection.row, selection.column));
      },
      // A date from =DATE(…) is shown as a date, as in Excel (the cell keeps its own format if it has one).
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
    },
    [],
  );
  return (
    <div className="h-full w-full" data-sheet-editor>
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
  );
}
