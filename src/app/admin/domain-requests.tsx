"use client";

import { useState, useTransition } from "react";
import { t } from "@/i18n";
import { confirmDomainByHand, setEmailDomainProof } from "@/app/domain-actions";

export type DomainRequest = {
  workspace_id: string;
  workspace: string;
  domain: string;
  requested_by: string | null;
  requested_at: string;
  held_by: string | null;
};

// Domains waiting for their DNS record, and the switch for the instant email way.
export function DomainRequests({ requests, emailWay }: { requests: DomainRequest[]; emailWay: boolean }) {
  const p = t.platform.domains;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : (t.settings.errors[result.error ?? ""] ?? t.common.unknownError));
    });
  return (
    <section className="mt-8 rounded-lg border border-border p-4">
      <h2 className="font-semibold">{p.heading}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted">{emailWay ? p.emailOn : p.emailOff}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => setEmailDomainProof(!emailWay))}
          className="min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-surface disabled:opacity-60"
        >
          {emailWay ? t.platform.disable : t.platform.enable}
        </button>
      </div>
      <h3 className="mt-4 text-sm font-medium">{p.requests}</h3>
      {requests.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{p.none}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border text-sm">
          {requests.map((r) => (
            <li key={`${r.workspace_id}/${r.domain}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-mono">{r.domain}</span> → {r.workspace}
                <span className="block text-xs text-muted">
                  {p.requestedBy(r.requested_by ?? "—", new Date(r.requested_at).toLocaleDateString())}
                  {r.held_by && ` ${p.heldBy(r.held_by)}`}
                </span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (confirm(p.confirmByHand(r.domain, r.workspace))) act(() => confirmDomainByHand(r.workspace_id, r.domain));
                }}
                className="min-h-11 rounded-lg border border-border px-4 hover:bg-surface disabled:opacity-60"
              >
                {p.byHand}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
