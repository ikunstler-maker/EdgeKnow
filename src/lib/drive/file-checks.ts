import "server-only";

// <workspace id>/<page id>/<attachment id>.<ext>, as register_attachment builds it.
export const ATTACHMENT_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png|gif|mp3|m4a|ogg|wav)$/;

// The first bytes must match the registered type, so nothing but an image is stored or served.
export function looksLike(mimeType: string, bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  switch (mimeType) {
    case "image/png":
      return bytes[0] === 0x89 && ascii(1, 4) === "PNG";
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/gif":
      return ascii(0, 4) === "GIF8";
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    // Gallery audio: an ID3 tag or an MPEG frame; an MP4 box; Ogg; RIFF WAVE.
    case "audio/mpeg":
      return ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case "audio/mp4":
      return ascii(4, 8) === "ftyp";
    case "audio/ogg":
      return ascii(0, 4) === "OggS";
    case "audio/wav":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
    default:
      return false;
  }
}

// Files served from our domain: shown as images or played as audio, never run as a page.
export const FILE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
  "Content-Disposition": "inline",
};
