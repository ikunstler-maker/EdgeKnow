import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// A person's own uploaded picture. The profile is read with the viewer's session, so
// RLS decides: only people who share a workspace with them (and they themselves) get it.
// Shown, never offered as a download; nothing in it can run on our site.
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/avatar/[uid]">) {
  const { uid } = await params;
  if (!/^[0-9a-f-]{36}$/.test(uid)) return new NextResponse(null, { status: 404 });
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("id, avatar_custom").eq("id", uid).maybeSingle();
  const admin = createAdminClient();
  if (!profile?.avatar_custom || !admin) return new NextResponse(null, { status: 404 });
  const { data: file } = await admin.storage.from("avatars").download(`${uid}/avatar`);
  if (!file) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(await file.arrayBuffer()), {
    headers: {
      "Content-Type": file.type || "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Content-Disposition": "inline",
      // The address changes with every new picture.
      "Cache-Control": "private, max-age=604800, immutable",
    },
  });
}
