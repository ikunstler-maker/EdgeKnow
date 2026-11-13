"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { readWorkbook, type SheetData } from "@/lib/sheets";
import { workspacePath } from "@/lib/paths";
import type { Person } from "@/lib/tasks";
import { ObjectAccessButton, type ObjectAccess } from "@/components/access/object-access";
import { saveSheet, setSheetGroupRole, setSheetMemberRole, setSheetWorkspaceRole, trashSheet } from "@/app/sheet-actions";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { ACCEPT, readSheetFile } from "./sheet-files";
import { SheetCharts } from "./sheet-charts";
import type { SheetChart } from "@/lib/sheet-charts";
import { StudioNotices, StudioShell } from "@/components/ui/studio-shell";
import { buttonClass } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

const SheetEditor = dynamic(() => import("./sheet-editor"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">{t.sheets.loading}</p> });

const s = t.sheets;

// One table: its name, the save status, access and the editor. Changes are saved
// about a second after the last one; a save that finds a newer version stops and
// says so (working together live comes later, with the boards' step Д2).
export function SheetScreen({
  shortId,
  id,
  initialTitle,
  initialData,
  initialVersion,
  role,
  access,
  members,
}: {
  shortId: string;
  id: string;
  initialTitle: string;
  initialData: unknown;
  initialVersion: number;
  role: string;
  access: ObjectAccess | null;
  members: Person[];
}) {
  const router = useRouter();
  const canEdit = role === "owner" || role === "editor";
  const [title, setTitle] = useState(initialTitle);
  const [initial, setInitial] = useState(() => readWorkbook(initialData, s.firstSheet));
  // The editor opens again on new data (sheets added from a file).
  const [round, setRound] = useState(0);
  const latest = useRef<SheetData>(initial);
  // Charts (step Т3) live beside the sheets and are saved with them.
  const [charts, setCharts] = useState<SheetChart[]>(() => initial.charts ?? []);
  const [liveSheets, setLiveSheets] = useState(initial.sheets);
  const [selection, setSelection] = useState<{ sheet: string; range: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Charts sit in a panel beside the sheet: open when the table has any, or when one is being made.
  const [chartsOpen, setChartsOpen] = useState(() => (initial.charts ?? []).length > 0);
  const [newChart, setNewChart] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // A guest doesn't take the table away as a file.
  const pagesContext = useOptionalPages();
  const canExport = pagesContext?.workspace.role !== "guest";
  const chips = useMemo(() => (pagesContext ? { shortId: pagesContext.workspace.shortId, workspaceId: pagesContext.workspace.id } : undefined), [pagesContext]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("cut") === "1") setTimeout(() => setNotice(s.files.cut), 0);
  }, []);

  const exportAs = async (kind: "xlsx" | "csv") => {
    const io = await import("@/lib/sheet-io");
    const name = (title || s.untitled).replace(/[\\/:*?"<>|]/g, " ").trim() || "table";
    if (kind === "xlsx") return io.download(await io.writeXlsx(latest.current), `${name}.xlsx`);
    const sheets = latest.current.sheets as { status?: number }[];
    const current = sheets.find((sheet) => sheet.status === 1) ?? sheets[0];
    io.download(io.sheetToCsv(current as Record<string, unknown>), `${name}.csv`);
  };

  const addSheets = async (file: File) => {
    setNotice(s.files.reading);
    const read = await readSheetFile(file);
    if ("error" in read) return setNotice(read.error);
    const have = latest.current.sheets as { name?: string; order?: number }[];
    const names = new Set(have.map((sheet) => String(sheet.name).toLowerCase()));
    const added = (read.data.sheets as { name?: string }[]).map((sheet, i) => {
      let name = String(sheet.name || s.firstSheet);
      for (let n = 2; names.has(name.toLowerCase()); n++) name = `${String(sheet.name).slice(0, 27)} (${n})`;
      names.add(name.toLowerCase());
      return { ...sheet, name, order: have.length + i, status: 0 };
    });
    const next = { sheets: [...have, ...added], charts } as SheetData;
    latest.current = next;
    setInitial(next);
    setLiveSheets(next.sheets);
    setRound((n) => n + 1);
    schedule({ data: next });
    setNotice(`${s.files.added(added.length)}${read.cut ? ` ${s.files.cut}` : ""}`);
  };
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "conflict" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const version = useRef(initialVersion);
  const pending = useRef<{ title: string | null; data: SheetData | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  const flush = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    while (pending.current) {
      const next = pending.current;
      pending.current = null;
      setStatus("saving");
      const result = await saveSheet(shortId, id, next.title, next.data, version.current).catch(() => null);
      if (result?.ok) {
        version.current = result.version;
        setStatus("saved");
        setError(null);
        continue;
      }
      if (result && !result.ok && result.error === "conflict") {
        setStatus("conflict");
        break;
      }
      const later = pending.current as { title: string | null; data: SheetData | null } | null;
      pending.current = { title: later?.title ?? next.title, data: later?.data ?? next.data };
      setStatus("error");
      setError(result && !result.ok ? (s.errors[result.error] ?? t.common.unknownError) : t.common.unknownError);
      break;
    }
    saving.current = false;
  }, [shortId, id]);

  const schedule = useCallback(
    (patch: { title?: string; data?: SheetData }) => {
      if (!canEdit || status === "conflict") return;
      pending.current = { title: patch.title ?? pending.current?.title ?? null, data: patch.data ?? pending.current?.data ?? null };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 900);
    },
    [canEdit, status, flush],
  );

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (pending.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const editable = canEdit && status !== "conflict";
  return (
    <StudioShell
      service="sheets"
      backHref={workspacePath(shortId, "/sheets")}
      backLabel={s.back}
      title={title}
      onTitle={
        canEdit
          ? (value) => {
              setTitle(value);
              schedule({ title: value });
            }
          : undefined
      }
      titleLabel={s.titlePlaceholder}
      untitled={s.untitled}
      status={status}
      savingLabel={s.saving}
      savedLabel={s.saved}
      center={
        (charts.length > 0 || editable) && (
          <button type="button" onClick={() => setChartsOpen(!chartsOpen)} aria-pressed={chartsOpen} className={buttonClass(chartsOpen ? "subtle" : "ghost")} data-charts-toggle>
            <Icon name="chart" />
            {s.charts.heading}
            {charts.length > 0 && <span className="text-xs text-muted">{charts.length}</span>}
          </button>
        )
      }
      files={[
        ...(canExport
          ? [
              { label: s.files.saveXlsx, hint: s.files.saveXlsxHint, icon: "download" as const, onSelect: () => void exportAs("xlsx"), attrs: { "data-export": "xlsx" } },
              { label: s.files.saveCsv, hint: s.files.saveCsvHint, icon: "download" as const, onSelect: () => void exportAs("csv"), attrs: { "data-export": "csv" } },
            ]
          : []),
        ...(editable ? [{ label: s.files.addSheets, icon: "upload" as const, onSelect: () => fileInput.current?.click(), attrs: { "data-import": "sheets" } }] : []),
      ]}
      access={
        access && (
          <ObjectAccessButton
            label={s.access}
            title={s.accessTitle}
            intro={s.accessIntro}
            access={access}
            members={members}
            actions={{
              setWorkspaceRole: (r) => setSheetWorkspaceRole(shortId, id, r),
              setMemberRole: (member, r) => setSheetMemberRole(shortId, id, member, r),
              setGroupRole: (group, r) => setSheetGroupRole(shortId, id, group, r),
            }}
          />
        )
      }
      primary={
        editable
          ? {
              label: s.charts.add,
              hint: s.charts.addHint,
              icon: "chart",
              onSelect: () => {
                setChartsOpen(true);
                setNewChart(true);
              },
              attrs: { "data-new-chart": "" },
            }
          : undefined
      }
      more={
        canEdit
          ? [
              {
                label: s.toBin,
                icon: "trash",
                danger: true,
                onSelect: async () => {
                  await trashSheet(shortId, id);
                  router.push(workspacePath(shortId, "/sheets"));
                },
                attrs: { "data-to-bin": "" },
              },
            ]
          : []
      }
      notices={
        <>
          {notice && (
            <p role="status" className="text-muted" data-sheet-notice>
              {notice}
            </p>
          )}
          <StudioNotices readOnly={canEdit ? null : s.readOnly} conflict={status === "conflict" ? s.conflict : null} reloadLabel={s.reload} error={status === "error" ? error : null} />
        </>
      }
    >
      {/* The file picker lives outside the menu, so it is still there when the menu has closed. */}
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label={s.files.addSheets}
        data-add-sheet-file
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void addSheets(file);
        }}
      />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden bg-white text-black" data-sheet>
          <SheetEditor
            key={round}
            initial={initial}
            editable={editable}
            chips={chips}
            onChange={(data) => {
              latest.current = { ...data, charts };
              setLiveSheets(data.sheets);
              schedule({ data: latest.current });
            }}
            onSelection={(sheet, range) => setSelection((now) => (now?.sheet === sheet && now.range === range ? now : { sheet, range }))}
          />
        </div>
        {chartsOpen && (
          <aside className="absolute inset-y-0 right-0 z-10 w-[min(24rem,100%)] overflow-y-auto border-l border-border bg-background p-3 shadow-xl lg:static lg:shadow-none" data-charts-panel>
            <SheetCharts
              charts={charts}
              sheets={liveSheets}
              selection={selection}
              canEdit={editable}
              startNew={newChart}
              onStarted={() => setNewChart(false)}
              onClose={() => setChartsOpen(false)}
              onCharts={(next) => {
                setCharts(next);
                latest.current = { ...latest.current, charts: next };
                schedule({ data: latest.current });
              }}
            />
          </aside>
        )}
      </div>
    </StudioShell>
  );
}
