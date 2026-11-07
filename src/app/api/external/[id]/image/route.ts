import { NextResponse, type NextRequest } from "next/server";
import { fetchFromSource, IMAGE_TYPES, MAX_IMAGE, type ExternalSource } from "@/lib/external-source";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Pictures of an external wiki source: only members of the source's workspace,
// only addresses on the source's own origin, only raster images. The key is added
// here on the server and never reaches the browser.
export async function GET(request: NextRequest, { params }: RouteContext<"/api/external/[id]/image">) {
  const { id } = await params;
  const target = request.nextUrl.searchParams.get("u") ?? "";
  if (!UUID.test(id) || !target) return new NextResponse(null, { status: 404 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse(null, { status: 401 });
  if (await overLimit(supabase, "preview")) return tooManyRequests();

  const admin = createAdminClient();
  if (!admin) return new NextResponse(null, { status: 503 });
  const { data } = await admin.from("external_sources").select("workspace_id, url, secret_encrypted").eq("id", id).maybeSingle();
  const source = data as Pick<ExternalSource, "workspace_id" | "url" | "secret_encrypted"> | null;
  if (!source) return new NextResponse(null, { status: 404 });
  const { data: role } = await supabase.rpc("workspace_role", { ws: source.workspace_id });
  if (!role) return new NextResponse(null, { status: 404 });

  const res = await fetchFromSource(source, target, { Accept: IMAGE_TYPES.join(", ") }, MAX_IMAGE).catch(() => null);
  const type = res?.type.split(";")[0].trim() ?? "";
  if (!res || res.status !== 200 || !IMAGE_TYPES.includes(type)) return new NextResponse(null, { status: 502 });
  return new NextResponse(new Uint8Array(res.body), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
