"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { copyWishlist, deleteWishlist, loadClaimedWishes, saveWishlist, setWishlistPublished } from "@/app/wishlist-actions";
import { workspacePath } from "@/lib/paths";
import { WISHLIST_EFFECTS, WISHLIST_GRADIENTS, WISHLIST_LIMITS, isWebLink, wishlistImageSrc, type WishlistData, type WishlistGradient, type WishlistItem, type WishlistPattern } from "@/lib/wishlist";
import { EmojiPicker } from "@/components/pages/emoji-picker";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Segmented } from "@/components/ui/segmented";
import { buttonClass, iconButtonClass } from "@/components/ui/button";
import { WishlistView } from "./wishlist-view";

const w = t.wishlists;
const field = "min-h-11 w-full rounded-lg border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
const DEFAULT_PATTERN: Omit<WishlistPattern, "emoji"> = { size: 32, density: 3, opacity: 0.12, angle: -15 };
const MAX_SIDE = 1600;

// Shrinks a picture in the browser (longest side 1600 px, WebP) before it is uploaded.
async function shrink(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const newItem = (): WishlistItem => ({ id: crypto.randomUUID(), title: "", note: "", price: "", links: [], image: null });

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-h-11 flex-1 md:min-h-0" />
    </label>
  );
}

function ItemEditor({ item, index, count, shortId, wishlistId, onChange, onRemove, onMove }: {
  item: WishlistItem;
  index: number;
  count: number;
  shortId: string;
  wishlistId: string;
  onChange: (patch: Partial<WishlistItem>) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const links = item.links ?? [];
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) return setError(w.errors.image);
    setUploading(true);
    const blob = await shrink(file);
    if (!blob) {
      setUploading(false);
      return setError(w.errors.image);
    }
    const res = await fetch(`/api/boards/files?ws=${shortId}&board=${wishlistId}&name=${encodeURIComponent(file.name.slice(0, 120) || "image")}`, {
      method: "POST",
      headers: { "content-type": blob.type || "image/webp" },
      body: blob,
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { ok?: boolean; id?: string; error?: string } | null;
    setUploading(false);
    if (!json?.ok || !json.id) return setError(w.errors[json?.error ?? ""] ?? w.errors.image);
    onChange({ image: json.id });
  };
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3" data-wishlist-item-editor>
      <div className="flex items-center gap-1">
        <span className="cursor-grab text-muted" aria-hidden="true"><Icon name="drag" size={16} /></span>
        <span className="flex-1 text-xs font-medium text-muted">{w.itemNumber(index + 1)}</span>
        <button type="button" className={iconButtonClass("ghost")} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={w.moveUp} title={w.moveUp}><Icon name="arrow-up" size={14} /></button>
        <button type="button" className={iconButtonClass("ghost")} disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={w.moveDown} title={w.moveDown}><Icon name="arrow-down" size={14} /></button>
        <button type="button" className={iconButtonClass("ghost")} onClick={onRemove} aria-label={w.removeItem} title={w.removeItem}><Icon name="trash" size={14} /></button>
      </div>
      <input className={field} value={item.title} maxLength={WISHLIST_LIMITS.title} placeholder={w.itemTitle} aria-label={w.itemTitle} onChange={(e) => onChange({ title: e.target.value })} data-item-title />
      <textarea className={`${field} min-h-20 py-2`} value={item.note ?? ""} maxLength={WISHLIST_LIMITS.note} placeholder={w.itemNote} aria-label={w.itemNote} onChange={(e) => onChange({ note: e.target.value })} />
      <input className={field} value={item.price ?? ""} maxLength={WISHLIST_LIMITS.price} placeholder={w.itemPrice} aria-label={w.itemPrice} onChange={(e) => onChange({ price: e.target.value })} />
      {links.map((link, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            className={`${field} ${link && !isWebLink(link) ? "border-danger" : ""}`}
            value={link}
            inputMode="url"
            placeholder="https://"
            aria-label={w.link(i + 1)}
            onChange={(e) => onChange({ links: links.map((l, j) => (j === i ? e.target.value : l)) })}
            data-item-link
          />
          <button type="button" className={iconButtonClass("ghost")} onClick={() => onChange({ links: links.filter((_, j) => j !== i) })} aria-label={w.removeLink} title={w.removeLink}><Icon name="close" size={14} /></button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {links.length < WISHLIST_LIMITS.links && (
          <button type="button" className={buttonClass("ghost")} onClick={() => onChange({ links: [...links, ""] })} data-add-link>
            <Icon name="link" size={14} />{w.addLink}
          </button>
        )}
        <label className={buttonClass("ghost", "cursor-pointer")}>
          <Icon name="image" size={14} />{uploading ? w.uploading : item.image ? w.changeImage : w.addImage}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} data-item-image />
        </label>
        {item.image && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- the uploaded picture through its access check */}
            <img src={wishlistImageSrc(shortId, item.image)} alt="" className="h-11 w-11 rounded-md object-cover" />
            <button type="button" className={buttonClass("ghost")} onClick={() => onChange({ image: null })}>{w.removeImage}</button>
          </>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

// The owner's editor: wishes and the look on the left, the page as colleagues will see it
// on the right (below on a phone). Saves by itself a moment after a change.
export function WishlistEditor({ shortId, id, initialTitle, initialData, initialVersion, ownerName }: {
  shortId: string;
  id: string;
  initialTitle: string;
  initialData: WishlistData;
  initialVersion: number;
  ownerName: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [data, setData] = useState(initialData);
  const [version, setVersion] = useState(initialVersion);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"content" | "design">("content");
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const dragFrom = useRef<number | null>(null);
  const latest = useRef({ title, data, version });
  useEffect(() => {
    latest.current = { title, data, version };
  }, [title, data, version]);

  const change = (next: Partial<WishlistData>) => {
    setData((d) => ({ ...d, ...next }));
    setDirty(true);
  };
  const design = (next: Partial<WishlistData["design"]>) => change({ design: { ...data.design, ...next } });
  const setItems = (items: WishlistItem[]) => change({ items });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= data.items.length || from === to) return;
    const items = [...data.items];
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
    setItems(items);
  };

  const valid = data.items.every((i) => i.title.trim() && (i.links ?? []).every((l) => !l.trim() || isWebLink(l)));
  const save = useCallback(async () => {
    const { title: tt, data: dd, version: vv } = latest.current;
    const items = dd.items.map((i) => ({ ...i, links: (i.links ?? []).map((l) => l.trim()).filter(Boolean) }));
    setState("saving");
    const result = await saveWishlist(shortId, id, tt, { ...dd, items }, vv);
    if (!result.ok) {
      setState("error");
      setError(w.errors[result.error] ?? w.errors.unknown);
      return false;
    }
    setVersion(result.version);
    setDirty(false);
    setState("saved");
    setError(null);
    return true;
  }, [id, shortId]);

  // Saves on its own about a second and a half after the last change.
  useEffect(() => {
    if (!dirty || !valid) return;
    const timer = setTimeout(() => void save(), 1500);
    return () => clearTimeout(timer);
  }, [dirty, valid, data, title, save]);

  const act = (fn: () => Promise<void>) => startTransition(fn);
  const publish = (on: boolean) =>
    act(async () => {
      if (dirty && !(await save())) return;
      const result = await setWishlistPublished(shortId, id, on);
      if (!result.ok) return setError(w.errors[result.error] ?? w.errors.unknown);
      setData((d) => ({ ...d, published: on }));
      setVersion((v) => v + 1);
      router.refresh();
    });
  const copy = () =>
    act(async () => {
      if (dirty && !(await save())) return;
      const result = await copyWishlist(shortId, id);
      if (!result.ok) return setError(result.error === "exists" ? w.errors.copyExists : (w.errors[result.error] ?? w.errors.unknown));
      router.push(workspacePath(shortId, `/wishlists/${result.id}`));
    });
  // Before a wish goes: if somebody means to give it, ask first (they'll be told).
  const [claimedRemoval, setClaimedRemoval] = useState<string | null>(null);
  const [claimedAny, setClaimedAny] = useState(false);
  const dropItem = (itemId: string) => setItems(data.items.filter((x) => x.id !== itemId));
  const askRemoveItem = (itemId: string) =>
    act(async () => {
      const claimed = await loadClaimedWishes(shortId, id);
      if (claimed.includes(itemId)) setClaimedRemoval(itemId);
      else dropItem(itemId);
    });
  const askDelete = () =>
    act(async () => {
      setClaimedAny((await loadClaimedWishes(shortId, id)).length > 0);
      setConfirmDelete(true);
    });
  const remove = () =>
    act(async () => {
      const result = await deleteWishlist(shortId, id);
      if (!result.ok) return setError(w.errors[result.error] ?? w.errors.unknown);
      router.push(workspacePath(shortId, "/profile"));
    });

  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault();
    if (dragFrom.current !== null) move(dragFrom.current, to);
    dragFrom.current = null;
  };
  const pattern = data.design.pattern;

  return (
    <div className="space-y-4" data-wishlist-editor>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${data.published ? "bg-accent/15 text-accent" : "bg-hover text-muted"}`} data-wishlist-status>
          {data.published ? w.published : w.draft}
        </span>
        <span className="text-xs text-muted" role="status">
          {state === "saving" ? w.saving : dirty ? (valid ? w.unsaved : w.fixToSave) : state === "saved" ? w.saved : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {data.published ? (
            <button type="button" className={buttonClass("subtle")} disabled={pending} onClick={() => publish(false)} data-wishlist-unpublish>{w.unpublish}</button>
          ) : (
            <button type="button" className={buttonClass("primary")} disabled={pending || !valid} onClick={() => publish(true)} data-wishlist-publish>{w.publish}</button>
          )}
          <button type="button" className={buttonClass("ghost")} disabled={pending} onClick={copy} data-wishlist-copy><Icon name="copy" size={14} />{w.copy}</button>
          <button type="button" className={buttonClass("danger")} disabled={pending} onClick={askDelete} data-wishlist-delete><Icon name="trash" size={14} />{w.delete}</button>
        </div>
        {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Segmented label={w.editorTabs} value={tab} onChange={setTab} options={[{ value: "content", label: w.tabContent }, { value: "design", label: w.tabDesign }]} />
          {tab === "content" ? (
            <div className="space-y-3">
              <label className="block text-xs text-muted">
                {w.listTitle}
                <input className={field} value={title} maxLength={WISHLIST_LIMITS.listTitle} placeholder={w.untitled(ownerName)} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} data-wishlist-title />
              </label>
              <label className="block text-xs text-muted">
                {w.introLabel}
                <textarea className={`${field} min-h-20 py-2`} value={data.intro} maxLength={WISHLIST_LIMITS.intro} placeholder={w.introPlaceholder} onChange={(e) => change({ intro: e.target.value })} />
              </label>
              {data.items.map((item, i) => (
                <div key={item.id} draggable onDragStart={() => (dragFrom.current = i)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, i)}>
                  <ItemEditor
                    item={item}
                    index={i}
                    count={data.items.length}
                    shortId={shortId}
                    wishlistId={id}
                    onChange={(patch) => setItems(data.items.map((x) => (x.id === item.id ? { ...x, ...patch } : x)))}
                    onRemove={() => askRemoveItem(item.id)}
                    onMove={(to) => move(i, to)}
                  />
                </div>
              ))}
              {data.items.length < WISHLIST_LIMITS.items && (
                <button type="button" className={buttonClass("subtle", "w-full")} onClick={() => setItems([...data.items, newItem()])} data-add-item>
                  <Icon name="plus" size={14} />{w.addItem}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4" data-wishlist-design>
              <div>
                <p className="text-xs text-muted">{w.gradient}</p>
                <div className="mt-1 grid grid-cols-5 gap-2">
                  {(Object.keys(WISHLIST_GRADIENTS) as WishlistGradient[]).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => design({ gradient: g })}
                      aria-label={w.gradients[g]}
                      title={w.gradients[g]}
                      aria-pressed={data.design.gradient === g}
                      className={`h-11 rounded-lg border-2 ${data.design.gradient === g ? "border-foreground" : "border-transparent"}`}
                      style={{ background: WISHLIST_GRADIENTS[g] }}
                      data-gradient={g}
                    />
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-muted">{w.accent}</span>
                <input type="color" value={data.design.accent} onChange={(e) => design({ accent: e.target.value.toLowerCase() })} className="h-11 w-16 rounded border border-border bg-background md:h-8" />
              </label>
              <div>
                <p className="text-xs text-muted">{w.effect}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {WISHLIST_EFFECTS.map((e) => (
                    <button key={e} type="button" aria-pressed={data.design.effect === e} onClick={() => design({ effect: e })} className={buttonClass(data.design.effect === e ? "primary" : "subtle")} data-effect={e}>
                      {w.effects[e]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-sm font-medium">{w.pattern}</p>
                  <button type="button" className={buttonClass("subtle")} onClick={(e) => setPickerAnchor(e.currentTarget)} data-pattern-emoji>
                    {pattern ? <span className="text-lg leading-none">{pattern.emoji}</span> : <Icon name="sparkle" size={14} />}
                    {pattern ? w.changeEmoji : w.chooseEmoji}
                  </button>
                  {pattern && <button type="button" className={buttonClass("ghost")} onClick={() => design({ pattern: null })}>{w.noPattern}</button>}
                </div>
                {pattern && (
                  <>
                    <Slider label={w.patternSize} value={pattern.size} min={16} max={96} step={1} onChange={(v) => design({ pattern: { ...pattern, size: v } })} />
                    <Slider label={w.patternDensity} value={pattern.density} min={1} max={5} step={0.5} onChange={(v) => design({ pattern: { ...pattern, density: v } })} />
                    <Slider label={w.patternOpacity} value={pattern.opacity} min={0.02} max={0.4} step={0.01} onChange={(v) => design({ pattern: { ...pattern, opacity: v } })} />
                    <Slider label={w.patternAngle} value={pattern.angle} min={-45} max={45} step={1} onChange={(v) => design({ pattern: { ...pattern, angle: v } })} />
                  </>
                )}
              </div>
              {pickerAnchor && (
                <EmojiPicker
                  anchor={pickerAnchor}
                  current={pattern?.emoji ?? null}
                  onPick={(emoji) => design({ pattern: emoji ? { ...DEFAULT_PATTERN, ...(pattern ?? {}), emoji } : null })}
                  onClose={() => setPickerAnchor(null)}
                />
              )}
            </div>
          )}
        </div>
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <p className="mb-2 text-xs font-medium text-muted">{w.preview}</p>
          <WishlistView title={title} data={data} shortId={shortId} ownerName={ownerName} />
        </div>
      </div>

      {confirmDelete && (
        <Dialog
          title={w.deleteTitle}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button type="button" className={buttonClass("ghost")} onClick={() => setConfirmDelete(false)}>{t.common.cancel}</button>
              <button type="button" className={buttonClass("danger")} disabled={pending} onClick={remove} data-wishlist-delete-confirm>{w.deleteForever}</button>
            </>
          }
        >
          <p className="text-sm">{w.deleteText}</p>
          {claimedAny && <p className="mt-2 text-sm font-medium" data-wishlist-claimed-warning>{w.claimedDeleteText}</p>}
        </Dialog>
      )}
      {claimedRemoval && (
        <Dialog
          title={w.claimedTitle}
          onClose={() => setClaimedRemoval(null)}
          footer={
            <>
              <button type="button" className={buttonClass("ghost")} onClick={() => setClaimedRemoval(null)}>{t.common.cancel}</button>
              <button
                type="button"
                className={buttonClass("danger")}
                onClick={() => {
                  dropItem(claimedRemoval);
                  setClaimedRemoval(null);
                }}
                data-wish-remove-anyway
              >
                {w.removeAnyway}
              </button>
            </>
          }
        >
          <p className="text-sm">{w.claimedText}</p>
        </Dialog>
      )}
    </div>
  );
}
