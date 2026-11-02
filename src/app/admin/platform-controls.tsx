"use client";

import { useState, useTransition } from "react";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { freezeWorkspace, rekeyTeamDatabases, setCentralAllowed, setRequireTeamDatabase } from "@/app/platform-actions";

const p = t.platform;
const buttonClass = "min-h-11 rounded-lg border border-border px-3 text-sm hover:bg-surface disabled:opacity-60";

function useRun() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : (t.settings.errors[result.error] ?? t.common.unknownError));
    });
  return { pending, run, error };
}

// "Own database first" and the size of the central database.
export function OwnDatabaseFirst({ required, databaseMb, storageMb }: { required: boolean; databaseMb: number | null; storageMb: number | null }) {
  const { pending, run, error } = useRun();
  return (
    <section className="mt-8 rounded-lg border border-border p-4" data-section="own-database">
      <h2 className="font-semibold">{p.ownDatabase.heading}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted">{required ? p.ownDatabase.on : p.ownDatabase.off}</p>
        <button type="button" disabled={pending} onClick={() => run(() => setRequireTeamDatabase(!required))} className={buttonClass}>
          {required ? p.disable : p.enable}
        </button>
      </div>
      {databaseMb !== null && (
        <p className="mt-3 text-sm" data-central-usage>
          {p.ownDatabase.usage(databaseMb.toFixed(1), (storageMb ?? 0).toFixed(1))}
          {(databaseMb > 400 || (storageMb ?? 0) > 800) && <span className="block text-danger">{p.ownDatabase.nearlyFull}</span>}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}

// Per workspace: may it keep pages centrally, and freezing.
export function WorkspaceControls({
  id,
  name,
  centralAllowed,
  frozen,
}: {
  id: string;
  name: string;
  centralAllowed: boolean;
  frozen: boolean;
}) {
  const { pending, run, error } = useRun();
  return (
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        disabled={pending}
        className={buttonClass}
        title={p.controls.centralHint}
        onClick={() => run(() => setCentralAllowed(id, !centralAllowed))}
      >
        {centralAllowed ? p.controls.centralOff : p.controls.centralOn}
      </button>
      <button
        type="button"
        disabled={pending}
        className={`${buttonClass} ${frozen ? "" : "text-danger"}`}
        onClick={() => {
          if (frozen) return run(() => freezeWorkspace(id, false, null));
          const reason = prompt(p.controls.freezeReason(name));
          if (reason !== null) run(() => freezeWorkspace(id, true, reason));
        }}
      >
        {frozen ? p.controls.unfreeze : p.controls.freeze}
      </button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </div>
  );
}

// The key of the team databases' secrets (TEAM_DB_KEY): how many are on it, move now, or back.
export function TeamKeyPanel({ configured, total, onNewKey }: { configured: boolean; total: number; onNewKey: number }) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const run = (direction: "new" | "old") =>
    startTransition(async () => {
      const result = await rekeyTeamDatabases(direction);
      setNotice(result.ok ? p.teamKey.done(result.changed, result.failed) : (t.settings.errors[result.error] ?? p.teamKey.errors[result.error] ?? t.common.unknownError));
    });
  return (
    <section className="mt-8 rounded-lg border border-border p-4" data-section="team-key">
      <h2 className="font-semibold">{p.teamKey.heading}</h2>
      <p className="mt-2 text-sm" data-team-key-status>
        {configured ? p.teamKey.status(onNewKey, total) : p.teamKey.notConfigured}
      </p>
      <p className="mt-1 text-xs text-muted">{p.teamKey.explain}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {configured && (
          <button type="button" disabled={pending} onClick={() => run("new")} className={buttonClass}>
            {p.teamKey.now}
          </button>
        )}
        <button
          type="button"
          disabled={pending || onNewKey === 0}
          onClick={() => confirm(p.teamKey.backConfirm) && run("old")}
          className={buttonClass}
        >
          {p.teamKey.back}
        </button>
      </div>
      {notice && (
        <p role="status" className="mt-2 text-sm text-muted">
          {notice}
        </p>
      )}
    </section>
  );
}
