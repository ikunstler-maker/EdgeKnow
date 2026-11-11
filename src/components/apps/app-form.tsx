"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { APP_LIMITS, LOGO_TYPES, appLogoSrc, cleanAppUrl, type AppData } from "@/lib/apps";
import { workspacePath } from "@/lib/paths";
import { createApp, deleteAppForever, readAppLink, saveApp, trashApp } from "@/app/app-actions";
import { AppLogo } from "./app-logo";

const f = t.apps.form;
const errorText = (code: string) => t.apps.errors[code] ?? t.common.unknownError;
const inputClass = "min-h-11 w-full rounded-md border border-border bg-background px-3 text-base md:min-h-9 md:text-sm";
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";
const primaryClass = "inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60 md:min-h-9";

// Sends a logo picture to the app (owners and admins; checked again on the server).
async function uploadLogo(shortId: string, appId: string, file: File): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!LOGO_TYPES.includes(file.type)) return { ok: false, error: "invalid_file" };
  if (file.size > APP_LIMITS.logoBytes) return { ok: false, error: "too_large" };
  const query = new URLSearchParams({ ws: shortId, app: appId, name: file.name.slice(0, 200) });
  const response = await fetch(`/api/apps/logo?${query}`, { method: "POST", headers: { "Content-Type": file.type }, body: file }).catch(() => null);
  const body = (await response?.json().catch(() => null)) as { ok?: boolean; id?: string; error?: string } | null;
  return body?.ok && body.id ? { ok: true, id: body.id } : { ok: false, error: body?.error ?? "unknown" };
}

type Saved = { id: string; version: number };

// The fields of one app. A new app is created on submit (a chosen logo is uploaded
// right after); an existing one saves all fields at once.
export function AppForm({
  shortId,
  saved,
  initialTitle = "",
  initial = { url: "" },
  categories,
  onDone,
  onCancel,
}: {
  shortId: string;
  saved: Saved | null;
  initialTitle?: string;
  initial?: AppData;
  categories: string[];
  onDone: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const ids = useId();
  const [url, setUrl] = useState(initial.url);
  const [title, setTitle] = useState(initialTitle);
  const [category, setCategory] = useState(initial.category ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [logo, setLogo] = useState(initial.logo ?? "");
  const [logoFile, setLogoFile] = useState(initial.logoFile ?? "");
  // A logo chosen before the app exists, with its local preview address.
  const [pendingLogo, setPendingLogo] = useState<{ file: File; preview: string } | null>(null);
  const [version, setVersion] = useState(saved?.version ?? 0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [fetching, startFetching] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastRead = useRef(initial.url);

  const pendingFile = pendingLogo?.file ?? null;
  const preview = pendingLogo?.preview ?? null;
  const setPendingFile = (file: File | null) => {
    if (pendingLogo) URL.revokeObjectURL(pendingLogo.preview);
    setPendingLogo(file ? { file, preview: URL.createObjectURL(file) } : null);
  };

  // Reads the name, description and logo from the site; filled fields the person
  // already typed are kept unless the link is read on request.
  const readLink = (force: boolean) => {
    const clean = cleanAppUrl(url);
    if (!clean) return setError(errorText("invalid_url"));
    if (!force && clean === lastRead.current) return;
    lastRead.current = clean;
    setError(null);
    startFetching(async () => {
      const result = await readAppLink(clean);
      if (!result.ok) return setNote(result.error === "invalid_url" ? null : f.notFetched);
      setUrl(result.url);
      // Fields typed while the site was being read are kept.
      setTitle((old) => (force || !old.trim() ? result.title || old : old));
      setDescription((old) => (force || !old.trim() ? result.description || old : old));
      if ((force || (!logo && !logoFile && !pendingFile)) && result.logo) {
        setLogo(result.logo);
        setLogoFile("");
        setPendingFile(null);
      }
      setNote(result.title || result.description || result.logo ? f.fetched : f.notFetched);
    });
  };

  const chooseLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return setError(errorText("invalid_file"));
    if (file.size > APP_LIMITS.logoBytes) return setError(errorText("too_large"));
    setError(null);
    if (!saved) {
      setPendingFile(file);
      return;
    }
    setUploading(true);
    const result = await uploadLogo(shortId, saved.id, file);
    setUploading(false);
    if (!result.ok) return setError(errorText(result.error));
    setLogoFile(result.id);
    setLogo("");
  };

  const data = (): AppData => ({ url: url.trim(), logo: logo || undefined, logoFile: logoFile || undefined, category, description });

  const submit = () => {
    const clean = cleanAppUrl(url);
    if (!clean) return setError(errorText("invalid_url"));
    setError(null);
    startTransition(async () => {
      if (saved) {
        const result = await saveApp(shortId, saved.id, title, data(), version);
        if (!result.ok) return setError(errorText(result.error));
        setVersion(result.version);
        setNote(f.saved);
        router.refresh();
        return onDone();
      }
      const made = await createApp(shortId, title, data());
      if (!made.ok) return setError(errorText(made.error));
      if (pendingFile) {
        const uploaded = await uploadLogo(shortId, made.id, pendingFile);
        if (uploaded.ok) await saveApp(shortId, made.id, title, { ...data(), logo: undefined, logoFile: uploaded.id }, 1);
        else setError(errorText(uploaded.error));
      }
      router.refresh();
      onDone();
    });
  };

  const logoSrc = preview ?? appLogoSrc(shortId, { url, logo: logo || undefined, logoFile: logoFile || undefined });
  const busy = pending || uploading;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      data-app-form
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{f.url}</span>
        <span className="flex flex-wrap gap-2">
          <input
            type="url"
            inputMode="url"
            required
            maxLength={APP_LIMITS.url}
            value={url}
            placeholder={f.urlPlaceholder}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => url.trim() && readLink(false)}
            className={`${inputClass} min-w-0 flex-1`}
            data-app-url
            autoFocus={!saved}
          />
          <button type="button" disabled={fetching || !url.trim()} onClick={() => readLink(true)} className={buttonClass} data-app-fetch>
            {fetching ? f.fetching : f.fetch}
          </button>
        </span>
      </label>
      {note && (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <AppLogo src={logoSrc} name={title || url.replace(/^https?:\/\/(www\.)?/, "")} size={64} />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{f.logo}</span>
          <span className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={buttonClass} data-app-logo-upload>
              {uploading ? f.logoUploading : f.logoUpload}
            </button>
            {(logo || logoFile || pendingFile) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setLogo("");
                  setLogoFile("");
                  setPendingFile(null);
                }}
                className={buttonClass}
              >
                {f.logoRemove}
              </button>
            )}
          </span>
          <span className="text-xs text-muted">{f.logoHint}</span>
          <input
            ref={fileInput}
            type="file"
            accept={LOGO_TYPES.join(",")}
            className="hidden"
            onChange={(event) => {
              void chooseLogo(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{f.name}</span>
        <input value={title} maxLength={APP_LIMITS.title} onChange={(event) => setTitle(event.target.value)} className={inputClass} data-app-title />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{f.category}</span>
        <input
          value={category}
          maxLength={APP_LIMITS.category}
          list={`${ids}-categories`}
          placeholder={f.categoryPlaceholder}
          onChange={(event) => setCategory(event.target.value)}
          className={inputClass}
          data-app-category
        />
        <datalist id={`${ids}-categories`}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{f.description}</span>
        <textarea
          value={description}
          maxLength={APP_LIMITS.description}
          rows={3}
          onChange={(event) => setDescription(event.target.value)}
          className={`${inputClass} py-2`}
          data-app-description
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className={buttonClass}>
            {f.cancel}
          </button>
        )}
        <button type="submit" disabled={busy} className={primaryClass} data-app-save>
          {pending ? f.saving : saved ? f.save : f.create}
        </button>
      </div>
    </form>
  );
}

// "Add app" on the gallery (owners and admins): the form in a dialog.
export function NewAppButton({ shortId, categories }: { shortId: string; categories: string[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primaryClass} data-app-add>
        {t.apps.add}
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={f.newTitle}
              onClick={(event) => event.stopPropagation()}
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-background p-4 shadow-xl sm:rounded-xl"
            >
              <h2 className="mb-3 text-lg font-semibold">{f.newTitle}</h2>
              <AppForm shortId={shortId} saved={null} categories={categories} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function AppTrashButton({ shortId, id }: { shortId: string; id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await trashApp(shortId, id);
            if (!result.ok) return setError(errorText(result.error));
            router.push(workspacePath(shortId, "/apps"));
          })
        }
        className={`${buttonClass} text-danger`}
      >
        {t.apps.toBin}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}

export function AppBinActions({ shortId, id, title }: { shortId: string; id: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<unknown>) =>
    startTransition(async () => {
      await action();
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={pending} onClick={() => run(() => trashApp(shortId, id, true))} className={buttonClass}>
        {t.apps.restore}
      </button>
      <button type="button" disabled={pending} onClick={() => confirm(t.apps.deleteForeverConfirm(title)) && run(() => deleteAppForever(shortId, id))} className={`${buttonClass} text-danger`}>
        {t.apps.deleteForever}
      </button>
    </div>
  );
}
