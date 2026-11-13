"use client";

import { useState, useTransition } from "react";
import { t } from "@/i18n";
import { setVaultFileLimit } from "@/app/vault-actions";
import { Button, inputClass } from "@/components/ui/button";

const l = t.vault.limit;

// Settings → Data & storage: the largest file in Vault (owner and admins; empty: no limit).
export function VaultLimitPanel({ shortId, workspaceId, limitMb }: { shortId: string; workspaceId: string; limitMb: number | null }) {
  const [value, setValue] = useState(limitMb === null ? "" : String(limitMb));
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = value.trim() === "" ? null : Number(value);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5242880);
  const save = () =>
    startTransition(async () => {
      const result = await setVaultFileLimit(shortId, workspaceId, parsed);
      setNote(result.ok ? l.saved : (t.vault.errors[result.error] ?? t.vault.errors.unknown));
    });
  return (
    <section className="rounded-2xl border border-border p-4 sm:p-5" data-vault-limit>
      <h2 className="font-semibold">{l.title}</h2>
      <p className="mt-1 text-sm text-muted">{l.hint}</p>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) save();
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <input type="number" min={1} max={5242880} step={1} inputMode="numeric" value={value} placeholder={l.none} onChange={(e) => setValue(e.target.value)} className={`${inputClass} w-40`} aria-label={l.title} data-vault-limit-input />
          <span className="text-muted">{l.mb}</span>
        </label>
        <Button type="submit" variant="primary" disabled={pending || !valid} data-vault-limit-save>
          {t.vault.save}
        </Button>
        {note && (
          <span role="status" className="text-sm text-muted">
            {note}
          </span>
        )}
      </form>
    </section>
  );
}
