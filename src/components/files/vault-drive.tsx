"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { dateLocale, t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { formatBytes } from "@/lib/format-bytes";
import { SERVICE_BRANDS } from "@/lib/services";
import { workspacePath } from "@/lib/paths";
import type { Person } from "@/lib/tasks";
import { canEditVault, kindOf, vaultFileSrc, type VaultItem, type VaultListing } from "@/lib/vault";
import { VAULT_PART_BYTES, VAULT_SMALL_BYTES } from "@/lib/vault-files";
import { createVaultFolder, deleteVaultItem, moveVaultItem, renameVaultItem, restoreVaultItem, trashVaultItem } from "@/app/vault-actions";
import { VaultMoveDialog } from "./vault-move-dialog";
import { VaultShareDialog } from "./vault-share-dialog";
import { VaultVersionsDialog } from "./vault-versions-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Icon, type IconName } from "@/components/ui/icon";
import { Popover } from "@/components/ui/popover";
import { Button, iconButtonClass, inputClass } from "@/components/ui/button";

const v = t.vault;
const errorText = (code: string | undefined) => v.errors[code ?? "unknown"] ?? v.errors.unknown;
const KIND_ICONS: Record<string, IconName> = { image: "image", pdf: "file-text", video: "play", audio: "mic", document: "file-text", other: "file" };

type Upload = { key: string; name: string; percent: number; error?: string };
type Dialogs =
  | { kind: "folder" }
  | { kind: "rename"; item: VaultItem }
  | { kind: "move"; item: VaultItem }
  | { kind: "share"; item: VaultItem }
  | { kind: "delete"; item: VaultItem }
  | { kind: "versions"; item: VaultItem };

// Vault's own folders and files (VAULT-2): one folder at a time, uploads by button or by
// dropping files, and per item: open, download, rename, move, access, bin. The bin lists
// what the person removed, to restore or delete for good. Every right is checked by the
// database; the screen only hides what the person's role does not allow.
export function VaultDrive({
  shortId,
  workspaceId,
  listing,
  bin,
  focus = null,
  hasDrive,
  limitMb,
  members,
  groups,
}: {
  shortId: string;
  workspaceId: string;
  listing: VaultListing;
  bin: boolean;
  focus?: string | null;
  hasDrive: boolean;
  limitMb: number | null;
  members: Person[];
  groups: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [menu, setMenu] = useState<{ item: VaultItem; anchor: HTMLElement } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderId = listing.folder?.id ?? null;
  // At the top every member may add; inside a folder whoever edits it.
  const canAdd = !bin && (folderId === null || canEditVault(listing.folder?.role));
  const base = workspacePath(shortId, "/files");
  const folderHref = (id: string | null) => (id ? `${base}?folder=${id}` : base);
  const when = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(new Date(value));
  const ownerOf = new Map(members.map((m) => [m.id, m.name || m.email]));

  const run = (action: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : errorText(result.error));
      if (result.ok) after?.();
      router.refresh();
    });

  const setUpload = (key: string, patch: Partial<Upload>) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  // replace: a new version of this file instead of a new file (VAULT-6).
  async function uploadOne(file: File, key: string, replace?: string): Promise<boolean> {
    const fail = (code: string) => {
      setUpload(key, { error: errorText(code) });
      return false;
    };
    if (limitMb !== null && file.size > limitMb * 1048576) return fail("too_large");
    if (!file.size) return fail("invalid_file");
    const query = `ws=${shortId}&folder=${folderId ?? ""}&name=${encodeURIComponent(file.name.slice(0, 200))}${replace ? `&replace=${replace}` : ""}`;
    if (file.size <= VAULT_SMALL_BYTES) {
      const response = await fetch(`/api/vault/files?${query}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }).catch(() => null);
      const result = (await response?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!result?.ok) return fail(result?.error ?? "upload_failed");
      setUpload(key, { percent: 100 });
      return true;
    }
    if (!hasDrive) return fail("no_drive");
    const started = await fetch(`/api/vault/files/large?${query}&size=${file.size}&type=${encodeURIComponent(file.type || "application/octet-stream")}`, { method: "POST" }).catch(() => null);
    const begin = (await started?.json().catch(() => null)) as { ok?: boolean; error?: string; id?: string } | null;
    if (!begin?.ok || !begin.id) return fail(begin?.error ?? "upload_failed");
    let offset = 0;
    while (offset < file.size) {
      const part = file.slice(offset, offset + VAULT_PART_BYTES);
      const sent = await fetch(`/api/vault/files/large?ws=${shortId}&id=${begin.id}&offset=${offset}`, { method: "PUT", body: part }).catch(() => null);
      const step = (await sent?.json().catch(() => null)) as { ok?: boolean; error?: string; offset?: number; done?: boolean } | null;
      if (!step?.ok || typeof step.offset !== "number") return fail(step?.error ?? "upload_failed");
      offset = step.offset;
      setUpload(key, { percent: Math.min(100, Math.round((offset / file.size) * 100)) });
      if (step.done) break;
    }
    return true;
  }

  async function uploadAll(files: File[]) {
    if (!files.length || !canAdd) return;
    const batch = files.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, name: file.name, percent: 0 }));
    setUploads((list) => [...list.filter((u) => !u.error && u.percent < 100), ...batch]);
    // One after another: a large file goes in many parts, and the server takes one at a time.
    for (let i = 0; i < files.length; i++) await uploadOne(files[i], batch[i].key);
    setUploads((list) => list.filter((u) => u.error));
    router.refresh();
  }

  // A new version of one file (whoever edits it): the same upload, then it takes the file's place.
  const versionInput = useRef<HTMLInputElement>(null);
  const [versionOf, setVersionOf] = useState<VaultItem | null>(null);
  async function uploadVersion(file: File | undefined, item: VaultItem | null) {
    if (!file || !item) return;
    const key = `${Date.now()}-v-${file.name}`;
    setUploads((list) => [...list.filter((u) => !u.error && u.percent < 100), { key, name: file.name, percent: 0 }]);
    await uploadOne(file, key, item.id);
    setUploads((list) => list.filter((u) => u.error));
    router.refresh();
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void uploadAll(Array.from(event.dataTransfer.files ?? []));
  };

  return (
    <section
      className="relative mt-4"
      onDragOver={(event) => {
        if (!canAdd || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      data-vault-drive
    >
      {!bin && (
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label={v.folder} className="flex min-w-0 basis-full flex-wrap items-center gap-1 text-sm sm:basis-0 sm:flex-1" data-vault-path>
            <Link href={base} className="rounded px-1 font-medium hover:underline">
              {SERVICE_BRANDS.files.name}
            </Link>
            {listing.path.map((step) => (
              <span key={step.id} className="flex min-w-0 items-center gap-1">
                <Icon name="chevron-right" size={14} className="text-muted" />
                <Link href={folderHref(step.id)} className="max-w-48 truncate rounded px-1 hover:underline">
                  {step.name}
                </Link>
              </span>
            ))}
            {listing.folder && (
              <span className="flex min-w-0 items-center gap-1">
                <Icon name="chevron-right" size={14} className="text-muted" />
                <span className="max-w-60 truncate px-1 font-medium" aria-current="page">
                  {listing.folder.name}
                </span>
              </span>
            )}
          </nav>
          {listing.folder && (
            <Button variant="ghost" icon="users" onClick={() => listing.folder && setDialog({ kind: "share", item: asItem(listing.folder) })} data-vault-folder-share>
              {v.share}
            </Button>
          )}
          {canAdd && (
            <>
              <Button variant="subtle" icon="folder" onClick={() => setDialog({ kind: "folder" })} data-vault-new-folder>
                {v.newFolder}
              </Button>
              <Button variant="primary" icon="upload" onClick={() => fileInput.current?.click()} data-vault-upload>
                {v.upload}
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  void uploadAll(files);
                }}
                data-vault-file-input
              />
            </>
          )}
        </div>
      )}
      {!bin && !canAdd && <p className="mt-2 text-xs text-muted">{v.readOnly}</p>}
      {!bin && canAdd && (limitMb !== null || !hasDrive) && (
        <p className="mt-2 text-xs text-muted">{[limitMb !== null ? v.limitNote(limitMb) : "", !hasDrive ? v.largeNeedsDrive : ""].filter(Boolean).join(" ")}</p>
      )}
      {bin && <p className="text-sm text-muted">{v.binIntro}</p>}

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm" data-vault-error>
          {error}
        </p>
      )}
      {uploads.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl border border-border bg-surface p-2 text-sm" aria-live="polite" data-vault-uploads>
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-2 px-1">
              <Icon name={u.error ? "alert" : "upload"} size={16} className={u.error ? "text-danger" : "text-muted"} />
              <span className="min-w-0 flex-1 truncate">{u.error ? v.uploadFailed(u.name, u.error) : v.uploading(u.name, u.percent)}</span>
              {u.error && (
                <button type="button" className={iconButtonClass("ghost")} aria-label={t.common.close} onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}>
                  <Icon name="close" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {listing.items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted" data-vault-empty>
          {bin ? v.binEmpty : folderId ? v.emptyFolder : v.emptyTop}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" data-vault-items>
          {listing.items.map((item) => (
            <li
              key={item.id}
              ref={item.id === focus ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}
              className={`flex min-h-14 items-center gap-3 px-3 py-2 ${item.id === focus ? "bg-accent/10" : ""}`}
              aria-current={item.id === focus ? "true" : undefined}
              data-vault-item={item.name}
              data-vault-kind={item.kind}
            >
              <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-hover text-muted">
                {item.kind === "folder" ? (
                  <Icon name="folder" size={20} />
                ) : kindOf(item.mime_type ?? "") === "image" && Number(item.bytes) <= VAULT_SMALL_BYTES && !bin ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served by our own file route
                  <img src={vaultFileSrc(shortId, item.id)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <Icon name={KIND_ICONS[kindOf(item.mime_type ?? "")]} size={18} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                {bin ? (
                  <span className="block truncate text-sm font-medium">{item.name}</span>
                ) : item.kind === "folder" ? (
                  <Link href={folderHref(item.id)} className="block truncate text-sm font-medium hover:underline" data-vault-open>
                    {item.name}
                  </Link>
                ) : (
                  <a href={vaultFileSrc(shortId, item.id)} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium hover:underline" data-vault-open>
                    {item.name}
                  </a>
                )}
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                  {item.restricted && (
                    <span title={v.restricted} data-vault-restricted>
                      <Icon name="lock" size={12} />
                      <span className="sr-only">{v.restricted}</span>
                    </span>
                  )}
                  {item.shared && (
                    <span title={v.shared}>
                      <Icon name="users" size={12} />
                      <span className="sr-only">{v.shared}</span>
                    </span>
                  )}
                  <span className="truncate">
                    {[item.kind === "file" ? formatBytes(Number(item.bytes)) : v.folder, (item.version ?? 1) > 1 ? v.versions.badge(item.version ?? 1) : "", when(bin && item.deleted_at ? item.deleted_at : item.updated_at), item.owner_id ? ownerOf.get(item.owner_id) : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </div>
              {bin ? (
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  <Button variant="ghost" icon="undo" disabled={pending} onClick={() => run(() => restoreVaultItem(shortId, item.id))} data-vault-restore>
                    {v.restore}
                  </Button>
                  <Button variant="danger" icon="trash" disabled={pending} onClick={() => setDialog({ kind: "delete", item })} data-vault-delete>
                    <span className="sr-only sm:not-sr-only">{v.deleteForever}</span>
                  </Button>
                </div>
              ) : (
                <>
                  {item.kind === "file" && (
                    <a href={`${vaultFileSrc(shortId, item.id)}&download`} className={iconButtonClass("ghost", "shrink-0")} aria-label={`${v.download}: ${item.name}`} title={v.download}>
                      <Icon name="download" size={18} />
                    </a>
                  )}
                  <button
                    type="button"
                    className={iconButtonClass("ghost", "shrink-0")}
                    aria-label={v.actions(item.name)}
                    title={v.actions(item.name)}
                    onClick={(event) => setMenu({ item, anchor: event.currentTarget })}
                    data-vault-menu
                  >
                    <Icon name="more" size={18} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-background/80 text-sm font-medium" aria-hidden="true">
          {v.dropHere}
        </div>
      )}

      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={220}>
          <MenuItems
            item={menu.item}
            onPick={(next) => {
              setMenu(null);
              if (next === "trash") run(() => trashVaultItem(shortId, menu.item.id));
              else if (next === "newVersion") {
                setVersionOf(menu.item);
                versionInput.current?.click();
              } else setDialog({ kind: next, item: menu.item } as Dialogs);
            }}
          />
        </Popover>
      )}

      <input
        ref={versionInput}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void uploadVersion(file, versionOf);
        }}
        data-vault-version-input
      />
      {dialog?.kind === "versions" && <VaultVersionsDialog shortId={shortId} item={dialog.item} members={members} onClose={() => setDialog(null)} />}
      {dialog?.kind === "folder" && (
        <NameDialog title={v.newFolder} label={v.folderName} initial="" submit={v.create} onClose={() => setDialog(null)} onSave={(name) => createVaultFolder(shortId, workspaceId, folderId, name)} />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog title={v.rename} label={v.newName} initial={dialog.item.name} submit={v.save} onClose={() => setDialog(null)} onSave={(name) => renameVaultItem(shortId, dialog.item.id, name)} />
      )}
      {dialog?.kind === "move" && (
        <VaultMoveDialog shortId={shortId} workspaceId={workspaceId} item={dialog.item} start={folderId} onClose={() => setDialog(null)} onMove={(target) => moveVaultItem(shortId, dialog.item.id, target)} />
      )}
      {dialog?.kind === "share" && <VaultShareDialog shortId={shortId} item={dialog.item} members={members} groups={groups} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <Dialog
          title={v.deleteForever}
          onClose={() => setDialog(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                {v.cancel}
              </Button>
              <Button variant="danger" disabled={pending} onClick={() => run(() => deleteVaultItem(shortId, dialog.item.id), () => setDialog(null))} data-vault-confirm-delete>
                {v.deleteForever}
              </Button>
            </div>
          }
        >
          <p className="text-sm">{v.confirmDelete(dialog.item.name)}</p>
        </Dialog>
      )}
    </section>
  );
}

// The open folder as an item, for its own access dialog.
const asItem = (folder: NonNullable<VaultListing["folder"]>): VaultItem => ({
  id: folder.id, kind: "folder", name: folder.name, mime_type: null, bytes: null, parent_id: null, owner_id: null,
  updated_at: "", deleted_at: null, role: folder.role, restricted: false, shared: false,
});

type MenuAction = "rename" | "move" | "share" | "trash" | "newVersion" | "versions";
function MenuItems({ item, onPick }: { item: VaultItem; onPick: (what: MenuAction) => void }) {
  const edit = canEditVault(item.role);
  const file = item.kind === "file";
  const entry = (what: MenuAction, icon: IconName, label: string): ReactNode => (
    <button key={what} type="button" onClick={() => onPick(what)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-hover md:min-h-9" data-vault-action={what}>
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
  return (
    <div role="menu">
      {edit && entry("rename", "edit", v.rename)}
      {edit && entry("move", "arrow-right", v.move)}
      {edit && file && entry("newVersion", "upload", v.versions.upload)}
      {file && entry("versions", "history", v.versions.title)}
      {entry("share", "users", v.share)}
      {edit && entry("trash", "trash", v.toBin)}
    </div>
  );
}

function NameDialog({ title, label, initial, submit, onClose, onSave }: { title: string; label: string; initial: string; submit: string; onClose: () => void; onSave: (name: string) => Promise<ActionResult> }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      const result = await onSave(name);
      if (!result.ok) return setError(errorText(result.error));
      router.refresh();
      onClose();
    });
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {v.cancel}
          </Button>
          <Button variant="primary" disabled={pending || !name.trim()} onClick={save} data-vault-save-name>
            {submit}
          </Button>
        </div>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) save();
        }}
      >
        <label className="block text-sm">
          {label}
          <input autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className={`${inputClass} mt-1`} data-vault-name />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

