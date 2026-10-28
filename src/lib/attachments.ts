"use client";

import { createClient } from "@/lib/supabase/client";
import { getImageQuality, prepareImage, type ImageQuality } from "./image-compression";

// How images are referenced inside documents: a storage path, never a URL
// (signed URLs expire; the path is turned into one when the page is shown).
export const ATTACHMENT_SCHEME = "ek-attachment:";
const BUCKET = "attachments";

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
  const registered = data as { ok: boolean; error?: string; path?: string; backend?: "supabase" | "drive" } | null;
  if (error || !registered?.ok || !registered.path) {
    throw new UploadError(registered?.error ?? "unknown");
  }

  if (registered.backend === "drive") {
    // The workspace keeps its files on its Google Drive: our server puts it there.
    const response = await fetch(`/api/files/upload?path=${encodeURIComponent(registered.path)}`, {
      method: "POST",
      headers: { "Content-Type": image.type },
      body: image.blob,
    });
    if (!response.ok) throw new UploadError("upload_failed");
  } else {
    const upload = await supabase.storage.from(BUCKET).upload(registered.path, image.blob, {
      contentType: image.type,
      upsert: false,
    });
    if (upload.error) throw new UploadError("upload_failed");
  }
  return { url: `${ATTACHMENT_SCHEME}${registered.path}`, width: image.width };
}

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
  // Our server checks the page access and serves the file from Supabase or the
  // workspace's Google Drive, wherever it lives now.
  return `/api/files/${url.slice(ATTACHMENT_SCHEME.length)}`;
}
