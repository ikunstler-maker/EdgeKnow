import type { Metadata } from "next";
import { t } from "@/i18n";
import { loadDeck } from "@/lib/slides-server";
import { DeckPrint } from "@/components/slides/deck-print";

export const metadata: Metadata = { title: `${t.slides.print.title} · ${t.app.name}` };

// Pages for "Save as PDF" (?notes=1: with the speaker's notes).
export default async function DeckPrintPage({ params, searchParams }: PageProps<"/w/[wid]/slides/[id]/print">) {
  const { wid, id } = await params;
  const loaded = await loadDeck(wid, id);
  if (!loaded) return <main className="mx-auto max-w-md flex-1 px-4 py-16 text-center text-muted">{t.slides.notFound}</main>;
  return <DeckPrint deck={loaded.deck} shortId={loaded.shortId} title={loaded.title} notes={(await searchParams).notes === "1"} />;
}
