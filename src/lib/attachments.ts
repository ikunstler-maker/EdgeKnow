"use client";

import { createClient } from "@/lib/supabase/client";
import { registerAttachment } from "@/app/file-actions";
import { getImageQuality, prepareImage, type ImageQuality } from "./image-compression";

// How images are referenced inside documents: a storage path, never a URL
// (signed URLs expire; the path is turned into one when the page is shown).
export const ATTACHMENT_SCHEME = "ek-attachment:";
const BUCKET = "attachments";

export class UploadError extends Error {}

export async function uploadImage(pageId: string, file: File, quality: ImageQuality = getImageQuality()) {
  const image = await prepareImage(file, quality);
  const supabase = createClient();

  // The workspace's database checks rights, type, size and the quota, and picks the path.
  const registered = await registerAttachment({
    pageId,
    type: image.type,
    bytes: image.blob.size,
    width: image.width,
    height: image.height,
  });
  if (!registered.ok) throw new UploadError(registered.error);

  if (registered.backend === "drive" || registered.backend === "team") {
    // The file goes to the workspace's Google Drive or its team's own storage:
    // our server puts it there (the browser never holds those keys).
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
