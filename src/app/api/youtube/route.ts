import { NextResponse, type NextRequest } from "next/server";
import { parseYouTubeUrl, youTubeWatchUrl } from "@/lib/youtube";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export type YouTubeInfo = { title: string | null; author: string | null; thumbnail: string | null };

// Title, channel and cover of a YouTube video or playlist for the editor's video card.
// Only signed-in users, only youtube.com: the server never fetches an address
// taken from the request as is, it rebuilds a canonical YouTube URL first.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (await overLimit(supabase, "youtube")) return tooManyRequests();

  const ref = parseYouTubeUrl(request.nextUrl.searchParams.get("url") ?? "");
  if (!ref) return NextResponse.json({ error: "not_youtube" }, { status: 400 });

  const oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youTubeWatchUrl(ref))}`;
  try {
    const response = await fetch(oembed, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(String(response.status));
    const json = (await response.json()) as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown };
    const info: YouTubeInfo = {
      title: typeof json.title === "string" ? json.title.slice(0, 300) : null,
      author: typeof json.author_name === "string" ? json.author_name.slice(0, 200) : null,
      thumbnail:
        typeof json.thumbnail_url === "string" && json.thumbnail_url.startsWith("https://i.ytimg.com/")
          ? json.thumbnail_url
          : null,
    };
    return NextResponse.json(info, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch {
    // Private or removed videos: the card still works with the link alone.
    return NextResponse.json({ title: null, author: null, thumbnail: null } satisfies YouTubeInfo);
  }
}
