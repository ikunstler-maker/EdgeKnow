"use client";

import { useState, useTransition } from "react";
import { t } from "@/i18n";
import { checkTeamProject, type CheckStep } from "./actions";
import { Icon } from "@/components/ui/icon";

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2">
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-surface p-3 text-xs">{text}</pre>
      <button
        type="button"
        className="mt-2 min-h-9 rounded-md border border-border px-3 text-sm hover:bg-surface"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? t.settings.general.copied : t.settings.general.copy}
      </button>
    </div>
  );
}

// The private key is created right here in the browser and shown once, for the
// owner to paste into Vercel. It is never sent to our server or stored anywhere else.
function KeyGenerator() {
  const [value, setValue] = useState<string | null>(null);
  const create = async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const { kty, crv, x, y, d } = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    setValue(JSON.stringify([{ kty, crv, x, y, d, kid: crypto.randomUUID() }]));
  };
  return (
    <div className="mt-3">
      <button type="button" onClick={create} className="min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-surface">
        {t.platform.teamLogin.generate}
      </button>
      {value && (
        <>
          <p className="mt-3 text-sm">{t.platform.teamLogin.generated}</p>
          <CopyBlock text={value} />
        </>
      )}
    </div>
  );
}

export function TeamLoginPanel({ configured, issuer, sql }: { configured: boolean; issuer: string; sql: string }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [steps, setSteps] = useState<CheckStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const tl = t.platform.teamLogin;

  return (
    <section className="mt-8 rounded-lg border border-border p-4" aria-labelledby="team-login">
      <h2 id="team-login" className="font-semibold">{tl.heading}</h2>
      <p className="mt-1 text-sm text-muted">{tl.intro}</p>
      {!configured ? (
        <>
          <p className="mt-3 text-sm">{tl.notConfigured}</p>
          <KeyGenerator />
        </>
      ) : (
        <>
          <p className="mt-3 text-sm">{tl.issuer}</p>
          <CopyBlock text={issuer} />
          <p className="mt-4 text-sm">{tl.sqlIntro}</p>
          <CopyBlock text={sql} />
          <form
            className="mt-4 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              setSteps(null);
              startTransition(async () => {
                const result = await checkTeamProject({ url, publishableKey: key });
                if (result.ok) setSteps(result.steps);
                else if (result.error === "invalid_url" || result.error === "invalid_key" || result.error === "secret_key") setError(tl[result.error]);
                else setError(`${tl.failed} ${"detail" in result ? result.detail ?? "" : ""}`);
              });
            }}
          >
            <label className="text-sm">
              {tl.projectUrl}
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxxxxxxxxxxxxxxxxxx.supabase.co" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" />
            </label>
            <label className="text-sm">
              {tl.publishableKey}
              <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="sb_publishable_…" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" />
            </label>
            <button type="submit" disabled={pending} className="min-h-11 self-start rounded-lg border border-border px-4 text-sm hover:bg-surface disabled:opacity-60">
              {pending ? tl.checking : tl.check}
            </button>
          </form>
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
          {steps && (
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {steps.map((step) => (
                <li key={step.id}>
                  <Icon name={step.ok ? "check-circle" : "close"} className={`mr-1.5 inline ${step.ok ? "text-emerald-500" : "text-danger"}`} />
              {tl.steps[step.id]}
                  <span className="block break-all text-xs text-muted">{step.detail}</span>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer">{tl.rotate}</summary>
            <p className="mt-2 text-muted">{tl.rotateHint}</p>
            <KeyGenerator />
          </details>
        </>
      )}
    </section>
  );
}
