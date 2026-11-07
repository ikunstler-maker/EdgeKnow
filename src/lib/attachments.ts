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

// A Google Drive "Share" link points to Drive's viewer page, not to the picture:
// it becomes a direct image link (the file must be shared with "Anyone with the
// link"). Folders can't be shown; anything else is returned unchanged.
export function directImageUrl(url: string): string | "drive_folder" {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return url.trim();
  }
  if (!/^(drive|docs)\.google\.com$/.test(parsed.hostname)) return url.trim();
  if (/\/(drive\/)?(u\/\d+\/)?folders\//.test(parsed.pathname)) return "drive_folder";
  const id = parsed.pathname.match(/\/file\/(?:u\/\d+\/)?d\/([\w-]{10,})/)?.[1] ?? parsed.searchParams.get("id");
  if (!id || !/^[\w-]{10,}$/.test(id)) return url.trim();
  return `https://drive.google.com/thumbnail?id=${id}&sz=w2000`;
}

export const isDriveImageUrl = (url: string) => url.startsWith("https://drive.google.com/thumbnail?id=");

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

// Gallery audio: the browser's type (or the file's ending) as the one name the database knows.
export const AUDIO_TYPES: Record<string, "audio/mpeg" | "audio/mp4" | "audio/ogg" | "audio/wav"> = {
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/mp4": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/aac": "audio/mp4",
  "audio/ogg": "audio/ogg",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
};
export const AUDIO_ACCEPT = ".mp3,.m4a,.ogg,.oga,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav";

// Uploads an audio file to the page's storage as it is (no re-encoding).
export async function uploadAudio(pageId: string, file: File) {
  const type = AUDIO_TYPES[file.type] ?? AUDIO_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!type) throw new UploadError("unsupported_type");
  const registered = await registerAttachment({ pageId, type, bytes: file.size, width: 0, height: 0 });
  if (!registered.ok) throw new UploadError(registered.error);
  if (registered.backend === "drive" || registered.backend === "team") {
    const response = await fetch(`/api/files/upload?path=${encodeURIComponent(registered.path)}`, { method: "POST", headers: { "Content-Type": type }, body: file });
    if (!response.ok) throw new UploadError("upload_failed");
  } else {
    const upload = await createClient().storage.from(BUCKET).upload(registered.path, file, { contentType: type, upsert: false });
    if (upload.error) throw new UploadError("upload_failed");
  }
  return `${ATTACHMENT_SCHEME}${registered.path}`;
}
