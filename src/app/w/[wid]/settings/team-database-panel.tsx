"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";

export type TeamDatabaseStatus = {
  projectUrl: string | null;
  step: "project" | "schema" | "keys" | "sync" | "copy" | "verify" | "sign_in" | "done" | null;
  lastError: string | null;
  // When the workspace's existing pages were moved in, and how many.
  movedAt: string | null;
  movedPages: number | null;
  // Moving back to the central database (step 1.7c).
  returnStep: "copy" | "verify" | null;
  // The last check (step 1.5b).
  health: "ok" | "waking" | "unreachable" | "revoked" | "almost_full" | "full" | null;
  healthCheckedAt: string | null;
  databaseBytes: number | null;
  storageBytes: number | null;
  schemaVersion: string | null;
  lastSyncedAt: string | null;
} | null;

type Options = {
  organizations: { slug: string; name: string }[];
  projects: { ref: string; name: string; region: string; status: string }[];
};

const STEPS = ["project", "schema", "keys", "sync", "copy", "verify", "sign_in"] as const;
const REGIONS = [
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-north-1",
  "us-east-1",
  "us-west-1",
  "ap-southeast-1",
];

async function setup(body: Record<string, unknown>) {
  const response = await fetch("/api/supabase/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response
    .json()
    .catch(() => ({ ok: false, error: "unknown" }))) as Record<
    string,
    unknown
  > & { ok: boolean; error?: string };
}

export function TeamDatabasePanel({
  workspaceId,
  status,
  hasPages,
  configured,
  choose,
  failed,
}: {
  workspaceId: string;
  status: TeamDatabaseStatus;
  hasPages: boolean;
  configured: boolean;
  choose: boolean;
  failed: boolean;
}) {
  const td = t.teamDatabase;
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [mode, setMode] = useState<"create" | "existing">("create");
  const [organization, setOrganization] = useState("");
  const [region, setRegion] = useState("eu-central-1");
  const [project, setProject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [progress, setProgress] = useState<{
    step: string;
    waiting?: string;
    error?: string;
    copying?: string;
  } | null>(
    status && status.step && status.step !== "done"
      ? { step: status.step, error: status.lastError ?? undefined }
      : null,
  );

  const explain = (code?: string) =>
    code && code in td.errors
      ? td.errors[code as keyof typeof td.errors]
      : td.errors.unknown;

  useEffect(() => {
    if (!choose || status) return;
    void setup({ ws: workspaceId, action: "options" }).then((result) => {
      if (!result.ok) return setError(`${explain(result.error)}${result.detail ? ` (${String(result.detail)})` : ""}`);
      const next = result as unknown as Options;
      setOptions(next);
      setOrganization(next.organizations[0]?.slug ?? "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choose, status, workspaceId]);

  // While setting up: one step every few seconds until done.
  const advance = useCallback(async () => {
    const result = await setup({ ws: workspaceId, action: "advance" });
    setProgress({
      step: String(result.step ?? progress?.step ?? "project"),
      waiting: result.waiting as string | undefined,
      error: result.error as string | undefined,
      copying: result.copying as string | undefined,
    });
    if (result.step === "done") router.refresh();
    return result;
  }, [workspaceId, progress?.step, router]);

  useEffect(() => {
    if (!progress || progress.step === "done" || progress.error) return;
    const timer = setTimeout(
      () => void advance(),
      progress.waiting ? 5000 : 500,
    );
    return () => clearTimeout(timer);
  }, [progress, advance]);

  if (status?.returnStep || (status && returning)) {
    return <ReturnPanel workspaceId={workspaceId} initial={status.returnStep ?? "copy"} initialError={status.lastError} />;
  }

  if (status?.step === "done" || (status && status.step === null)) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <h2 className="font-semibold">✅ {td.connectedTitle}</h2>
        <p className="text-sm">{td.connected}</p>
        {status.projectUrl && (
          <code className="break-all rounded bg-surface px-2 py-1 text-sm">
            {status.projectUrl}
          </code>
        )}
        <p className="text-sm text-muted">
          {status.schemaVersion && `${td.schema}: ${status.schemaVersion}. `}
          {status.lastSyncedAt &&
            `${td.lastSync}: ${new Date(status.lastSyncedAt).toLocaleString()}`}
        </p>
        <HealthLine workspaceId={workspaceId} status={status} />
        {status.movedAt && (
          <p className="text-sm text-muted">
            {td.moved(new Date(status.movedAt).toLocaleString(), status.movedPages ?? 0)}
          </p>
        )}
        {status.lastError && (
          <p className="text-sm text-red-600">{status.lastError}</p>
        )}
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-3">
          <p className="text-sm text-muted">{td.returnIntro}</p>
          <button
            type="button"
            disabled={busy}
            className="min-h-11 self-start rounded-lg border border-border px-4 text-sm hover:bg-surface"
            onClick={async () => {
              if (!window.confirm(td.returnConfirm)) return;
              setBusy(true);
              const result = await setup({ ws: workspaceId, action: "return" });
              setBusy(false);
              if (!result.ok) return setError(explain(result.error));
              setReturning(true);
            }}
          >
            {td.returnButton}
          </button>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
      </section>
    );
  }

  if (progress) {
    const current = STEPS.indexOf(progress.step as (typeof STEPS)[number]);
    return (
      <section
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
        aria-live="polite"
      >
        <h2 className="font-semibold">{td.settingUp}</h2>
        {hasPages && <p className="text-sm text-muted">{td.movingReadOnly}</p>}
        <ol className="flex flex-col gap-1 text-sm">
          {STEPS.map((step, index) => (
            <li key={step}>
              {index < current || progress.step === "done"
                ? "✅"
                : index === current
                  ? progress.error
                    ? "❌"
                    : "⏳"
                  : "▫️"}{" "}
              {td.steps[step]}
              {index === current && progress.copying && !progress.error && (
                <span className="text-muted"> — {progress.copying}</span>
              )}
              {index === current && progress.waiting && (
                <span className="text-muted">
                  {" "}
                  — {td.waiting(progress.waiting)}
                </span>
              )}
            </li>
          ))}
        </ol>
        {progress.error && (
          <>
            <p role="alert" className="text-sm text-red-600">
              {explain(progress.error)}
            </p>
            <button
              type="button"
              className="min-h-11 self-start rounded-lg border border-border px-4 text-sm hover:bg-surface"
              onClick={() => setProgress({ step: progress.step })}
            >
              {td.retry}
            </button>
          </>
        )}
        {progress.step !== "done" && (
          <button
            type="button"
            disabled={busy}
            className="min-h-11 self-start rounded-lg px-4 text-sm text-muted underline hover:text-foreground"
            onClick={async () => {
              if (!window.confirm(td.cancelConfirm)) return;
              setBusy(true);
              const result = await setup({ ws: workspaceId, action: "cancel" });
              setBusy(false);
              if (!result.ok) return setProgress({ ...progress, error: result.error });
              setProgress(null);
              router.refresh();
            }}
          >
            {td.cancel}
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 className="font-semibold">{td.title}</h2>
      <p className="text-sm">{td.intro}</p>
      <ul className="list-disc pl-5 text-sm text-muted">
        {td.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {!configured ? (
        <p className="text-sm text-muted">{td.notConfigured}</p>
      ) : !choose ? (
        <>
          {hasPages && (
            <div className="flex flex-col gap-1 rounded-md bg-surface p-3 text-sm">
              <p className="font-medium">{td.moveTitle}</p>
              <ul className="list-disc pl-5 text-muted">
                {td.movePoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          )}
          {failed && (
            <p role="alert" className="text-sm text-red-600">
              {td.oauthFailed}
            </p>
          )}
          <a
            href={`/api/supabase/connect?ws=${workspaceId}`}
            className="inline-flex min-h-11 items-center self-start rounded-lg bg-accent px-4 text-sm font-medium text-white hover:opacity-90"
          >
            {hasPages ? td.move : td.connect}
          </a>
        </>
      ) : !options ? (
        <p className="text-sm text-muted">{error ?? td.loading}</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            const result = await setup(
              mode === "create"
                ? { ws: workspaceId, action: "create", organization, region, move: hasPages }
                : { ws: workspaceId, action: "existing", ref: project, move: hasPages },
            );
            setBusy(false);
            if (!result.ok) return setError(`${explain(result.error)}${result.detail ? ` (${String(result.detail)})` : ""}`);
            setProgress({ step: "project" });
          }}
        >
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="team-db-mode"
              className="mt-1"
              checked={mode === "create"}
              onChange={() => setMode("create")}
            />
            <span>
              {td.createNew}
              <span className="block text-muted">{td.createHint}</span>
            </span>
          </label>
          {mode === "create" && (
            <div className="flex flex-col gap-2 pl-6">
              <label className="text-sm">
                {td.organization}
                <select
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                >
                  {options.organizations.map((o) => (
                    <option key={o.slug} value={o.slug}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                {td.region}
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                >
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {td.regions[r as keyof typeof td.regions] ?? r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="team-db-mode"
              className="mt-1"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              disabled={!options.projects.length}
            />
            <span>
              {td.useExisting}
              <span className="block text-muted">{td.existingHint}</span>
            </span>
          </label>
          {mode === "existing" && (
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="ml-6 rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">{td.chooseProject}</option>
              {options.projects.map((p) => (
                <option
                  key={p.ref}
                  value={p.ref}
                >{`${p.name} (${p.ref}, ${p.region})`}</option>
              ))}
            </select>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={
              busy ||
              (mode === "existing" && !project) ||
              (mode === "create" && !organization)
            }
            className="min-h-11 self-start rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? td.starting : hasPages ? td.startMove : td.start}
          </button>
        </form>
      )}
    </section>
  );
}

// Moving the workspace back to the EdgeKnow server: copy, check, switch.
function ReturnPanel({ workspaceId, initial, initialError }: { workspaceId: string; initial: "copy" | "verify"; initialError: string | null }) {
  const td = t.teamDatabase;
  const router = useRouter();
  const [progress, setProgress] = useState<{ step: string; error?: string; copying?: string }>({
    step: initial,
    error: initialError ?? undefined,
  });
  const [busy, setBusy] = useState(false);
  const explain = (code?: string) =>
    code && code in td.errors ? td.errors[code as keyof typeof td.errors] : (code ?? td.errors.unknown);

  useEffect(() => {
    if (progress.step === "done" || progress.error) return;
    const timer = setTimeout(async () => {
      const result = await setup({ ws: workspaceId, action: "advance" });
      setProgress({
        step: String(result.step ?? progress.step),
        error: result.ok ? (result.error as string | undefined) : (result.error ?? "unknown"),
        copying: result.copying as string | undefined,
      });
      if (result.step === "done") router.refresh();
    }, 500);
    return () => clearTimeout(timer);
  }, [progress, workspaceId, router]);

  if (progress.step === "done") {
    return (
      <section role="status" className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <h2 className="font-semibold">✅ {td.returnedTitle}</h2>
        <p className="text-sm">{td.returned}</p>
      </section>
    );
  }
  const steps = ["copy", "verify"] as const;
  const current = steps.indexOf(progress.step as (typeof steps)[number]);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-live="polite">
      <h2 className="font-semibold">{td.returningTitle}</h2>
      <p className="text-sm text-muted">{td.returningReadOnly}</p>
      <ol className="flex flex-col gap-1 text-sm">
        {steps.map((step, index) => (
          <li key={step}>
            {index < current ? "✅" : index === current ? (progress.error ? "❌" : "⏳") : "▫️"} {td.returnSteps[step]}
            {index === current && progress.copying && !progress.error && <span className="text-muted"> — {progress.copying}</span>}
          </li>
        ))}
      </ol>
      {progress.error && (
        <>
          <p role="alert" className="text-sm text-red-600">
            {explain(progress.error)}
          </p>
          <button
            type="button"
            className="min-h-11 self-start rounded-lg border border-border px-4 text-sm hover:bg-surface"
            onClick={() => setProgress({ step: progress.step })}
          >
            {td.retry}
          </button>
        </>
      )}
      <button
        type="button"
        disabled={busy}
        className="min-h-11 self-start rounded-lg px-4 text-sm text-muted underline hover:text-foreground"
        onClick={async () => {
          if (!window.confirm(td.returnCancelConfirm)) return;
          setBusy(true);
          await setup({ ws: workspaceId, action: "cancel" });
          setBusy(false);
          window.location.reload();
        }}
      >
        {td.returnCancel}
      </button>
    </section>
  );
}

const MB = 1024 * 1024;
// Supabase's free plan, as in src/lib/team-db/health.ts.
const FREE_DATABASE_MB = 500;
const FREE_STORAGE_MB = 1024;

function HealthLine({ workspaceId, status }: { workspaceId: string; status: NonNullable<TeamDatabaseStatus> }) {
  const td = t.teamDatabase;
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const health = status.health;
  return (
    <div className="flex flex-col gap-1 text-sm" data-team-health={health ?? "unknown"}>
      <p>
        {health ? td.health[health] : td.healthUnknown}
        {status.healthCheckedAt && (
          <span className="text-muted"> ({td.healthChecked(new Date(status.healthCheckedAt).toLocaleString())})</span>
        )}
      </p>
      {status.databaseBytes !== null && (
        <p className="text-muted">
          {td.usage(
            (status.databaseBytes / MB).toFixed(1),
            FREE_DATABASE_MB,
            ((status.storageBytes ?? 0) / MB).toFixed(1),
            FREE_STORAGE_MB,
          )}
        </p>
      )}
      {(health === "almost_full" || health === "full") && <p className="text-muted">{td.fullAdvice}</p>}
      {health === "revoked" && <p className="text-muted">{td.revokedAdvice}</p>}
      <button
        type="button"
        disabled={checking}
        className="min-h-11 self-start rounded-lg border border-border px-4 text-sm hover:bg-surface disabled:opacity-60"
        onClick={async () => {
          setChecking(true);
          await setup({ ws: workspaceId, action: "health" });
          setChecking(false);
          router.refresh();
        }}
      >
        {checking ? td.checking : td.checkNow}
      </button>
    </div>
  );
}
