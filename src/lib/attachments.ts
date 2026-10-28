"use client";

import { createClient } from "@/lib/supabase/client";
import { getImageQuality, prepareImage, type ImageQuality } from "./image-compression";

// How images are referenced inside documents: a storage path, never a URL
// (signed URLs expire; the path is turned into one when the page is shown).
export const ATTACHMENT_SCHEME = "ek-attachment:";
const BUCKET = "attachments";
const SIGNED_URL_SECONDS = 3600;

export class UploadError extends Error {}

export async function uploadImage(pageId: string, file: File, quality: ImageQuality = getImageQuality()) {
  const image = await prepareImage(file, quality);
  const supabase = createClient();

  // The database checks rights, type, size and the workspace quota, and picks the path.
  const { data, error } = await supabase.rpc("register_attachment", {
    target_page: pageId,
    file_type: image.type,
    file_bytes: image.blob.size,
    file_width: image.width,
    file_height: image.height,
  });
  const registered = data as { ok: boolean; error?: string; path?: string } | null;
  if (error || !registered?.ok || !registered.path) {
    throw new UploadError(registered?.error ?? "unknown");
  }

  const upload = await supabase.storage.from(BUCKET).upload(registered.path, image.blob, {
    contentType: image.type,
    upsert: false,
  });
  if (upload.error) throw new UploadError("upload_failed");
  return { url: `${ATTACHMENT_SCHEME}${registered.path}`, width: image.width };
}

// Signed URLs are cached until shortly before they expire.
const cache = new Map<string, { url: string; expires: number }>();

// Images by link: shown straight from the other site while it keeps them, https only.
export function isExternalImageUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function resolveAttachmentUrl(url: string): Promise<string> {
  if (isExternalImageUrl(url)) return url;
  // Anything else that isn't our own file (http:, data:, javascript:…) is not shown.
  if (!url.startsWith(ATTACHMENT_SCHEME)) return "";
  const path = url.slice(ATTACHMENT_SCHEME.length);
  const cached = cache.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;

  const { data } = await createClient().storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (!data?.signedUrl) return "";
  cache.set(path, { url: data.signedUrl, expires: Date.now() + (SIGNED_URL_SECONDS - 300) * 1000 });
  return data.signedUrl;
}
