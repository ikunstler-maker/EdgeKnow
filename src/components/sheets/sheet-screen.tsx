"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { readWorkbook, type SheetData } from "@/lib/sheets";
import { workspacePath } from "@/lib/paths";
import type { Person } from "@/lib/tasks";
import { ObjectAccessButton, type ObjectAccess } from "@/components/access/object-access";
import { saveSheet, setSheetGroupRole, setSheetMemberRole, setSheetWorkspaceRole, trashSheet } from "@/app/sheet-actions";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { ACCEPT, readSheetFile } from "./sheet-files";

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
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A guest doesn't take the table away as a file.
  const canExport = useOptionalPages()?.workspace.role !== "guest";
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
    const next = { sheets: [...have, ...added] } as SheetData;
    latest.current = next;
    setInitial(next);
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

  return (
    <div className="mt-2 flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              schedule({ title: e.target.value });
            }}
            placeholder={s.titlePlaceholder}
            aria-label={s.titlePlaceholder}
            maxLength={200}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none"
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">{title || s.untitled}</h1>
        )}
        <span className="text-xs text-muted" role="status" data-save-status={status}>
          {status === "saving" ? s.saving : status === "saved" ? s.saved : ""}
        </span>
        {access && (
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
        )}
        {canEdit && (
          <button
            type="button"
            onClick={async () => {
              await trashSheet(shortId, id);
              router.push(workspacePath(shortId, "/sheets"));
            }}
            className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9"
          >
            🗑️ {s.toBin}
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2" data-sheet-files>
        {canExport && (
          <>
            <button type="button" title={s.files.saveXlsxHint} onClick={() => void exportAs("xlsx")} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
              {s.files.saveXlsx}
            </button>
            <button type="button" title={s.files.saveCsvHint} onClick={() => void exportAs("csv")} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
              {s.files.saveCsv}
            </button>
          </>
        )}
        {canEdit && status !== "conflict" && (
          <>
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
            <button type="button" onClick={() => fileInput.current?.click()} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
              {s.files.addSheets}
            </button>
          </>
        )}
        {notice && (
          <span role="status" className="text-sm text-muted">
            {notice}
          </span>
        )}
      </div>
      {!canEdit && <p className="mt-1 text-sm text-muted">{s.readOnly}</p>}
      {status === "conflict" && (
        <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          {s.conflict}
          <button type="button" onClick={() => window.location.reload()} className="min-h-9 rounded-md border border-border bg-background px-3">
            {s.reload}
          </button>
        </p>
      )}
      {error && status === "error" && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 h-[calc(100dvh-12rem)] min-h-[420px] overflow-hidden rounded-lg border border-border bg-white text-black" data-sheet>
        <SheetEditor
          key={round}
          initial={initial}
          editable={canEdit && status !== "conflict"}
          onChange={(data) => {
            latest.current = data;
            schedule({ data });
          }}
        />
      </div>
    </div>
  );
}
