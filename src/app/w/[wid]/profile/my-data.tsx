"use client";

import { useState } from "react";
import { t } from "@/i18n";
import { Icon } from "@/components/ui/icon";

// Everything about me in one file, and deleting my account (GDPR).
export function MyData({ email }: { email: string }) {
  const d = t.profile.myData;
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label={d.heading}>
      <h2 className="text-sm font-semibold">{d.heading}</h2>
      <p className="mt-1 text-xs text-muted">{d.exportIntro}</p>
      <a href="/api/me/export" className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong md:h-8 md:min-h-0" download>
        <Icon name="download" />
        {d.export}
      </a>

      <div className="mt-5 rounded-lg border border-danger/30 bg-danger/5 p-3" data-danger-zone>
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center rounded-lg border border-danger/30 px-3 text-[13px] font-medium text-danger hover:bg-danger/10 md:h-8 md:min-h-0">
            {d.delete}
          </button>
        ) : (
          <form
            className="flex flex-col gap-2 text-sm"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              const response = await fetch("/api/me/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirm }),
              });
              const result = (await response.json().catch(() => ({ ok: false, error: "unknown" }))) as {
                ok: boolean;
                error?: string;
                workspaces?: string[];
              };
              setBusy(false);
              if (result.ok) {
                window.location.href = "/login";
                return;
              }
              setError(
                result.error === "owns_workspaces"
                  ? d.ownsWorkspaces((result.workspaces ?? []).join(", "))
                  : (d.errors[result.error as keyof typeof d.errors] ?? t.common.unknownError),
              );
            }}
          >
            <p className="font-medium text-danger">{d.deleteTitle}</p>
            <ul className="list-disc pl-5 text-muted">
              {d.deletePoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <label className="flex flex-col gap-1">
              {d.confirmLabel(email)}
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="min-h-11 rounded-md border border-border bg-background px-3 text-base md:text-sm"
              />
            </label>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={busy || confirm.trim().toLowerCase() !== email.toLowerCase()}
                className="min-h-11 rounded-lg bg-danger px-4 font-medium text-white disabled:opacity-60"
              >
                {busy ? d.deleting : d.deleteForever}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-border px-4 hover:bg-surface">
                {t.common.cancel}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
