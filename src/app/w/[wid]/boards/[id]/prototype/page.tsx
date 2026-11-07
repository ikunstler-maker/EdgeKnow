import type { Metadata } from "next";
import { t } from "@/i18n";
import { loadDesign } from "@/lib/design-server";
import { DesignPlayer } from "@/components/design/design-player";

export const metadata: Metadata = { title: `${t.design.prototype.player.title} · ${t.app.name}` };

// The prototype player (?page=<id>: that page; ?flow=<id>: that flow; ?frame=<id>: start there).
export default async function PrototypePage({ params, searchParams }: PageProps<"/w/[wid]/boards/[id]/prototype">) {
  const { wid, id } = await params;
  const query = await searchParams;
  const loaded = await loadDesign(wid, id);
  if (!loaded) return <main className="mx-auto max-w-md flex-1 px-4 py-16 text-center text-muted">{t.boards.notFound}</main>;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  return <DesignPlayer doc={loaded.doc} shortId={loaded.shortId} title={loaded.title} pageId={one(query.page)} flowId={one(query.flow)} frameId={one(query.frame)} />;
}
