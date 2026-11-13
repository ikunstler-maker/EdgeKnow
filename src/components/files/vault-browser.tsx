"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { dateLocale, t } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import { SERVICE_BRANDS } from "@/lib/services";
import { previewable, type VaultFile, type VaultKind, type VaultSource } from "@/lib/vault";
import { ServiceIcon } from "@/components/services/service-icon";
import { Dialog } from "@/components/ui/dialog";
import { Icon, type IconName } from "@/components/ui/icon";
import { Segmented } from "@/components/ui/segmented";
import { buttonClass, iconButtonClass, inputClass } from "@/components/ui/button";

type Sort = "newest" | "oldest" | "largest" | "name";
type View = "list" | "grid";
const SOURCES: VaultSource[] = ["wiki", "tasks", "chat", "boards", "nodes", "sheets", "slides", "surveys"];
const KINDS: VaultKind[] = ["image", "pdf", "video", "audio", "document", "other"];
const KIND_ICONS: Record<VaultKind, IconName> = { image: "image", pdf: "file-text", video: "play", audio: "mic", document: "file-text", other: "file" };
const VIEW_KEY = "ek_vault_view";
// Selects size to their text (inputClass stretches to the row); on a phone they share it.
const selectClass = `${inputClass.replace("w-full", "")} min-w-0 flex-1 sm:w-auto sm:flex-none`;

// The chosen view is remembered per browser.
const viewListeners = new Set<() => void>();
const readView = (): View => {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
};
const subscribeView = (onChange: () => void) => {
  viewListeners.add(onChange);
  return () => viewListeners.delete(onChange);
};
const saveView = (next: View) => {
  try {
    window.localStorage.setItem(VIEW_KEY, next);
  } catch {}
  viewListeners.forEach((notify) => notify());
};

const v = t.vault;
const nameOf = (file: VaultFile) => file.name || (file.kind === "audio" ? v.wikiAudio : v.wikiImage);
const whereOf = (file: VaultFile) => (file.where.direct ? v.direct : file.where.label || v.untitled);

// Vault (VAULT-1): the files the person can see, with search, filters, two views
// and a preview. Everything is filtered here, in the browser; nothing is written.
export function VaultBrowser({ files, limited }: { files: VaultFile[]; limited: boolean }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<VaultSource | "">("");
  const [kind, setKind] = useState<VaultKind | "">("");
  const [sort, setSort] = useState<Sort>("newest");
  const view = useSyncExternalStore(subscribeView, readView, () => "list" as View);
  const [open, setOpen] = useState<VaultFile | null>(null);


  // Only services and kinds that have files are offered.
  const sources = useMemo(() => SOURCES.filter((s) => files.some((f) => f.source === s)), [files]);
  const kinds = useMemo(() => KINDS.filter((k) => files.some((f) => f.kind === k)), [files]);

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const list = files.filter(
      (f) =>
        (!source || f.source === source) &&
        (!kind || f.kind === kind) &&
        (!needle || nameOf(f).toLocaleLowerCase().includes(needle) || whereOf(f).toLocaleLowerCase().includes(needle)),
    );
    const by: Record<Sort, (a: VaultFile, b: VaultFile) => number> = {
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
      largest: (a, b) => b.bytes - a.bytes,
      name: (a, b) => nameOf(a).localeCompare(nameOf(b), dateLocale()),
    };
    return list.sort(by[sort]);
  }, [files, query, source, kind, sort]);

  const when = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(new Date(value));
  const size = shown.reduce((sum, f) => sum + f.bytes, 0);

  if (files.length === 0) {
    return <p className="mt-5 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{v.none}</p>;
  }

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-2" data-vault-filters>
        <label className="relative min-w-0 flex-[1_1_14rem]">
          <span className="sr-only">{v.search}</span>
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted">
            <Icon name="search" size={16} />
          </span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={v.search} className={`${inputClass} w-full pl-8`} data-vault-search />
        </label>
        <select aria-label={v.service} value={source} onChange={(e) => setSource(e.target.value as VaultSource | "")} className={selectClass} data-vault-service>
          <option value="">{v.allServices}</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {SERVICE_BRANDS[s].name}
            </option>
          ))}
        </select>
        <select aria-label={v.kind} value={kind} onChange={(e) => setKind(e.target.value as VaultKind | "")} className={selectClass} data-vault-kind>
          <option value="">{v.kinds.all}</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {v.kinds[k]}
            </option>
          ))}
        </select>
        <select aria-label={v.sort} value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={selectClass} data-vault-sort>
          {(Object.keys(v.sorts) as Sort[]).map((s) => (
            <option key={s} value={s}>
              {v.sorts[s]}
            </option>
          ))}
        </select>
        <Segmented
          label={v.view}
          value={view}
          onChange={saveView}
          options={[
            { value: "list", label: v.list, icon: "list" },
            { value: "grid", label: v.grid, icon: "grid" },
          ]}
        />
      </div>
      <p className="mt-3 text-xs text-muted" data-vault-count>
        {v.count(shown.length, files.length)} · {v.total(formatBytes(size))}
      </p>

      {shown.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{v.noMatch}</p>
      ) : view === "list" ? (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" data-vault-files>
          {shown.map((file) => (
            <li key={file.key} className="flex min-h-14 items-center gap-3 px-3 py-2" data-vault-file={nameOf(file)} data-vault-source={file.source}>
              <Thumb file={file} size={44} onOpen={() => setOpen(file)} />
              <div className="min-w-0 flex-1">
                <FileName file={file} onOpen={() => setOpen(file)} />
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                  <ServiceIcon serviceId={file.source} size={14} />
                  <Link href={file.where.href} className="min-w-0 truncate hover:text-foreground hover:underline" data-vault-where>
                    {whereOf(file)}
                  </Link>
                </span>
              </div>
              <span className="hidden shrink-0 text-right text-xs text-muted sm:block">
                {formatBytes(file.bytes)}
                <br />
                {when(file.createdAt)}
              </span>
              <a href={file.download} download={file.name || undefined} className={iconButtonClass("ghost", "shrink-0")} aria-label={`${v.download}: ${nameOf(file)}`} title={v.download}>
                <Icon name="download" size={18} />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-vault-files>
          {shown.map((file) => (
            <li key={file.key} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface" data-vault-file={nameOf(file)} data-vault-source={file.source}>
              <Thumb file={file} onOpen={() => setOpen(file)} />
              <div className="min-w-0 p-2.5">
                <FileName file={file} onOpen={() => setOpen(file)} />
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                  <ServiceIcon serviceId={file.source} size={14} />
                  <Link href={file.where.href} className="min-w-0 truncate hover:text-foreground hover:underline">
                    {whereOf(file)}
                  </Link>
                </span>
                <span className="block text-xs text-muted">{formatBytes(file.bytes)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {limited && <p className="mt-3 text-xs text-muted">{v.limited}</p>}

      {open && (
        <Dialog
          title={nameOf(open)}
          width={880}
          onClose={() => setOpen(null)}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Link href={open.where.href} className={buttonClass("ghost")}>
                <Icon name="arrow-up-right" />
                {v.openWhere}
              </Link>
              <a href={open.download} download={open.name || undefined} className={buttonClass("primary")}>
                <Icon name="download" />
                {v.download}
              </a>
            </div>
          }
        >
          <div className="flex min-h-40 items-center justify-center" data-vault-preview>
            {open.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- served by our own file routes
              <img src={open.src} alt={nameOf(open)} className="max-h-[65vh] max-w-full rounded-lg object-contain" />
            ) : open.kind === "video" ? (
              <video src={open.src} controls className="max-h-[65vh] max-w-full rounded-lg" />
            ) : (
              <audio src={open.src} controls className="w-full" />
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            {SERVICE_BRANDS[open.source].name} · {whereOf(open)} · {formatBytes(open.bytes)} · {when(open.createdAt)}
          </p>
        </Dialog>
      )}
    </>
  );
}

// Images show themselves (lazily); everything else a mark of its kind.
function Thumb({ file, size, onOpen }: { file: VaultFile; size?: number; onOpen: () => void }) {
  const box = size ? { width: size, height: size } : undefined;
  const inner =
    file.kind === "image" && file.source !== "surveys" ? (
      // eslint-disable-next-line @next/next/no-img-element -- served by our own file routes
      <img src={file.src} alt="" loading="lazy" className="h-full w-full object-cover" />
    ) : (
      <Icon name={KIND_ICONS[file.kind]} size={size ? 18 : 28} />
    );
  const cls = `flex shrink-0 items-center justify-center overflow-hidden bg-hover text-muted ${size ? "rounded-md" : "aspect-[4/3] w-full"}`;
  return previewable(file) ? (
    <button type="button" onClick={onOpen} style={box} className={cls} aria-label={`${v.preview}: ${nameOf(file)}`} tabIndex={-1}>
      {inner}
    </button>
  ) : (
    <span style={box} className={cls} aria-hidden="true">
      {inner}
    </span>
  );
}

// A preview for what the browser shows here; the rest opens in a new tab.
function FileName({ file, onOpen }: { file: VaultFile; onOpen: () => void }) {
  const cls = "block w-full min-w-0 truncate text-left text-sm font-medium hover:underline";
  return previewable(file) ? (
    <button type="button" onClick={onOpen} className={cls} title={nameOf(file)}>
      {nameOf(file)}
    </button>
  ) : (
    <a href={file.src} target="_blank" rel="noopener noreferrer" className={cls} title={nameOf(file)}>
      {nameOf(file)}
    </a>
  );
}
