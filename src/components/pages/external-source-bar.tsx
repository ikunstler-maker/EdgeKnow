"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import {
  connectExternalSource,
  disconnectExternalSource,
  refreshExternalSource,
  replaceExternalKey,
} from "@/app/external-source-actions";

export type ExternalSourceInfo = {
  host: string;
  syncedAt: string | null;
  lastError: string | null;
  languages: string[];
  lang: string | null;
};

// The reader's chosen language of external pages (set here, read by the server).
export const EXTERNAL_LANG_COOKIE = "external_lang";

function rememberLanguage(lang: string) {
  document.cookie = `${EXTERNAL_LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
}

const button = "min-h-11 rounded-md border border-border bg-background px-3 hover:bg-surface disabled:opacity-60";
const input = "min-h-11 w-full rounded-md border border-border bg-background px-3";

function errorText(code: string) {
  const e = t.pages.external.errors as Record<string, string>;
  return e[code] ?? (code.startsWith("http_") ? `${e.http} (${code.slice(5)})` : e.unknown);
}

// Everyone sees where the text comes from; workspace admins connect, refresh,
// replace the key or disconnect. The key field is write-only.
export function ExternalSourceBar({
  shortId,
  pageId,
  source,
  isAdmin,
}: {
  shortId: string;
  pageId: string;
  source: ExternalSourceInfo | null;
  isAdmin: boolean;
}) {
  const s = t.pages.external;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<null | "connect" | "key">(null);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [languages, setLanguages] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) return setError(errorText(result.error ?? "unknown"));
      setForm(null);
      setKey("");
      router.refresh();
    });

  if (!source && !isAdmin) return null;

  if (!source) {
    if (form !== "connect") {
      return (
        <div className="mb-2 flex justify-end">
          <button type="button" className={`${button} text-sm text-muted`} onClick={() => setForm("connect")}>
            {s.connect}
          </button>
        </div>
      );
    }
    return (
      <form
        className="mb-6 space-y-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => connectExternalSource(shortId, pageId, url, key, languages));
        }}
      >
        <p className="text-muted">{s.connectHint}</p>
        <label className="block space-y-1">
          <span>{s.url}</span>
          <input className={input} type="url" required placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span>{s.languages}</span>
          <input className={input} placeholder="uk, ru" value={languages} onChange={(e) => setLanguages(e.target.value)} />
          <span className="block text-xs text-muted">{s.languagesHint}</span>
        </label>
        <label className="block space-y-1">
          <span>{s.key}</span>
          <input className={input} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        {error && <p className="text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={button}>
            {pending ? s.checking : s.checkAndConnect}
          </button>
          <button type="button" disabled={pending} className={button} onClick={() => setForm(null)}>
            {s.cancel}
          </button>
        </div>
      </form>
    );
  }

  const synced = source.syncedAt
    ? new Date(source.syncedAt).toLocaleString(dateLocale(), { dateStyle: "short", timeStyle: "short" })
    : "—";
  const chooseLanguage = (lang: string) => {
    rememberLanguage(lang);
    router.refresh();
  };
  return (
    <div className="mb-6 space-y-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm">
      {source.languages.length > 1 && (
        <div role="group" aria-label={s.languageSwitch} className="flex flex-wrap gap-1">
          {source.languages.map((lang) => (
            <button
              key={lang}
              type="button"
              aria-pressed={lang === source.lang}
              onClick={() => chooseLanguage(lang)}
              className={`min-h-11 min-w-11 rounded-md border px-3 uppercase ${lang === source.lang ? "border-foreground font-semibold" : "border-border bg-background hover:bg-surface"}`}
            >
              {lang}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1">
          {s.banner.replace("{host}", source.host)} · {s.synced.replace("{time}", synced)}
          {source.lastError && <span className="text-danger"> · {s.lastCopy}: {errorText(source.lastError)}</span>}
        </span>
        {isAdmin && (
          <>
            <button type="button" disabled={pending} className={button} onClick={() => run(() => refreshExternalSource(shortId, pageId))}>
              {pending ? s.checking : s.refresh}
            </button>
            <button type="button" disabled={pending} className={button} onClick={() => setForm(form === "key" ? null : "key")}>
              {s.replaceKey}
            </button>
            <button
              type="button"
              disabled={pending}
              className={button}
              onClick={() => confirm(s.disconnectConfirm) && run(() => disconnectExternalSource(shortId, pageId))}
            >
              {s.disconnect}
            </button>
          </>
        )}
      </div>
      {form === "key" && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => replaceExternalKey(shortId, pageId, key));
          }}
        >
          <input className={`${input} flex-1`} type="password" autoComplete="off" placeholder={s.key} value={key} onChange={(e) => setKey(e.target.value)} />
          <button type="submit" disabled={pending} className={button}>
            {s.save}
          </button>
        </form>
      )}
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}
