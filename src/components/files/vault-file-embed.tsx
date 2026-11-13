"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import { SERVICE_BRANDS } from "@/lib/services";
import { kindOf, vaultFileSrc, type VaultListing } from "@/lib/vault";
import { vaultFileHref } from "@/lib/vault-links";
import { VAULT_SMALL_BYTES } from "@/lib/vault-files";
import { vaultFileView, vaultPickList, type VaultFileView } from "@/app/vault-actions";
import { Icon, type IconName } from "@/components/ui/icon";

const e = t.vault.embed;
const KIND_ICONS: Record<string, IconName> = { image: "image", pdf: "file-text", video: "play", audio: "mic", document: "file-text", other: "file" };
const showsPicture = (file: VaultFileView) => !file.large && file.bytes <= VAULT_SMALL_BYTES && kindOf(file.mime_type) === "image";

// A Vault file inside another service (VAULT-3): only its id is kept there; the card is
// read with the viewer's own access every time — without it, "unavailable", never the name.
export function VaultFileEmbed({ shortId, fileId, editable, onPick, compact = false }: { shortId: string; fileId: string; editable: boolean; onPick: (id: string) => void; compact?: boolean }) {
  const [view, setView] = useState<VaultFileView | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!fileId || !shortId) return;
    let alive = true;
    void vaultFileView(shortId, fileId).then((v) => alive && setView(v));
    return () => {
      alive = false;
    };
  }, [shortId, fileId]);

  if (!fileId || picking) {
    return editable ? (
      <VaultFilePicker
        shortId={shortId}
        onPick={(id) => {
          setPicking(false);
          setView(undefined);
          onPick(id);
        }}
      />
    ) : (
      <VaultFileUnavailable />
    );
  }
  if (view === undefined) return <p className="rounded-xl border border-border bg-surface px-3 py-3 text-sm text-muted">{e.loading}</p>;
  if (view === null) return <VaultFileUnavailable />;
  return (
    <div className="space-y-1">
      <VaultFileCard shortId={shortId} file={view} compact={compact} />
      {editable && (
        <button type="button" onClick={() => setPicking(true)} className="min-h-11 text-xs text-muted hover:text-foreground hover:underline md:min-h-0" data-vault-embed-change>
          {e.change}
        </button>
      )}
    </div>
  );
}

export function VaultFileCard({ shortId, file, compact = false }: { shortId: string; file: VaultFileView; compact?: boolean }) {
  const src = vaultFileSrc(shortId, file.id);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface" data-vault-embed-card={file.name}>
      {!compact && showsPicture(file) && (
        <a href={src} target="_blank" rel="noopener noreferrer" className="block min-h-0 flex-1 bg-hover">
          {/* eslint-disable-next-line @next/next/no-img-element -- served by our own file route */}
          <img src={src} alt={file.name} loading="lazy" className="h-full max-h-80 w-full object-contain" />
        </a>
      )}
      <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
        <Icon name={KIND_ICONS[kindOf(file.mime_type)]} size={18} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <span className="block truncate font-medium" title={file.name}>
            {file.name}
          </span>
          <span className="block text-xs text-muted">
            {SERVICE_BRANDS.files.name} · {formatBytes(file.bytes)}
          </span>
        </div>
        <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline md:min-h-0" data-vault-embed-open>
          {e.open}
          <Icon name="arrow-up-right" size={12} />
        </a>
        <Link href={vaultFileHref(shortId, file.id)} prefetch={false} className="inline-flex min-h-11 shrink-0 items-center text-xs text-muted hover:text-foreground hover:underline md:min-h-0">
          {e.inVault}
        </Link>
      </div>
    </div>
  );
}

export function VaultFileUnavailable() {
  return (
    <p className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-3 text-sm text-muted" data-vault-embed-unavailable>
      <Icon name="lock" size={14} />
      {e.unavailable}
    </p>
  );
}

// Choosing a Vault file: one folder at a time (the person's own view of Vault), files
// filtered by name within it.
export function VaultFilePicker({ shortId, onPick }: { shortId: string; onPick: (id: string) => void }) {
  const [folder, setFolder] = useState<string | null>(null);
  const [listing, setListing] = useState<VaultListing | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let alive = true;
    void vaultPickList(shortId, folder).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setListing(result);
        setFailed(null);
      } else setFailed(result.error);
    });
    return () => {
      alive = false;
    };
  }, [shortId, folder]);
  const q = query.trim().toLowerCase();
  const items = (listing?.items ?? []).filter((i) => i.kind === "folder" || !q || i.name.toLowerCase().includes(q));
  const parent = listing?.path.length ? listing.path[listing.path.length - 1].id : null;
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3 text-sm" contentEditable={false} data-vault-picker>
      <p className="flex items-center gap-1.5 font-medium">
        <Icon name="folder" size={14} />
        {e.pick}
      </p>
      <div className="flex items-center gap-1">
        {folder !== null && (
          <button type="button" onClick={() => setFolder(parent)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-hover md:min-h-8 md:min-w-8" aria-label={t.vault.up} title={t.vault.up}>
            <Icon name="arrow-left" />
          </button>
        )}
        <span className="truncate text-muted">{listing?.folder?.name ?? SERVICE_BRANDS.files.name}</span>
      </div>
      <input value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder={e.search} aria-label={e.search} className="min-h-11 w-full rounded-lg border border-border bg-background px-2 text-base md:min-h-9 md:text-sm" />
      {failed ? (
        <p className="text-muted">{t.vault.errors[failed] ?? t.vault.errors.unknown}</p>
      ) : listing === null ? (
        <p className="text-muted">{e.loading}</p>
      ) : items.length === 0 ? (
        <p className="text-muted">{e.none}</p>
      ) : (
        <ul className="max-h-64 divide-y divide-border overflow-auto">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => (item.kind === "folder" ? setFolder(item.id) : onPick(item.id))}
                className="flex min-h-11 w-full items-center gap-2 px-1 text-left hover:bg-hover md:min-h-9"
                data-vault-pick={item.name}
              >
                <Icon name={item.kind === "folder" ? "folder" : KIND_ICONS[kindOf(item.mime_type ?? "")]} size={16} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.kind === "folder" ? <Icon name="chevron-right" size={14} className="text-muted" /> : <span className="text-xs text-muted">{formatBytes(Number(item.bytes))}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
