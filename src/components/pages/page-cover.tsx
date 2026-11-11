"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";
import { directImageUrl, isExternalImageUrl, resolveAttachmentUrl, uploadImage, UploadError } from "@/lib/attachments";
import { COVER_COLORS, GRADIENT_PRESETS, gradientCss, parseCover, type Cover, type GradientStop } from "@/lib/cover";
import { ImageError } from "@/lib/image-compression";
import { setPageCover } from "@/app/page-actions";
import { Icon } from "@/components/ui/icon";

const cv = t.cover;
type Gradient = Extract<Cover, { type: "gradient" }>;

function CoverImage({ url, y }: { url: string; y: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void resolveAttachmentUrl(url).then((resolved) => alive && setSrc(resolved || null));
    return () => {
      alive = false;
    };
  }, [url]);
  if (!src) return <div className="h-full w-full bg-surface" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- signed or external URLs, not ours to optimise
    <img src={src} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" style={{ objectPosition: `50% ${y}%` }} />
  );
}

export function CoverBackground({ cover }: { cover: Cover }) {
  if (cover.type === "image") return <CoverImage url={cover.url} y={cover.y} />;
  const background = cover.type === "color" ? cover.color : gradientCss(cover);
  return <div className="h-full w-full" style={{ background }} />;
}

// The band above the title. Editors add, change, move or remove it.
export function PageCover({ pageId, initialCover, editable }: { pageId: string; initialCover: unknown; editable: boolean }) {
  const [cover, setCover] = useState<Cover | null>(() => parseCover(initialCover));
  const [picker, setPicker] = useState(false);
  const [repositioning, setRepositioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (next: Cover | null) => {
    const previous = cover;
    setCover(next);
    setError(null);
    startTransition(async () => {
      const result = await setPageCover(pageId, next);
      if (!result.ok) {
        setCover(previous);
        setError(t.pages.errors[result.error] ?? cv.errors[result.error] ?? t.common.unknownError);
      }
    });
  };

  const buttonClass =
    "min-h-9 rounded-md bg-background/85 px-2.5 text-xs font-medium text-foreground shadow-sm backdrop-blur hover:bg-background";

  return (
    <>
      {cover ? (
        <div className="group relative h-[22vh] max-h-72 min-h-32 w-full overflow-hidden" data-testid="page-cover">
          <CoverBackground cover={cover} />
          {editable && (
            <div className="absolute bottom-2 right-3 flex gap-1.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
              <button type="button" onClick={() => setPicker(true)} className={buttonClass} disabled={pending}>
                {cv.change}
              </button>
              {cover.type === "image" && (
                <button type="button" onClick={() => setRepositioning(!repositioning)} className={buttonClass} aria-pressed={repositioning}>
                  {cv.reposition}
                </button>
              )}
              <button type="button" onClick={() => save(null)} className={buttonClass} disabled={pending}>
                {cv.remove}
              </button>
            </div>
          )}
          {repositioning && cover.type === "image" && (
            <label className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-background/90 px-2 py-1 text-xs shadow-sm">
              {cv.position}
              <input
                type="range"
                min={0}
                max={100}
                value={cover.y}
                onChange={(event) => setCover({ ...cover, y: Number(event.target.value) })}
                onPointerUp={() => save(cover)}
                onKeyUp={() => save(cover)}
                aria-label={cv.position}
              />
            </label>
          )}
        </div>
      ) : (
        editable && (
          <div className="mx-auto w-full max-w-3xl px-4 pt-4 md:px-12 xl:max-w-6xl">
            <button
              type="button"
              onClick={() => setPicker(true)}
              className="min-h-9 rounded-md px-2 text-sm text-muted hover:bg-surface hover:text-foreground"
            >
              <Icon name="image" className="mr-1 inline" />
              {cv.add}
            </button>
          </div>
        )
      )}
      {error && (
        <p role="alert" className="mx-auto mt-2 w-full max-w-3xl px-4 text-sm text-danger md:px-12 xl:max-w-6xl">
          {error}
        </p>
      )}
      {picker && (
        <CoverPicker
          pageId={pageId}
          current={cover}
          onPick={(next) => {
            save(next);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </>
  );
}

function CoverPicker({
  pageId,
  current,
  onPick,
  onClose,
}: {
  pageId: string;
  current: Cover | null;
  onPick: (cover: Cover) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"color" | "gradient" | "image">(current?.type ?? "gradient");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const tabClass = (active: boolean) =>
    `min-h-9 flex-1 rounded px-2 text-sm ${active ? "bg-background font-medium shadow-sm" : "text-muted hover:text-foreground"}`;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={cv.title}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-xl bg-background shadow-xl sm:rounded-xl"
      >
        <div className="flex items-center border-b border-border px-4 py-2">
          <h2 className="flex-1 font-semibold">{cv.title}</h2>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="min-h-11 min-w-11">
            <Icon name="close" />
          </button>
        </div>
        <div className="p-3">
          <div role="tablist" aria-label={cv.title} className="flex gap-1 rounded-md bg-surface p-1">
            {(["image", "color", "gradient"] as const).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={tabClass(tab === value)}>
                {cv.tabs[value]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {tab === "color" && <ColorTab current={current?.type === "color" ? current.color : null} onPick={onPick} />}
          {tab === "gradient" && <GradientTab initial={current?.type === "gradient" ? current : GRADIENT_PRESETS[0]} onPick={onPick} />}
          {tab === "image" && <ImageTab pageId={pageId} onPick={onPick} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ColorTab({ current, onPick }: { current: string | null; onPick: (cover: Cover) => void }) {
  const [custom, setCustom] = useState(current ?? "#2f6feb");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label={cv.palette}>
        {COVER_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            onClick={() => onPick({ type: "color", color })}
            className={`h-10 w-10 rounded-lg border border-border ${current === color ? "outline outline-2 outline-offset-2 outline-[var(--accent)]" : ""}`}
            style={{ background: color }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          {cv.customColor}
          <input type="color" value={custom} onChange={(event) => setCustom(event.target.value)} className="h-10 w-14 cursor-pointer rounded border border-border bg-background" />
        </label>
        <button type="button" onClick={() => onPick({ type: "color", color: custom })} className="ml-auto min-h-10 rounded-md bg-accent px-3 text-sm font-medium text-white">
          {cv.apply}
        </button>
      </div>
    </div>
  );
}

function GradientTab({ initial, onPick }: { initial: Gradient; onPick: (cover: Cover) => void }) {
  const [gradient, setGradient] = useState<Gradient>(initial);
  const setStop = (i: number, patch: Partial<GradientStop>) =>
    setGradient({ ...gradient, stops: gradient.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="space-y-4">
      <div className="h-24 w-full overflow-hidden rounded-lg border border-border" aria-label={cv.preview} role="img">
        <CoverBackground cover={gradient} />
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={cv.presets}>
        {GRADIENT_PRESETS.map((preset, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${cv.preset} ${i + 1}`}
            onClick={() => setGradient(preset)}
            className="h-9 w-14 overflow-hidden rounded-md border border-border"
          >
            <CoverBackground cover={preset} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div role="radiogroup" aria-label={cv.kind} className="flex gap-1 rounded-md bg-surface p-1">
          {(["linear", "radial"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={gradient.kind === kind}
              onClick={() => setGradient({ ...gradient, kind })}
              className={`min-h-8 rounded px-2 ${gradient.kind === kind ? "bg-background font-medium shadow-sm" : "text-muted"}`}
            >
              {cv.kinds[kind]}
            </button>
          ))}
        </div>
        {gradient.kind === "linear" && (
          <label className="flex flex-1 items-center gap-2">
            {cv.angle}
            <input
              type="range"
              min={0}
              max={359}
              value={gradient.angle}
              onChange={(event) => setGradient({ ...gradient, angle: Number(event.target.value) })}
              className="flex-1"
            />
            <span className="w-10 text-right tabular-nums">{gradient.angle}°</span>
          </label>
        )}
      </div>
      <ul className="space-y-2" aria-label={cv.stops}>
        {gradient.stops.map((stop, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <input
              type="color"
              value={stop.color}
              aria-label={cv.stopColor(i + 1)}
              onChange={(event) => setStop(i, { color: event.target.value })}
              className="h-9 w-12 cursor-pointer rounded border border-border bg-background"
            />
            <input
              type="range"
              min={0}
              max={100}
              value={stop.at}
              aria-label={cv.stopPosition(i + 1)}
              onChange={(event) => setStop(i, { at: Number(event.target.value) })}
              className="flex-1"
            />
            <span className="w-10 text-right tabular-nums">{stop.at}%</span>
            <button
              type="button"
              aria-label={cv.removeStop}
              disabled={gradient.stops.length <= 2}
              onClick={() => setGradient({ ...gradient, stops: gradient.stops.filter((_, j) => j !== i) })}
              className="h-9 w-9 rounded-md text-muted hover:bg-surface disabled:opacity-30"
            >
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={gradient.stops.length >= 4}
          onClick={() => setGradient({ ...gradient, stops: [...gradient.stops, { color: "#ffffff", at: 50 }] })}
          className="min-h-10 rounded-md border border-dashed border-border px-3 text-sm text-muted hover:bg-surface disabled:opacity-50"
        >
          <Icon name="plus" className="mr-1 inline" />
          {cv.addStop}
        </button>
        <button type="button" onClick={() => onPick(gradient)} className="ml-auto min-h-10 rounded-md bg-accent px-3 text-sm font-medium text-white">
          {cv.apply}
        </button>
      </div>
    </div>
  );
}

function ImageTab({ pageId, onPick }: { pageId: string; onPick: (cover: Cover) => void }) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await uploadImage(pageId, file);
      onPick({ type: "image", url, y: 50 });
    } catch (err) {
      const code = err instanceof ImageError || err instanceof UploadError ? err.message : "upload_failed";
      setError(t.editor.image.errors[code] ?? t.editor.image.errors.upload_failed);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-4 text-center text-sm hover:bg-surface">
        <span>{busy ? cv.uploading : cv.upload}</span>
        <span className="text-xs text-muted">{cv.uploadHint}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={busy}
          aria-label={cv.upload}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = directImageUrl(link);
          if (value === "drive_folder") return setError(t.editor.image.errors.drive_folder);
          if (!isExternalImageUrl(value) || /["'<>()\\\s]/.test(value)) return setError(t.editor.image.errors.link_https);
          onPick({ type: "image", url: value, y: 50 });
        }}
      >
        <label className="block text-sm">
          {cv.byLink}
          <input
            type="url"
            inputMode="url"
            value={link}
            placeholder="https://…"
            onChange={(event) => {
              setLink(event.target.value);
              setError(null);
            }}
            className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2 text-base md:text-sm"
          />
        </label>
        <button type="submit" disabled={!link.trim()} className="min-h-10 rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-60">
          {cv.apply}
        </button>
        <p className="text-xs text-muted">{t.editor.image.linkHint}</p>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
