import { NextResponse, type NextRequest } from "next/server";
<<<<<<< HEAD
import { errorCode, fetchFromSource, IMAGE_TYPES, MAX_IMAGE, type ExternalSource } from "@/lib/external-source";
=======
import { fetchFromSource, IMAGE_TYPES, MAX_IMAGE, type ExternalSource } from "@/lib/external-source";
>>>>>>> origin/claude/exciting-pasteur-ktbpba
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

<<<<<<< HEAD
const REASONS: Record<string, string> = {
  login_required: "The source site asked to sign in: open its pictures for the key too.",
  redirect_other_site: "The source site redirected to another site; the key is not sent there.",
  too_large: "The picture is larger than 5 MB.",
  blocked_address: "This address is not allowed (another site or an internal address).",
  unreachable: "The source site did not answer.",
};

// Why a picture failed, readable when the picture's address is opened directly.
function refused(code: string) {
  const reason = REASONS[code] ?? (code.startsWith("wrong_type")
    ? `Not a PNG, JPEG, WebP or GIF picture (${code.slice(12)}).`
    : `The source site answered with an error (${code.replace("http_", "")}).`);
  return new NextResponse(`${reason}\n`, {
    status: 502,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-EdgeKnow-Reason": code, "Cache-Control": "no-store" },
  });
}

=======
>>>>>>> origin/claude/exciting-pasteur-ktbpba
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
<<<<<<< HEAD
  if (await overLimit(supabase, "external_image")) return tooManyRequests();
=======
  if (await overLimit(supabase, "preview")) return tooManyRequests();
>>>>>>> origin/claude/exciting-pasteur-ktbpba

  const admin = createAdminClient();
  if (!admin) return new NextResponse(null, { status: 503 });
  const { data } = await admin.from("external_sources").select("workspace_id, url, secret_encrypted").eq("id", id).maybeSingle();
  const source = data as Pick<ExternalSource, "workspace_id" | "url" | "secret_encrypted"> | null;
  if (!source) return new NextResponse(null, { status: 404 });
  const { data: role } = await supabase.rpc("workspace_role", { ws: source.workspace_id });
  if (!role) return new NextResponse(null, { status: 404 });

<<<<<<< HEAD
  let res: Awaited<ReturnType<typeof fetchFromSource>>;
  try {
    res = await fetchFromSource(source, target, { Accept: IMAGE_TYPES.join(", ") }, MAX_IMAGE);
  } catch (error) {
    return refused(errorCode(error));
  }
  if (!res) return refused("blocked_address");
  if (res.status === 401 || res.status === 403) return refused("login_required");
  if (res.status !== 200) return refused(`http_${res.status}`);
  const type = res.type.split(";")[0].trim();
  if (!IMAGE_TYPES.includes(type)) return refused(`wrong_type: ${type || "none"}`.slice(0, 80));
=======
  const res = await fetchFromSource(source, target, { Accept: IMAGE_TYPES.join(", ") }, MAX_IMAGE).catch(() => null);
  const type = res?.type.split(";")[0].trim() ?? "";
  if (!res || res.status !== 200 || !IMAGE_TYPES.includes(type)) return new NextResponse(null, { status: 502 });
>>>>>>> origin/claude/exciting-pasteur-ktbpba
  return new NextResponse(new Uint8Array(res.body), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
