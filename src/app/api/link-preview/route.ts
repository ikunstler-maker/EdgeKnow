import { NextResponse, type NextRequest } from "next/server";
import { checkUrl, fetchLinkPreview, type LinkPreview } from "@/lib/link-preview";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export type { LinkPreview };

// Title, description, image and icon of a public page for the editor's link card.
// Only signed-in users; the address checks live in src/lib/link-preview.ts.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (await overLimit(supabase, "preview")) return tooManyRequests();

  const raw = request.nextUrl.searchParams.get("url") ?? "";
  if (!checkUrl(raw)) return NextResponse.json({ error: "invalid_url" }, { status: 400 });

  const preview = await fetchLinkPreview(raw);
  // Unreachable or not a web page: the card still works with the link alone.
  if (!preview) return NextResponse.json({ error: "unreachable" }, { status: 422 });
  return NextResponse.json(preview, { headers: { "Cache-Control": "private, max-age=3600" } });
}
