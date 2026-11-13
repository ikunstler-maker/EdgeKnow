"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { SERVICE_BRANDS } from "@/lib/services";
import { canEditVault, type VaultItem, type VaultListing } from "@/lib/vault";
import { readVaultFolder } from "@/app/vault-actions";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

const v = t.vault;

// Choosing where an item goes: one folder at a time, starting where it is; only folders
// the person may add to can be chosen (never the item itself or what is inside it — the
// database refuses that too).
export function VaultMoveDialog({ shortId, workspaceId, item, start, onClose, onMove }: { shortId: string; workspaceId: string; item: VaultItem; start: string | null; onClose: () => void; onMove: (folder: string | null) => Promise<ActionResult> }) {
  const router = useRouter();
  const [at, setAt] = useState<string | null>(start);
  const [listing, setListing] = useState<VaultListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void readVaultFolder(shortId, workspaceId, at).then((result) => {
      if (!live) return;
      if (result.ok) {
        setListing(result);
        setError(null);
      } else setError(v.errors[result.error] ?? v.errors.unknown);
    });
    return () => {
      live = false;
    };
  }, [shortId, workspaceId, at]);

  const folders = (listing?.items ?? []).filter((i) => i.kind === "folder" && i.id !== item.id);
  const here = listing?.folder ?? null;
  const canDropHere = at === null || canEditVault(here?.role);
  const parent = listing?.path.length ? listing.path[listing.path.length - 1].id : null;
  const move = () =>
    startTransition(async () => {
      const result = await onMove(at);
      if (!result.ok) return setError(v.errors[result.error] ?? v.errors.unknown);
      router.refresh();
      onClose();
    });

  return (
    <Dialog
      title={v.moveTitle(item.name)}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {v.cancel}
          </Button>
          <Button variant="primary" disabled={pending || !listing || !canDropHere || at === item.parent_id} onClick={move} data-vault-move-here>
            {v.moveHere}
          </Button>
        </div>
      }
    >
      <div className="flex min-h-11 items-center gap-2 text-sm">
        {at !== null && (
          <button type="button" onClick={() => setAt(parent)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-hover" aria-label={v.up} title={v.up}>
            <Icon name="arrow-left" />
          </button>
        )}
        <span className="truncate font-medium">{here?.name ?? SERVICE_BRANDS.files.name}</span>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {listing && folders.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{v.noFolders}</p>
      ) : (
        <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border" data-vault-move-folders>
          {folders.map((folder) => (
            <li key={folder.id}>
              <button type="button" onClick={() => setAt(folder.id)} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-hover" data-vault-move-folder={folder.name}>
                <Icon name="folder" />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                <Icon name="chevron-right" className="text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
