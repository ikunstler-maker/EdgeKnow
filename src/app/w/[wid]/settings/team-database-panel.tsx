"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";

export type TeamDatabaseStatus = {
  projectUrl: string | null;
  step: "project" | "schema" | "keys" | "sync" | "sign_in" | "done" | null;
  lastError: string | null;
  schemaVersion: string | null;
  lastSyncedAt: string | null;
} | null;

type Options = {
  organizations: { slug: string; name: string }[];
  projects: { ref: string; name: string; region: string; status: string }[];
};

const STEPS = ["project", "schema", "keys", "sync", "sign_in"] as const;
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
  const [progress, setProgress] = useState<{
    step: string;
    waiting?: string;
    error?: string;
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
    if (!choose || status || hasPages) return;
    void setup({ ws: workspaceId, action: "options" }).then((result) => {
      if (!result.ok) return setError(explain(result.error));
      const next = result as unknown as Options;
      setOptions(next);
      setOrganization(next.organizations[0]?.slug ?? "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choose, status, hasPages, workspaceId]);

  // While setting up: one step every few seconds until done.
  const advance = useCallback(async () => {
    const result = await setup({ ws: workspaceId, action: "advance" });
    setProgress({
      step: String(result.step ?? progress?.step ?? "project"),
      waiting: result.waiting as string | undefined,
      error: result.error as string | undefined,
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
        {status.lastError && (
          <p className="text-sm text-red-600">{status.lastError}</p>
        )}
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
      ) : hasPages ? (
        <p className="text-sm text-muted">{td.hasPages}</p>
      ) : !choose ? (
        <>
          {failed && (
            <p role="alert" className="text-sm text-red-600">
              {td.oauthFailed}
            </p>
          )}
          <a
            href={`/api/supabase/connect?ws=${workspaceId}`}
            className="inline-flex min-h-11 items-center self-start rounded-lg bg-accent px-4 text-sm font-medium text-white hover:opacity-90"
          >
            {td.connect}
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
                ? { ws: workspaceId, action: "create", organization, region }
                : { ws: workspaceId, action: "existing", ref: project },
            );
            setBusy(false);
            if (!result.ok) return setError(explain(result.error));
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
            {busy ? td.starting : td.start}
          </button>
        </form>
      )}
    </section>
  );
}
