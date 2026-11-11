import type { Metadata } from "next";
import { t } from "@/i18n";
import { dataClient } from "@/lib/team-db/data";
import { getCurrentUser } from "@/lib/auth";
import { PagePrint } from "@/components/pages/page-print";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const metadata: Metadata = { title: `${t.pageExport.print.title} · ${t.app.name}` };

// A page laid out for the browser's "Save as PDF" (export, Free). Read with the
// reader's own access: a page they can't see is simply not found.
export default async function PagePrintRoute({ params }: PageProps<"/w/[wid]/p/[id]/print">) {
  const { wid, id } = await params;
  if (!UUID.test(id)) return <main className="mx-auto max-w-md flex-1 px-4 py-16 text-center text-muted">{t.pages.notFound}</main>;
  const db = await dataClient(wid);
  const [{ data: page }, user] = await Promise.all([
    db.from("pages").select("id, title, icon, content, version, deleted_at").eq("id", id).maybeSingle(),
    getCurrentUser(),
  ]);
  if (!page) return <main className="mx-auto max-w-md flex-1 px-4 py-16 text-center text-muted">{t.pages.notFound}</main>;
  return (
    <PagePrint
      pageId={page.id as string}
      title={(page.title as string) || t.pages.untitled}
      icon={(page.icon as string | null) ?? null}
      content={page.content}
      version={page.version as number}
      userId={user.id}
    />
  );
}
