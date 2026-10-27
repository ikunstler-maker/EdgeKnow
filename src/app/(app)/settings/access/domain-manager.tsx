"use client";

import { useState, useTransition } from "react";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { addDomain, removeDomain, setDomainActive } from "./actions";

const s = t.settings.access;

export type DomainRow = { domain: string; isActive: boolean; addedBy: string | null };

function errorText(result: ActionResult | null) {
  if (!result || result.ok) return null;
  return s.errors[result.error] ?? t.common.unknownError;
}

export function DomainManager({ domains }: { domains: DomainRow[] }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => setResult(await action()));

  const error = errorText(result);

  return (
    <div className="mt-3">
      {domains.length === 0 ? (
        <p className="text-muted">{s.empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {domains.map((d) => (
            <li key={d.domain} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <span className="font-mono">{d.domain}</span>{" "}
                <span className={d.isActive ? "text-sm text-accent" : "text-sm text-muted"}>
                  · {d.isActive ? s.active : s.inactive}
                </span>
                {d.addedBy && (
                  <div className="truncate text-xs text-muted">
                    {s.addedBy}: {d.addedBy}
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setDomainActive(d.domain, !d.isActive))}
                className="min-h-11 rounded-lg border border-border px-3 text-sm hover:bg-surface disabled:opacity-60"
              >
                {d.isActive ? s.disable : s.enable}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (confirm(s.confirmRemove(d.domain))) run(() => removeDomain(d.domain));
                }}
                className="min-h-11 rounded-lg border border-border px-3 text-sm text-danger hover:bg-surface disabled:opacity-60"
              >
                {s.remove}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form action={(formData) => run(() => addDomain(formData))} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          {s.addLabel}
          <input
            name="domain"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={s.addPlaceholder}
            className="min-h-11 rounded-lg border border-border bg-background px-3 font-mono text-base"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-lg bg-accent px-4 font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {s.addButton}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
