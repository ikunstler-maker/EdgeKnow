// Recognises YouTube links and builds the only URLs the app embeds or fetches.
// Shared by the editor (browser) and the video info route (server).

export type YouTubeRef =
  | { kind: "video"; id: string; start?: number }
  | { kind: "playlist"; list: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
]);

function parseStart(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!match) return undefined;
  const [, h = "0", m = "0", s = "0"] = match;
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return seconds > 0 ? seconds : undefined;
}

// Accepts watch links, youtu.be, Shorts, embeds, live links and playlists.
export function parseYouTubeUrl(input: string): YouTubeRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!HOSTS.has(url.hostname)) return null;

  const start = parseStart(url.searchParams.get("t") ?? url.searchParams.get("start"));
  const [first, second] = url.pathname.split("/").filter(Boolean);

  let id: string | undefined;
  if (url.hostname === "youtu.be") id = first;
  else if (first === "watch") id = url.searchParams.get("v") ?? undefined;
  else if (first === "shorts" || first === "embed" || first === "live" || first === "v") id = second;

  if (id && VIDEO_ID.test(id)) return { kind: "video", id, ...(start ? { start } : {}) };

  const list = url.searchParams.get("list");
  if (list && LIST_ID.test(list)) return { kind: "playlist", list };
  return null;
}

export function youTubeEmbedUrl(ref: YouTubeRef): string {
  if (ref.kind === "playlist") {
    return `https://www.youtube-nocookie.com/embed/videoseries?list=${ref.list}&autoplay=1`;
  }
  const start = ref.start ? `&start=${ref.start}` : "";
  return `https://www.youtube-nocookie.com/embed/${ref.id}?autoplay=1&rel=0${start}`;
}

export function youTubeWatchUrl(ref: YouTubeRef): string {
  return ref.kind === "playlist"
    ? `https://www.youtube.com/playlist?list=${ref.list}`
    : `https://www.youtube.com/watch?v=${ref.id}${ref.start ? `&t=${ref.start}s` : ""}`;
}

export function youTubeThumbnailUrl(ref: YouTubeRef): string | null {
  return ref.kind === "video" ? `https://i.ytimg.com/vi/${ref.id}/hqdefault.jpg` : null;
}
