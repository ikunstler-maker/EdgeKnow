"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import { personLabel, type Person } from "@/lib/tasks";
import { prepareImage } from "@/lib/image-compression";
import { deleteTaskFile } from "@/app/task-file-actions";
import { addTaskWebLink, deleteTaskWebLink } from "@/app/task-actions";
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

export type TaskWebLink = { id: string; title: string; url: string; added_by: string | null };

// The kinds files are filtered by, told from the type or, failing that, the name.
export const FILE_KINDS = ["image", "video", "audio", "text", "archive", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
const KIND_ICON: Record<FileKind, IconName> = { image: "image", video: "play", audio: "play", text: "file-text", archive: "folder", other: "file" };
export function kindOf(mime: string, name: string): FileKind {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff", "heic", "psd"].includes(extension)) return "image";
  if (mime.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm"].includes(extension)) return "video";
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac"].includes(extension)) return "audio";
  if (/zip|rar|7z|tar|gzip|compressed/.test(mime) || ["zip", "rar", "7z", "tar", "gz"].includes(extension)) return "archive";
  if (mime.startsWith("text/") || mime === "application/pdf" || /word|document|sheet|excel|presentation|powerpoint|msword/.test(mime) || ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "md", "rtf"].includes(extension)) return "text";
  return "other";
}
const LIST_ROWS = 8;
const VIEW_KEY = "ek.task-files.view";
const fieldClass = "min-h-11 rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";

// The files of a task: attach (button or drop), open, download, remove.
export function TaskFiles({
  shortId,
  taskId,
  files,
  links = [],
  limits = { fileMb: 4, zipMb: 4 },
  members,
  me,
  canEdit,
  canDeleteOwn = true,
  canDeleteAny,
}: {
  shortId: string;
  taskId: string;
  files: TaskFileView[];
  links?: TaskWebLink[];
  // The project's largest attachment and largest ZIP archive, in MB (4: the usual limit).
  limits?: { fileMb: number; zipMb: number };
  members: Person[];
  me: string;
  // May add files and links; may remove one's own; may remove anyone's (absent: as adding).
  canEdit: boolean;
  canDeleteOwn?: boolean;
  canDeleteAny?: boolean;
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
  const removable = (by: string | null) => (by === me ? canDeleteOwn : (canDeleteAny ?? canEdit));
  const [view, setView] = useState<"tiles" | "list">("tiles");
  const [kind, setKind] = useState<FileKind | "all">("all");
  const [open, setOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  // How the files are shown is remembered in this browser.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this browser after the first render
      if (localStorage.getItem(VIEW_KEY) === "list") setView("list");
    } catch {}
  }, []);
  const pickView = (value: "tiles" | "list") => {
    setView(value);
    try {
      localStorage.setItem(VIEW_KEY, value);
    } catch {}
  };
  const kinds = FILE_KINDS.filter((value) => files.some((file) => kindOf(file.mime_type, file.name) === value));
  const shown = kind === "all" ? files : files.filter((file) => kindOf(file.mime_type, file.name) === kind);
  const previews = (file: TaskFileView) => ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mime_type) && file.bytes <= 20 * 1024 * 1024;
  const actions = (file: TaskFileView, onTile: boolean) => {
    const button = `flex items-center justify-center rounded ${onTile ? "h-8 w-8 bg-background/90 shadow-sm" : "min-h-11 min-w-11 md:min-h-9 md:min-w-9"}`;
    return (
      <>
        {!guest && (
          <a href={href(file.id, true)} aria-label={`${f.download}: ${file.name}`} className={`${button} hover:bg-surface`}>
            <Icon name="download" />
          </a>
        )}
        {removable(file.uploaded_by) && (
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
            className={`${button} text-muted hover:bg-surface hover:text-danger`}
          >
            <Icon name="close" />
          </button>
        )}
      </>
    );
  };
  const href = (id: string, download = false) => `/api/tasks/files/${id}?ws=${shortId}${download ? "&download" : ""}`;

  // Sends a large file part by part; returns the error's name, or null when it is all there.
  async function uploadLarge(body: Blob, name: string, type: string): Promise<string | null> {
    const query = `ws=${shortId}&task=${taskId}&name=${encodeURIComponent(name)}&size=${body.size}&type=${encodeURIComponent(type || "application/octet-stream")}`;
    const begun = (await fetch(`/api/tasks/files/large?${query}`, { method: "POST" })
      .then((r) => r.json())
      .catch(() => null)) as { ok?: boolean; error?: string; id?: string; part?: number } | null;
    if (!begun?.ok || !begun.id || !begun.part) return begun?.error ?? "upload_failed";
    let offset = 0;
    let tries = 0;
    while (offset < body.size) {
      setBusy(`${name} · ${Math.floor((offset / body.size) * 100)}%`);
      const answer = (await fetch(`/api/tasks/files/large?ws=${shortId}&id=${begun.id}&offset=${offset}`, { method: "PUT", body: body.slice(offset, offset + begun.part) })
        .then((r) => r.json())
        .catch(() => null)) as { ok?: boolean; error?: string; done?: boolean; offset?: number } | null;
      // A part lost on the way is sent again (the server tells where it stands).
      if (!answer) {
        if (++tries > 3) return "upload_failed";
        continue;
      }
      if (!answer.ok || typeof answer.offset !== "number") return answer.error ?? "upload_failed";
      tries = 0;
      offset = answer.offset;
      if (answer.done) break;
    }
    return null;
  }

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
      // Over 4 MB: in parts to the team's Drive, where the project's limit allows it.
      if (body.size > MAX) {
        const limit = (type === "application/zip" ? limits.zipMb : limits.fileMb) * 1024 * 1024;
        if (body.size > limit) {
          setError(`${original.name}: ${f.errors.too_large}`);
          continue;
        }
        const failed = await uploadLarge(body, name, type);
        if (failed) setError(`${original.name}: ${f.errors[failed] ?? t.tasks.errors[failed] ?? t.common.unknownError}`);
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
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-muted">
          {f.heading}
          {files.length + links.length > 0 && <span className="ml-1 font-normal">· {files.length + links.length}</span>}
        </h2>
        {files.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            {kinds.length > 1 && (
              <select value={kind} onChange={(e) => setKind(e.target.value as FileKind | "all")} aria-label={f.filter} className="min-h-11 rounded-md border border-border bg-background px-2 text-xs md:min-h-8" data-task-files-filter>
                <option value="all">{f.kinds.all}</option>
                {kinds.map((value) => (
                  <option key={value} value={value}>
                    {f.kinds[value]} · {files.filter((file) => kindOf(file.mime_type, file.name) === value).length}
                  </option>
                ))}
              </select>
            )}
            {(["tiles", "list"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                aria-label={f.views[value]}
                title={f.views[value]}
                onClick={() => pickView(value)}
                className={`flex min-h-11 min-w-11 items-center justify-center rounded-md md:min-h-8 md:min-w-8 ${view === value ? "bg-surface text-foreground" : "text-muted hover:bg-surface"}`}
                data-task-files-view={value}
              >
                <Icon name={value === "tiles" ? "grid" : "list"} />
              </button>
            ))}
          </div>
        )}
      </div>
      {files.length === 0 && links.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{f.none}</p>
      ) : view === "tiles" ? (
        <ul className="mt-2 flex gap-2 overflow-x-auto pb-2" data-task-files-tiles>
          {shown.map((file) => (
            <li key={file.id} className="group relative w-32 shrink-0 overflow-hidden rounded-lg border border-border text-xs" data-task-file={file.name}>
              <a href={href(file.id)} target="_blank" rel="noreferrer" className="block" title={file.name}>
                {previews(file) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={href(file.id)} alt="" loading="lazy" className="h-24 w-full bg-surface object-cover" />
                ) : (
                  <span className="flex h-24 w-full items-center justify-center bg-surface" aria-hidden>
                    <Icon name={KIND_ICON[kindOf(file.mime_type, file.name)]} size={28} className="text-muted" />
                  </span>
                )}
                <span className="block truncate px-2 pt-1.5">{file.name}</span>
                <span className="block truncate px-2 pb-1.5 text-muted">{formatBytes(file.bytes)}</span>
              </a>
              <span className="absolute right-1 top-1 flex gap-1 opacity-100 md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">{actions(file, true)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border" data-task-files-list>
            {(open ? shown : shown.slice(0, LIST_ROWS)).map((file) => (
              <li key={file.id} className="flex min-h-12 items-center gap-3 px-2 py-1 text-sm" data-task-file={file.name}>
                {previews(file) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={href(file.id)} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden>
                    <Icon name={KIND_ICON[kindOf(file.mime_type, file.name)]} size={18} className="text-muted" />
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
                {actions(file, false)}
              </li>
            ))}
          </ul>
          {shown.length > LIST_ROWS && (
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-1 min-h-11 text-xs text-muted hover:text-foreground hover:underline md:min-h-8" data-task-files-more>
              <Icon name={open ? "chevron-up" : "chevron-down"} className="mr-1 inline" />
              {open ? f.fewer : f.more(shown.length - LIST_ROWS)}
            </button>
          )}
        </>
      )}
      {links.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label={f.links.heading} data-task-web-links>
          {links.map((link) => (
            <li key={link.id} className="flex max-w-full items-center rounded-full border border-border pl-3 text-sm" data-task-web-link={link.title}>
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex min-h-9 min-w-0 items-center gap-1.5 hover:underline" title={link.url}>
                <Icon name="link" className="shrink-0 text-muted" />
                <span className="truncate">{link.title}</span>
              </a>
              {removable(link.added_by) ? (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={f.remove(link.title)}
                  onClick={() => {
                    if (!confirm(f.removeConfirm(link.title))) return;
                    startTransition(async () => {
                      const result = await deleteTaskWebLink(link.id);
                      setError(result.ok ? null : (t.tasks.errors[result.error] ?? t.common.unknownError));
                      router.refresh();
                    });
                  }}
                  className="flex min-h-9 min-w-9 items-center justify-center rounded-full text-muted hover:text-danger"
                >
                  <Icon name="close" size={14} />
                </button>
              ) : (
                <span className="w-3" />
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <input ref={input} type="file" multiple accept={limits.fileMb > 4 ? undefined : ACCEPT} className="hidden" onChange={(e) => e.target.files && void upload(e.target.files).then(() => (e.target.value = ""))} aria-label={f.attach} />
          <button type="button" disabled={busy !== null} onClick={() => input.current?.click()} className="min-h-11 rounded-md border border-border px-3 hover:bg-surface disabled:opacity-60 md:min-h-9">
            <Icon name="paperclip" className="mr-1 inline" />
            {f.attach}
          </button>
          <button type="button" onClick={() => setLinking(!linking)} aria-expanded={linking} className="min-h-11 rounded-md border border-border px-3 hover:bg-surface md:min-h-9" data-task-web-link-open>
            <Icon name="link" className="mr-1 inline" />
            {f.links.add}
          </button>
          <span className="text-xs text-muted">{busy ? f.uploading(busy) : limits.fileMb > 4 || limits.zipMb > 4 ? f.dropHintLarge(limits.fileMb, limits.zipMb) : f.dropHint}</span>
        </div>
      )}
      {canEdit && linking && (
        <form
          className="mt-2 flex flex-wrap gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const form = e.currentTarget;
            startTransition(async () => {
              const result = await addTaskWebLink(taskId, String(data.get("title") ?? ""), String(data.get("url") ?? ""));
              setError(result.ok ? null : (f.errors[result.error] ?? t.tasks.errors[result.error] ?? t.common.unknownError));
              if (result.ok) {
                form.reset();
                setLinking(false);
                router.refresh();
              }
            });
          }}
          data-task-web-link-form
        >
          <input name="url" type="url" required maxLength={2000} placeholder={f.links.url} aria-label={f.links.url} className={`${fieldClass} min-w-0 flex-[2] basis-56`} data-task-web-link-url />
          <input name="title" maxLength={200} placeholder={f.links.title} aria-label={f.links.title} className={`${fieldClass} min-w-0 flex-1 basis-40`} data-task-web-link-title />
          <button type="submit" disabled={pending} className="min-h-11 rounded-md bg-accent px-3 text-white disabled:opacity-60 md:min-h-9" data-task-web-link-save>
            {f.links.save}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
