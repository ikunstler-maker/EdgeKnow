"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EXTERNAL_LANG_COOKIE } from "@/lib/external-lang";
import { dateLocale, t } from "@/i18n";
import { Icon } from "@/components/ui/icon";
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


function rememberLanguage(lang: string) {
  document.cookie = `${EXTERNAL_LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
}

const button = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";
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
        <button type="button" className={`${button} mr-auto`} onClick={() => setForm("connect")}>
          <Icon name="link" />
          {s.connect}
        </button>
      );
    }
    return (
      <form
        className="order-last mt-1 basis-full space-y-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm"
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
    <div className="mr-auto flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted" data-external-source>
      {source.languages.length > 1 && (
        <div role="group" aria-label={s.languageSwitch} className="inline-flex rounded-lg border border-border bg-hover p-0.5">
          {source.languages.map((lang) => (
            <button
              key={lang}
              type="button"
              aria-pressed={lang === source.lang}
              onClick={() => chooseLanguage(lang)}
              className={`min-h-10 min-w-10 rounded-md px-2 text-[13px] font-medium uppercase md:h-7 md:min-h-0 md:min-w-8 ${lang === source.lang ? "bg-background text-foreground shadow-sm" : "hover:text-foreground"}`}
            >
              {lang}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Icon name="globe" size={14} />
        <span className="min-w-0">
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
          className="flex basis-full flex-wrap gap-2"
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
      {error && <p className="basis-full text-danger">{error}</p>}
    </div>
  );
}
