"use client";

import { useEffect, useRef, useState, useTransition, type PointerEvent } from "react";
import { t } from "@/i18n";
import { uploadMyAvatar } from "@/app/profile-actions";
import { Dialog } from "@/components/ui/dialog";
import { buttonClass } from "@/components/ui/button";

const c = t.profile.card;
const VIEW = 240;
const OUT = 256;

// Pick a photo, drag and zoom it inside a circle, and upload a small square of it.
export function AvatarDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const url = useRef<string | null>(null);

  useEffect(() => () => {
    if (url.current) URL.revokeObjectURL(url.current);
  }, []);

  // The image covers the circle at zoom 1; the offset is clamped so no gap shows.
  const base = image ? VIEW / Math.min(image.naturalWidth, image.naturalHeight) : 1;
  const scale = base * zoom;
  const clamp = (o: { x: number; y: number }, s = scale) => {
    if (!image) return o;
    const maxX = Math.max(0, (image.naturalWidth * s - VIEW) / 2);
    const maxY = Math.max(0, (image.naturalHeight * s - VIEW) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) };
  };

  const pick = (file: File | undefined) => {
    setError(null);
    if (!file || !file.type.startsWith("image/")) return;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.onerror = () => setError(c.errors.tooBig);
    img.src = url.current;
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setOffset(clamp({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y }));
  };

  const save = () =>
    startTransition(async () => {
      if (!image) return;
      const canvas = document.createElement("canvas");
      canvas.width = OUT;
      canvas.height = OUT;
      const ctx = canvas.getContext("2d");
      if (!ctx) return setError(c.errors.tooBig);
      const k = OUT / VIEW;
      const w = image.naturalWidth * scale * k;
      const h = image.naturalHeight * scale * k;
      ctx.drawImage(image, (OUT - w) / 2 + offset.x * k, (OUT - h) / 2 + offset.y * k, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
      if (!blob) return setError(c.errors.tooBig);
      const form = new FormData();
      form.set("file", new File([blob], "avatar", { type: blob.type || "image/png" }));
      const result = await uploadMyAvatar(workspaceId, form);
      if (!result.ok) return setError(c.errors[result.error] ?? c.errors.unknown);
      onClose();
    });

  return (
    <Dialog
      title={c.photoTitle}
      onClose={onClose}
      width={360}
      footer={
        <>
          <button type="button" className={buttonClass("ghost")} onClick={onClose}>{t.common.cancel}</button>
          <button type="button" className={buttonClass("primary")} onClick={save} disabled={!image || pending}>{t.common.save}</button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3" data-avatar-dialog>
        <p className="text-sm text-muted">{c.photoHint}</p>
        <div
          className="relative touch-none select-none overflow-hidden rounded-full border border-border bg-hover"
          style={{ width: VIEW, height: VIEW, cursor: image ? "grab" : "default" }}
          onPointerDown={image ? onDown : undefined}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          {image && (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file
            <img
              src={image.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{
                width: image.naturalWidth * scale,
                height: image.naturalHeight * scale,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          )}
        </div>
        {image && (
          <label className="flex w-full items-center gap-3 text-sm">
            <span className="text-muted">{c.zoom}</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              className="min-h-11 flex-1 md:min-h-0"
              onChange={(e) => {
                const z = Number(e.target.value);
                setZoom(z);
                setOffset((o) => clamp(o, base * z));
              }}
            />
          </label>
        )}
        <label className={buttonClass("subtle", "cursor-pointer")}>
          {c.chooseFile}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
