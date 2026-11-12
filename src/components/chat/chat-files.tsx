"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { chatFileUrl, type ChatFile } from "@/lib/chat";
import type { LinkPreview } from "@/lib/link-preview";
import { Icon } from "@/components/ui/icon";
import { iconButtonClass } from "@/components/ui/button";
import { VoicePlayer } from "./voice-player";

const c = () => t.chat.files;
const MAX_SIDE = 1600;
export const MAX_VOICE_MS = 5 * 60_000;

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} ${c().mb}` : `${Math.max(1, Math.round(bytes / 1024))} ${c().kb}`;
const durationLabel = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// A picture made smaller in the browser before sending (at most 1600 px on a side,
// WebP or JPEG): quick to send and to open. GIFs stay as they are (they may move).
export async function compressImage(file: File): Promise<{ blob: Blob; width: number; height: number; name: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82));
  const blob = (await toBlob("image/webp")) ?? (await toBlob("image/jpeg"));
  if (!blob) throw new Error("compress_failed");
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  return { blob, width, height, name: `${file.name.replace(/\.[^.]+$/, "") || "photo"}.${ext}` };
}

// Sends the bytes to our server, which checks and stores them; answers the file's id.
export async function uploadChatFile(
  shortId: string,
  channelId: string,
  blob: Blob,
  name: string,
  kind: ChatFile["kind"],
  extra: { duration?: number; width?: number; height?: number; levels?: number[] | null } = {},
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const params = new URLSearchParams({ ws: shortId, ch: channelId, name, kind });
  if (extra.duration) params.set("duration", String(Math.round(extra.duration)));
  if (extra.width) params.set("w", String(extra.width));
  if (extra.height) params.set("h", String(extra.height));
  if (extra.levels?.length) params.set("levels", extra.levels.join(","));
  try {
    const response = await fetch(`/api/chat/files?${params}`, { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
    const result = (await response.json().catch(() => null)) as { ok: boolean; id?: string; error?: string } | null;
    return result?.ok && result.id ? { ok: true, id: result.id } : { ok: false, error: result?.error ?? "upload_failed" };
  } catch {
    return { ok: false, error: "upload_failed" };
  }
}

// The voice recorder: press to start, again to stop and attach (at most 5 minutes).
export function VoiceButton({ onRecorded, disabled }: { onRecorded: (blob: Blob, durationMs: number) => void; disabled: boolean }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => recorder.current?.state === "recording" && recorder.current.stop();
  useEffect(
    () => () => {
      stop();
    },
     
    [],
  );

  const start = async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return setError(c().voiceUnsupported);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setError(c().voiceDenied);
    }
    const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (timer.current) clearInterval(timer.current);
      setRecording(false);
      const duration = Math.min(Date.now() - started.current, MAX_VOICE_MS);
      const blob = new Blob(chunks, { type: (rec.mimeType || "audio/webm").split(";")[0] });
      if (blob.size && duration >= 500) onRecorded(blob, duration);
    };
    recorder.current = rec;
    started.current = Date.now();
    setElapsed(0);
    rec.start();
    setRecording(true);
    timer.current = setInterval(() => {
      const ms = Date.now() - started.current;
      setElapsed(ms);
      if (ms >= MAX_VOICE_MS) stop();
    }, 250);
  };

  return (
    <span className="inline-flex items-center gap-1">
      {recording && (
        <span className="text-xs tabular-nums text-danger" aria-live="polite" data-chat-recording>
          {durationLabel(elapsed)}
        </span>
      )}
      <button
        type="button"
        onClick={() => (recording ? stop() : void start())}
        disabled={disabled && !recording}
        aria-pressed={recording}
        aria-label={recording ? c().voiceStop : c().voice}
        title={error ?? (recording ? c().voiceStop : c().voice)}
        className={`${iconButtonClass(recording ? "danger" : "ghost")}`}
        data-chat-voice
      >
        <Icon name={recording ? "square" : "mic"} size={18} />
      </button>
    </span>
  );
}

// A message's files: pictures as a grid, voice as a player, the rest as cards.
export function MessageFiles({ files, shortId }: { files: ChatFile[]; shortId: string }) {
  if (!files.length) return null;
  const images = files.filter((f) => f.kind === "image" || (f.kind === "file" && f.mime_type.startsWith("image/")));
  const voices = files.filter((f) => f.kind === "voice");
  const others = files.filter((f) => !images.includes(f) && !voices.includes(f));
  return (
    <div className="mt-1 flex flex-col gap-1.5" data-chat-files>
      {images.length > 0 && (
        <div className={`grid gap-1 ${images.length > 1 ? "grid-cols-2 sm:max-w-md" : "max-w-sm"}`}>
          {images.map((f) => (
            <a key={f.id} href={chatFileUrl(shortId, f.id)} target="_blank" rel="noopener" className="block overflow-hidden rounded-lg border border-border bg-hover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={chatFileUrl(shortId, f.id)}
                alt={f.name}
                loading="lazy"
                className="max-h-72 w-full object-cover"
                style={f.width && f.height ? { aspectRatio: `${f.width} / ${f.height}` } : undefined}
              />
            </a>
          ))}
        </div>
      )}
      {voices.map((f) => (
        <VoicePlayer key={f.id} src={chatFileUrl(shortId, f.id)} levels={f.waveform} durationMs={f.duration_ms} seed={f.id} />
      ))}
      {others.map((f) => (
        <a
          key={f.id}
          href={chatFileUrl(shortId, f.id, true)}
          className="flex max-w-sm items-center gap-2 rounded-lg border border-border px-3 py-2 hover:border-border-strong"
          data-chat-file
        >
          <Icon name="file" size={18} className="text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{f.name}</span>
            <span className="block text-xs text-muted">{sizeLabel(f.bytes)}</span>
          </span>
          <Icon name="download" size={16} className="text-muted" />
        </a>
      ))}
    </div>
  );
}

// The first link of a message as a card (title, site, picture), fetched by our server.
const previews = new Map<string, Promise<LinkPreview | null>>();
function preview(url: string) {
  if (!previews.has(url))
    previews.set(
      url,
      fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
        .then((r) => (r.ok ? (r.json() as Promise<LinkPreview>) : null))
        .catch(() => null),
    );
  return previews.get(url)!;
}
export function LinkCard({ url }: { url: string }) {
  const [card, setCard] = useState<LinkPreview | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void preview(url).then((p) => live && setCard(p));
    return () => {
      live = false;
    };
  }, [url]);
  if (!card || (!card.title && !card.description)) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 flex max-w-md gap-3 overflow-hidden rounded-lg border border-border p-2 hover:border-border-strong" data-chat-link-card>
      {card.image && !imageFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="h-16 w-16 shrink-0 rounded object-cover" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-muted">{card.siteName || new URL(url).hostname}</span>
        <span className="line-clamp-1 text-sm font-medium">{card.title}</span>
        {card.description && <span className="line-clamp-2 text-xs text-muted">{card.description}</span>}
      </span>
    </a>
  );
}

export const firstLink = (body: string) => /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/.exec(body)?.[1] ?? null;

// What is being added to the message: a chip per file, with its state.
export type Pending = { key: string; name: string; kind: ChatFile["kind"]; state: "uploading" | "ready" | "error"; id?: string; error?: string; preview?: string };
export function PendingFiles({ items, onRemove }: { items: Pending[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-2" data-chat-pending>
      {items.map((p) => (
        <li key={p.key} className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${p.state === "error" ? "border-danger/50 text-danger" : "border-border"}`}>
          {p.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.preview} alt="" className="h-8 w-8 rounded object-cover" />
          ) : (
            <Icon name={p.kind === "voice" ? "mic" : "file"} size={14} />
          )}
          <span className="max-w-40 truncate">{p.name}</span>
          <span className="text-muted">{p.state === "uploading" ? c().uploading : p.state === "error" ? (c().errors as Record<string, string>)[p.error ?? ""] ?? c().errors.upload_failed : ""}</span>
          <button type="button" onClick={() => onRemove(p.key)} aria-label={c().remove} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-hover">
            <Icon name="close" size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}
