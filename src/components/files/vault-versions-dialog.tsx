"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { dateLocale, t } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import type { Person } from "@/lib/tasks";
import { canEditVault, vaultFileSrc, type VaultItem } from "@/lib/vault";
import { deleteVaultVersion, listVaultVersions, restoreVaultVersion, type VaultVersion } from "@/app/vault-actions";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const v = t.vault;
const vv = t.vault.versions;

// A file's versions (VAULT-6): the current one and the earlier ones, newest first. Whoever
// sees the file opens them; whoever edits it makes one current again or deletes it.
export function VaultVersionsDialog({ shortId, item, members, onClose }: { shortId: string; item: VaultItem; members: Person[]; onClose: () => void }) {
  const router = useRouter();
  const [list, setList] = useState<VaultVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const edit = canEditVault(item.role);
  const nameOf = new Map(members.map((m) => [m.id, m.name || m.email]));
  const when = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const load = () => listVaultVersions(shortId, item.id).then(setList);
  useEffect(() => {
    let alive = true;
    void listVaultVersions(shortId, item.id).then((rows) => alive && setList(rows));
    return () => {
      alive = false;
    };
  }, [shortId, item.id]);
  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : (v.errors[result.error ?? "unknown"] ?? v.errors.unknown));
      await load();
      router.refresh();
    });
  const src = (versionId: string) => `${vaultFileSrc(shortId, item.id)}&version=${versionId}&download`;

  return (
    <Dialog title={`${vv.title}: ${item.name}`} onClose={onClose} width={560}>
      <div className="space-y-3 text-sm" data-vault-versions>
        <p className="text-xs text-muted">{vv.hint}</p>
        {error && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
            {error}
          </p>
        )}
        <ul className="divide-y divide-border rounded-lg border border-border">
          <li className="flex flex-wrap items-center gap-2 px-3 py-2" data-vault-version="current">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{vv.current(item.version ?? 1)}</span>
              <span className="block text-xs text-muted">{[item.bytes ? formatBytes(Number(item.bytes)) : "", item.updated_at ? when(item.updated_at) : ""].filter(Boolean).join(" · ")}</span>
            </span>
            <a href={`${vaultFileSrc(shortId, item.id)}&download`} className="text-xs font-medium text-accent hover:underline">
              {vv.open}
            </a>
          </li>
          {list === null ? (
            <li className="px-3 py-2 text-muted">{v.embed.loading}</li>
          ) : list.length === 0 ? (
            <li className="px-3 py-2 text-muted">{vv.none}</li>
          ) : (
            list.map((ver) => (
              <li key={ver.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-vault-version={ver.version_no}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {vv.item(ver.version_no)} · {ver.name}
                  </span>
                  <span className="block text-xs text-muted">
                    {formatBytes(ver.bytes)} · {vv.by(ver.uploaded_by ? (nameOf.get(ver.uploaded_by) ?? "—") : "—", when(ver.created_at))}
                  </span>
                </span>
                <a href={src(ver.id)} className="inline-flex min-h-11 items-center text-xs font-medium text-accent hover:underline md:min-h-0">
                  {vv.open}
                </a>
                {edit && (
                  <>
                    <Button variant="ghost" disabled={pending} onClick={() => run(() => restoreVaultVersion(shortId, ver.id))} data-vault-version-restore>
                      {vv.restore}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        if (confirm(vv.confirmRemove(ver.version_no))) run(() => deleteVaultVersion(shortId, ver.id));
                      }}
                      data-vault-version-delete
                    >
                      {vv.remove}
                    </Button>
                  </>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
    </Dialog>
  );
}
