import { NextResponse, type NextRequest } from "next/server";
import { ATTACHMENT_COLUMNS, readAttachment, type AttachmentRow } from "@/lib/drive/storage";
import { ATTACHMENT_PATH, FILE_HEADERS } from "@/lib/drive/file-checks";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Shows an image from wherever it lives. The attachment row is read with the
// person's own session, so RLS decides: no access to the page, no file.
// Supabase files: a short-lived signed URL. Drive files: streamed by the server.
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/files/[...path]">) {
  const path = (await params).path.join("/");
  if (!ATTACHMENT_PATH.test(path)) return new NextResponse(null, { status: 404 });

  const supabase = await createClient();
  const { data } = await supabase.from("attachments").select(ATTACHMENT_COLUMNS).eq("storage_path", path).maybeSingle();
  const row = data as AttachmentRow | null;
  if (!row) return new NextResponse(null, { status: 404 });

  if (row.storage_backend === "supabase") {
    const { data: signed } = await supabase.storage.from("attachments").createSignedUrl(path, 3600);
    if (!signed?.signedUrl) return new NextResponse(null, { status: 404 });
    return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "private, max-age=3000" } });
  }

  const admin = createAdminClient();
  if (!admin) return new NextResponse(null, { status: 503 });
  try {
    const { bytes } = await readAttachment(admin, row);
    return new NextResponse(Buffer.from(bytes), {
      headers: { ...FILE_HEADERS, "Content-Type": row.mime_type, "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
