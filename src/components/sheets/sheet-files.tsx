"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import type { SheetData } from "@/lib/sheets";
import { createSheet } from "@/app/sheet-actions";

const f = t.sheets.files;
const button = "inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";
export const ACCEPT = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

// An Excel or CSV file as a workbook (step Т2), read in the browser.
export async function readSheetFile(file: File): Promise<{ data: SheetData; cut: boolean } | { error: string }> {
  const name = file.name.replace(/\.[^.]+$/, "");
  const io = await import("@/lib/sheet-io");
  try {
    if (/\.xlsx$/i.test(file.name)) return await io.readXlsx(await file.arrayBuffer());
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") return io.csvToSheet(await file.text(), name);
    return { error: f.unsupported };
  } catch {
    return { error: f.broken };
  }
}

// In the list of tables: a new table from a file.
export function OpenSheetFileButton({ shortId }: { shortId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label={f.open}
        data-open-sheet-file
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          setNotice(f.reading);
          const read = await readSheetFile(file);
          if ("error" in read) {
            setBusy(false);
            return setNotice(read.error);
          }
          const made = await createSheet(shortId, file.name.replace(/\.[^.]+$/, "").slice(0, 200), read.data);
          setBusy(false);
          if (!made.ok) return setNotice(t.sheets.errors[made.error] ?? t.common.unknownError);
          router.push(workspacePath(shortId, `/sheets/${made.id}${read.cut ? "?cut=1" : ""}`));
        }}
      />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={button}>
        {f.open}
      </button>
      {notice && (
        <p role="status" className="mt-2 w-full text-sm text-muted">
          {notice}
        </p>
      )}
    </>
  );
}
