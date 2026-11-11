"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import { personLabel, type Person } from "@/lib/tasks";
import { prepareImage } from "@/lib/image-compression";
import { deleteTaskFile } from "@/app/task-file-actions";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { Icon, type IconName } from "@/components/ui/icon";

export type TaskFileView = { id: string; name: string; mime_type: string; bytes: number; uploaded_by: string | null; created_at: string };

const f = t.tasks.files;
const MAX = 4 * 1024 * 1024;
const ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,application/zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip";
// Browsers don't always know Office types; the extension tells.
const BY_EXTENSION: Record<string, string> = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
  pdf: "application/pdf",
};
const typeOf = (file: File) => {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[extension] ?? (file.type === "application/x-zip-compressed" ? "application/zip" : file.type);
};
const iconOf = (type: string): IconName => (type.startsWith("image/") ? "image" : type.includes("sheet") || type.includes("excel") || type === "text/csv" ? "table" : type.includes("presentation") || type.includes("powerpoint") ? "play" : type === "application/zip" ? "folder" : type === "application/pdf" ? "file" : "file-text");

// The files of a task: attach (button or drop), open, download, remove.
export function TaskFiles({
  shortId,
  taskId,
  files,
  members,
  me,
  canEdit,
}: {
  shortId: string;
  taskId: string;
  files: TaskFileView[];
  members: Person[];
  me: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  // A guest views files but gets no download button.
  const guest = useOptionalPages()?.workspace.role === "guest";
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const personOf = new Map(members.map((m) => [m.id, m]));
  const href = (id: string, download = false) => `/api/tasks/files/${id}?ws=${shortId}${download ? "&download" : ""}`;

  async function upload(list: FileList | File[]) {
    setError(null);
    for (const original of Array.from(list)) {
      setBusy(original.name);
      let body: Blob = original;
      let type = typeOf(original);
      let name = original.name;
      // Big photos are made smaller first, like in the wiki.
      if (original.size > 1.5 * 1024 * 1024 && /^image\/(png|jpeg|webp)$/.test(type)) {
        try {
          const prepared = await prepareImage(original, "fullhd");
          body = prepared.blob;
          type = prepared.type;
          name = name.replace(/\.[^.]+$/, "") + (type === "image/webp" ? ".webp" : ".jpg");
        } catch {
          // Sent as it is; the size check below still applies.
        }
      }
      if (body.size > MAX) {
        setError(`${original.name}: ${f.errors.too_large}`);
        continue;
      }
      const response = await fetch(`/api/tasks/files?ws=${shortId}&task=${taskId}&name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": type || "application/octet-stream" },
        body,
      }).catch(() => null);
      const result = (await response?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!result?.ok) {
        setError(`${original.name}: ${f.errors[result?.error ?? ""] ?? t.tasks.errors[result?.error ?? ""] ?? t.common.unknownError}`);
      }
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <section
      className={`mt-6 rounded-lg ${over ? "outline-2 outline-dashed outline-accent" : ""}`}
      aria-label={f.heading}
      data-task-files
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!canEdit || !e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <h2 className="text-sm font-medium text-muted">{f.heading}</h2>
      {files.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{f.none}</p>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {files.map((file) => (
            <li key={file.id} className="flex min-h-14 items-center gap-3 rounded-lg border border-border p-2 text-sm" data-task-file={file.name}>
              {file.mime_type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={href(file.id)} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center text-xl" aria-hidden>
                  <Icon name={iconOf(file.mime_type)} size={18} className="text-muted" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <a href={href(file.id)} target="_blank" rel="noreferrer" className="block truncate hover:underline">
                  {file.name}
                </a>
                <p className="truncate text-xs text-muted">
                  {formatBytes(file.bytes)} · {f.byOn(personLabel(personOf.get(file.uploaded_by ?? "")) || t.tasks.someone, new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(new Date(file.created_at)))}
                </p>
              </div>
              {!guest && (
                <a href={href(file.id, true)} aria-label={`${f.download}: ${file.name}`} className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-surface md:min-h-9 md:min-w-9">
                  <Icon name="download" />
                </a>
              )}
              {(canEdit || file.uploaded_by === me) && (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={f.remove(file.name)}
                  onClick={() => {
                    if (!confirm(f.removeConfirm(file.name))) return;
                    startTransition(async () => {
                      const result = await deleteTaskFile(file.id);
                      setError(result.ok ? null : (t.tasks.errors[result.error] ?? t.common.unknownError));
                      router.refresh();
                    });
                  }}
                  className="min-h-11 min-w-11 rounded text-muted hover:bg-surface hover:text-danger md:min-h-9 md:min-w-9"
                >
                  <Icon name="close" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && void upload(e.target.files).then(() => (e.target.value = ""))} aria-label={f.attach} />
          <button type="button" disabled={busy !== null} onClick={() => input.current?.click()} className="min-h-11 rounded-md border border-border px-3 hover:bg-surface disabled:opacity-60 md:min-h-9">
            <Icon name="paperclip" className="mr-1 inline" />
            {f.attach}
          </button>
          <span className="text-xs text-muted">{busy ? f.uploading(busy) : f.dropHint}</span>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
