// Vault's files on the server and in the browser: what goes in one piece, what in parts,
// and which types are trusted enough to be shown rather than downloaded.

// Up to this size a file goes in one request and may be kept in EdgeKnow's storage;
// larger ones go to the workspace's Drive in parts of this size.
export const VAULT_SMALL_BYTES = 4 * 1024 * 1024;
export const VAULT_PART_BYTES = 4 * 1024 * 1024;

// Types whose first bytes are checked; a file that claims one of them must be one.
const CHECKED = [
  "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/csv", "application/zip",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg",
];

// The type to keep: a checked type only when the bytes fit it (null: they don't); any
// other well-formed type as it is (always handed out as a download); otherwise plain bytes.
export function vaultChecked(declared: string, bytes: Uint8Array, looksLike: (type: string, bytes: Uint8Array) => boolean): string | null {
  if (CHECKED.includes(declared)) return looksLike(declared, bytes) ? declared : null;
  return /^[a-z0-9][a-z0-9.+-]{0,60}\/[a-z0-9][a-z0-9.+-]{0,60}$/.test(declared) ? declared : "application/octet-stream";
}

// Shown in the browser (only checked types; never a large file, whose bytes were not checked).
export const vaultShowsInline = (mime: string, large: boolean) =>
  !large && ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"].includes(mime);
