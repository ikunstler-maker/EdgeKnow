"use client";

import imageCompression from "browser-image-compression";

// Longest side for each quality the user can pick when inserting an image.
export const IMAGE_QUALITIES = {
  fullhd: 1920,
  hd: 1280,
  // "480p": 854×480 for a 16:9 picture.
  sd: 854,
} as const;
export type ImageQuality = keyof typeof IMAGE_QUALITIES;

export const ACCEPTED_IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png", "image/gif"] as const;
const TARGET_BYTES = 1024 * 1024;
const STORAGE_LIMIT_BYTES = 2 * 1024 * 1024;

export type PreparedImage = { blob: Blob; type: string; width: number; height: number };

export class ImageError extends Error {
  constructor(public code: "unsupported_type" | "gif_too_large" | "too_large" | "unreadable") {
    super(code);
  }
}

async function dimensions(blob: Blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    throw new ImageError("unreadable");
  }
}

// Shrinks and converts an image in the browser before upload (SPEC "Завантаження та
// стиснення"): small images pass unchanged, GIFs keep their animation, everything
// else becomes WebP (JPEG where the browser can't encode WebP) at most 1 MB.
export async function prepareImage(file: File, quality: ImageQuality): Promise<PreparedImage> {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new ImageError("unsupported_type");
  }
  const original = await dimensions(file);

  if (file.type === "image/gif") {
    if (file.size > STORAGE_LIMIT_BYTES) throw new ImageError("gif_too_large");
    return { blob: file, type: file.type, ...original };
  }

  const maxSide = IMAGE_QUALITIES[quality];
  if (Math.max(original.width, original.height) <= maxSide && file.size <= TARGET_BYTES) {
    return { blob: file, type: file.type, ...original };
  }

  const compress = (fileType: string) =>
    imageCompression(file, {
      maxWidthOrHeight: maxSide,
      maxSizeMB: TARGET_BYTES / 1024 / 1024,
      fileType,
      initialQuality: 0.85,
      // Quality steps down until the file fits; the chosen resolution is kept.
      alwaysKeepResolution: true,
      // The worker build is fetched from a CDN; the main thread is fine for one image.
      useWebWorker: false,
    });

  let result: Blob = await compress("image/webp");
  // Some browsers (older Safari) can't encode WebP and silently return PNG.
  if (result.type !== "image/webp") result = await compress("image/jpeg");
  if (result.size > STORAGE_LIMIT_BYTES) throw new ImageError("too_large");

  return { blob: result, type: result.type, ...(await dimensions(result)) };
}

// The last quality picked is reused for pasted and dropped images.
const QUALITY_KEY = "edgeknow.image-quality";

export function getImageQuality(): ImageQuality {
  try {
    const stored = window.localStorage.getItem(QUALITY_KEY);
    if (stored && stored in IMAGE_QUALITIES) return stored as ImageQuality;
  } catch {
    // Storage unavailable: use the default.
  }
  return "fullhd";
}

export function setImageQuality(quality: ImageQuality) {
  try {
    window.localStorage.setItem(QUALITY_KEY, quality);
  } catch {
    // Not remembered; this upload still uses the choice.
  }
}
