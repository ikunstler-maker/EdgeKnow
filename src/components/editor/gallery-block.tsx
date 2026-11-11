"use client";

import { use, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createReactBlockSpec } from "@blocknote/react";
import { t } from "@/i18n";
import { ATTACHMENT_SCHEME, AUDIO_ACCEPT, UploadError, isExternalImageUrl, uploadAudio, uploadImage } from "@/lib/attachments";
import { ImageError } from "@/lib/image-compression";
import { parseYouTubeUrl, youTubeEmbedUrl, youTubeThumbnailUrl, youTubeWatchUrl } from "@/lib/youtube";
import { EditorPageContext } from "./navigation-block";
import { fetchYouTubeInfo } from "./youtube-block";
import { Icon } from "@/components/ui/icon";

const g = t.editor.gallery;
const MAX_ITEMS = 50;
const LAYOUTS = ["featured", "carousel", "list", "grid"] as const;
type Layout = (typeof LAYOUTS)[number];
type Item = { id: string; kind: "image" | "youtube" | "audio"; url: string; caption: string; title?: string };
type Props = { items: string; layout: string; thumbs: string; size: string };

const parseItems = (raw: string): Item[] => {
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list.filter((x) => x && typeof x.url === "string" && ["image", "youtube", "audio"].includes(x.kind)).slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
};
const newId = () => Math.random().toString(36).slice(2, 10);

// Where a file is shown from: our own files through our server (it checks access),
// images by https link as they are; nothing else.
function source(url: string) {
  if (url.startsWith(ATTACHMENT_SCHEME)) return `/api/files/${url.slice(ATTACHMENT_SCHEME.length)}`;
  return isExternalImageUrl(url) ? url : "";
}
const label = (item: Item) => item.caption || item.title || g.kinds[item.kind];

// A gallery (wiki): images, YouTube videos and audio, shown in one of four layouts.
export const galleryBlock = createReactBlockSpec(
  {
    type: "gallery",
    propSchema: {
      items: { default: "[]" },
      layout: { default: "featured" },
      thumbs: { default: "true" },
      size: { default: "160" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <GalleryView props={block.props as Props} editable={editor.isEditable} onChange={(props) => editor.updateBlock(block, { props: { ...block.props, ...props } })} />
    ),
  },
);

function GalleryView({ props, editable, onChange }: { props: Props; editable: boolean; onChange: (props: Partial<Props>) => void }) {
  const items = parseItems(props.items);
  const layout: Layout = (LAYOUTS as readonly string[]).includes(props.layout) ? (props.layout as Layout) : "featured";
  const size = Math.min(320, Math.max(80, Number(props.size) || 160));
  const [lightbox, setLightbox] = useState<number | null>(null);
  const save = (next: Item[]) => onChange({ items: JSON.stringify(next.slice(0, MAX_ITEMS)) });
  const open = (index: number) => setLightbox(index);

  return (
    <div className="ek-gallery my-2 w-full rounded-xl border border-border p-2" contentEditable={false} data-gallery={layout}>
      {editable && <GalleryToolbar props={props} layout={layout} size={size} items={items} onChange={onChange} save={save} />}
      {items.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted">{editable ? g.empty : g.emptyReader}</p>
      ) : layout === "featured" ? (
        <Featured items={items} onOpen={open} />
      ) : layout === "carousel" ? (
        <Carousel items={items} onOpen={open} />
      ) : layout === "list" ? (
        <List items={items} thumbs={props.thumbs !== "false"} onOpen={open} />
      ) : (
        <Grid items={items} size={size} onOpen={open} />
      )}
      {lightbox !== null && items[lightbox] && <Lightbox items={items} start={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function GalleryToolbar({ props, layout, size, items, onChange, save }: { props: Props; layout: Layout; size: number; items: Item[]; onChange: (p: Partial<Props>) => void; save: (items: Item[]) => void }) {
  const { pageId } = use(EditorPageContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const button = "min-h-11 rounded-md border border-border px-2 text-sm hover:bg-surface md:min-h-9";

  const add = (more: Item[]) => {
    if (items.length + more.length > MAX_ITEMS) setError(g.tooMany);
    save([...items, ...more]);
  };
  const upload = async (files: FileList | null, kind: "image" | "audio") => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const added: Item[] = [];
    for (const file of [...files].slice(0, MAX_ITEMS - items.length)) {
      try {
        const url = kind === "image" ? (await uploadImage(pageId, file)).url : await uploadAudio(pageId, file);
        added.push({ id: newId(), kind, url, caption: "", title: file.name.replace(/\.[^.]+$/, "") });
      } catch (e) {
        const code = e instanceof ImageError || e instanceof UploadError ? e.message : "upload_failed";
        setError((kind === "audio" ? g.audioErrors[code] : undefined) ?? t.editor.image.errors[code] ?? t.editor.image.errors.upload_failed);
      }
    }
    if (added.length) add(added);
    setBusy(false);
  };
  const byLink = async (kind: "image" | "youtube") => {
    const url = prompt(kind === "image" ? g.imageLinkPrompt : g.youtubePrompt)?.trim();
    if (!url) return;
    if (kind === "image") {
      if (!isExternalImageUrl(url)) return setError(g.invalidLink);
      return add([{ id: newId(), kind, url, caption: "" }]);
    }
    const ref = parseYouTubeUrl(url);
    if (!ref) return setError(g.invalidLink);
    const info = await fetchYouTubeInfo(url);
    add([{ id: newId(), kind, url: youTubeWatchUrl(ref), caption: "", title: info.title ?? "" }]);
  };
  const move = (index: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
    save(next);
  };

  return (
    <div className="mb-2 space-y-2 text-sm" data-gallery-toolbar>
      <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={g.layout}>
        {LAYOUTS.map((value) => (
          <button key={value} type="button" role="radio" aria-checked={layout === value} onClick={() => onChange({ layout: value })} className={`${button} ${layout === value ? "bg-surface font-medium" : "text-muted"}`} data-gallery-layout={value}>
            {g.layouts[value]}
          </button>
        ))}
        {layout === "list" && (
          <label className="ml-2 flex min-h-9 items-center gap-1 text-muted">
            <input type="checkbox" checked={props.thumbs !== "false"} onChange={(e) => onChange({ thumbs: String(e.target.checked) })} />
            {g.thumbnails}
          </label>
        )}
        {layout === "grid" && (
          <label className="ml-2 flex min-h-9 items-center gap-2 text-muted">
            {g.size}
            <input type="range" min={80} max={320} step={20} value={size} onChange={(e) => onChange({ size: e.target.value })} data-gallery-size />
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" disabled={busy} onClick={() => imageInput.current?.click()} className={button} data-gallery-add="image">
          {g.addImage}
        </button>
        <button type="button" disabled={busy} onClick={() => byLink("image")} className={button}>
          {g.addImageLink}
        </button>
        <button type="button" disabled={busy} onClick={() => byLink("youtube")} className={button} data-gallery-add="youtube">
          {g.addYouTube}
        </button>
        <button type="button" disabled={busy} onClick={() => audioInput.current?.click()} className={button} data-gallery-add="audio">
          {g.addAudio}
        </button>
        {items.length > 0 && (
          <button type="button" onClick={() => setEditing(!editing)} aria-expanded={editing} className={`${button} ml-auto`}>
            <Icon name="edit" className="mr-1 inline" />
            {g.edit} ({items.length})
          </button>
        )}
        <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => (upload(e.target.files, "image"), (e.target.value = ""))} data-gallery-file="image" />
        <input ref={audioInput} type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={(e) => (upload(e.target.files, "audio"), (e.target.value = ""))} data-gallery-file="audio" />
      </div>
      {busy && <p className="text-muted">{g.uploading}</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {editing && (
        <ul className="space-y-1" data-gallery-items>
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2 rounded-md border border-border p-1">
              <Thumb item={item} className="h-10 w-14 shrink-0" />
              <input
                defaultValue={item.caption}
                placeholder={item.title || g.caption}
                aria-label={g.caption}
                maxLength={200}
                onBlur={(e) => e.target.value !== item.caption && save(items.map((x) => (x.id === item.id ? { ...x, caption: e.target.value } : x)))}
                className="min-h-9 min-w-0 flex-1 rounded border border-border bg-background px-2"
              />
              <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={g.up} className="min-h-9 min-w-9 disabled:opacity-30">
                <Icon name="arrow-up" />
              </button>
              <button type="button" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label={g.down} className="min-h-9 min-w-9 disabled:opacity-30">
                <Icon name="arrow-down" />
              </button>
              <button type="button" onClick={() => save(items.filter((x) => x.id !== item.id))} aria-label={g.remove} className="min-h-9 min-w-9 text-danger">
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A small picture for an item: the image, the video's cover, or a note for audio.
function Thumb({ item, className = "" }: { item: Item; className?: string }) {
  const ref = item.kind === "youtube" ? parseYouTubeUrl(item.url) : null;
  const src = item.kind === "image" ? source(item.url) : ref ? youTubeThumbnailUrl(ref) : null;
  return (
    <span className={`relative flex items-center justify-center overflow-hidden rounded-md bg-surface ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- our own files or links, sized by the layout
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden className="text-2xl">
          <Icon name="play" />
        </span>
      )}
      {item.kind === "youtube" && (
        <span aria-hidden className="absolute rounded-full bg-black/60 px-2 text-sm text-white">
          <Icon name="play" />
        </span>
      )}
    </span>
  );
}

// One item at full size: a picture (opens full screen), a video (plays on click) or an audio player.
function Viewer({ item, onOpen, tall = false }: { item: Item; onOpen: () => void; tall?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const ref = item.kind === "youtube" ? parseYouTubeUrl(item.url) : null;
  if (item.kind === "audio") {
    return (
      <figure className="flex flex-col gap-2 rounded-lg bg-surface p-4" data-gallery-audio>
        <figcaption className="font-medium"><Icon name="play" className="mr-1 inline" />{label(item)}</figcaption>
        {/* Only our own audio files play; anything else shows just its name. */}
        {item.url.startsWith(ATTACHMENT_SCHEME) && <audio controls preload="metadata" src={source(item.url)} className="w-full" />}
      </figure>
    );
  }
  if (ref) {
    return playing ? (
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
        <iframe src={youTubeEmbedUrl(ref)} title={label(item)} className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
      </div>
    ) : (
      <button type="button" onClick={() => setPlaying(true)} aria-label={`${g.play}: ${label(item)}`} className="relative block aspect-video w-full overflow-hidden rounded-lg bg-black">
        <Thumb item={item} className="h-full w-full" />
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen} aria-label={`${g.open}: ${label(item)}`} className="block w-full overflow-hidden rounded-lg bg-surface">
      {/* eslint-disable-next-line @next/next/no-img-element -- our own files or links */}
      <img src={source(item.url)} alt={item.caption} loading="lazy" referrerPolicy="no-referrer" className={`mx-auto w-full object-contain ${tall ? "max-h-[70vh]" : "max-h-[28rem]"}`} />
    </button>
  );
}

function Caption({ item }: { item: Item }) {
  return item.caption ? <p className="mt-1 text-center text-sm text-muted">{item.caption}</p> : null;
}

function Featured({ items, onOpen }: { items: Item[]; onOpen: (i: number) => void }) {
  const [current, setCurrent] = useState(0);
  const at = Math.min(current, items.length - 1);
  return (
    <div>
      <Viewer key={items[at].id} item={items[at]} onOpen={() => onOpen(at)} />
      <Caption item={items[at]} />
      {items.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" data-gallery-strip>
          {items.map((item, i) => (
            <button key={item.id} type="button" onClick={() => setCurrent(i)} aria-label={label(item)} aria-current={i === at} className={`shrink-0 rounded-md ring-offset-2 ${i === at ? "ring-2 ring-accent" : "opacity-80 hover:opacity-100"}`}>
              <Thumb item={item} className="h-14 w-20" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Carousel({ items, onOpen }: { items: Item[]; onOpen: (i: number) => void }) {
  const [current, setCurrent] = useState(0);
  const at = Math.min(current, items.length - 1);
  const start = useRef<number | null>(null);
  const go = (by: number) => setCurrent((at + by + items.length) % items.length);
  const arrow = "absolute top-1/2 z-10 -translate-y-1/2 min-h-11 min-w-11 rounded-full bg-black/50 text-xl text-white hover:bg-black/70";
  return (
    <div
      className="relative"
      onPointerDown={(e) => (start.current = e.clientX)}
      onPointerUp={(e) => {
        if (start.current !== null && Math.abs(e.clientX - start.current) > 50) go(e.clientX < start.current ? 1 : -1);
        start.current = null;
      }}
      data-gallery-carousel
    >
      <Viewer key={items[at].id} item={items[at]} onOpen={() => onOpen(at)} />
      <Caption item={items[at]} />
      {items.length > 1 && (
        <>
          <button type="button" onClick={() => go(-1)} aria-label={g.previous} className={`${arrow} left-2`}>
            <Icon name="chevron-left" />
          </button>
          <button type="button" onClick={() => go(1)} aria-label={g.next} className={`${arrow} right-2`}>
            <Icon name="chevron-right" />
          </button>
          <p className="mt-1 text-center text-xs text-muted" aria-live="polite" data-gallery-position>
            {g.position(at + 1, items.length)}
          </p>
        </>
      )}
    </div>
  );
}

function List({ items, thumbs, onOpen }: { items: Item[]; thumbs: boolean; onOpen: (i: number) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-border" data-gallery-list>
      {items.map((item, i) => (
        <li key={item.id} className="py-1">
          <button type="button" onClick={() => (item.kind === "image" ? onOpen(i) : setOpen(open === item.id ? null : item.id))} aria-expanded={item.kind === "image" ? undefined : open === item.id} className="flex min-h-11 w-full items-center gap-3 rounded-md px-1 text-left hover:bg-surface">
            {thumbs ? <Thumb item={item} className="h-10 w-14 shrink-0" /> : <Icon name={item.kind === "image" ? "image" : "play"} className="text-muted" />}
            <span className="min-w-0 flex-1 truncate">{label(item)}</span>
            <span className="text-xs text-muted">{g.kinds[item.kind]}</span>
          </button>
          {open === item.id && (
            <div className="mt-1">
              <Viewer item={item} onOpen={() => onOpen(i)} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Grid({ items, size, onOpen }: { items: Item[]; size: number; onOpen: (i: number) => void }) {
  return (
    <div style={{ columnWidth: `${size}px`, columnGap: "0.5rem" }} data-gallery-grid>
      {items.map((item, i) => (
        <figure key={item.id} className="mb-2 break-inside-avoid">
          {item.kind === "image" ? (
            <button type="button" onClick={() => onOpen(i)} aria-label={`${g.open}: ${label(item)}`} className="block w-full overflow-hidden rounded-md">
              {/* eslint-disable-next-line @next/next/no-img-element -- our own files or links */}
              <img src={source(item.url)} alt={item.caption} loading="lazy" referrerPolicy="no-referrer" className="w-full" />
            </button>
          ) : (
            <Viewer item={item} onOpen={() => onOpen(i)} />
          )}
          {item.caption && <figcaption className="mt-0.5 text-xs text-muted">{item.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

// Full screen, with the arrows and swipes going through the gallery.
function Lightbox({ items, start, onClose }: { items: Item[]; start: number; onClose: () => void }) {
  const [at, setAt] = useState(start);
  const go = (by: number) => setAt((i) => (i + by + items.length) % items.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setAt((i) => (i + 1) % items.length);
      if (e.key === "ArrowLeft") setAt((i) => (i - 1 + items.length) % items.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [items.length, onClose]);
  const item = items[at];
  const arrow = "min-h-11 min-w-11 rounded-full bg-white/15 text-2xl text-white hover:bg-white/30";
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={label(item)} className="fixed inset-0 z-[60] flex flex-col bg-black/90 p-4" onClick={onClose} data-gallery-lightbox>
      <div className="flex justify-end">
        <button type="button" onClick={onClose} aria-label={g.close} className={arrow}>
          <Icon name="close" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {items.length > 1 && (
          <button type="button" onClick={() => go(-1)} aria-label={g.previous} className={arrow}>
            <Icon name="chevron-left" />
          </button>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center">
          {item.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- our own files or links
            <img src={source(item.url)} alt={item.caption} referrerPolicy="no-referrer" className="max-h-[80vh] max-w-full object-contain" />
          ) : (
            <div className="w-full max-w-3xl">
              <Viewer key={item.id} item={item} onOpen={() => undefined} tall />
            </div>
          )}
          {(item.caption || item.title) && <p className="mt-2 text-center text-sm text-white/80">{label(item)}</p>}
          <p className="text-xs text-white/60">{g.position(at + 1, items.length)}</p>
        </div>
        {items.length > 1 && (
          <button type="button" onClick={() => go(1)} aria-label={g.next} className={arrow}>
            <Icon name="chevron-right" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

