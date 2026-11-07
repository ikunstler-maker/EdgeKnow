import type { Metadata } from "next";
import { t } from "@/i18n";
import { loadDeck } from "@/lib/slides-server";
import { DeckPlayer } from "@/components/slides/deck-player";

export const metadata: Metadata = { title: `${t.slides.player.title} · ${t.app.name}` };

// The show (?presenter=1: the speaker's window; ?at=<n>: start at slide n).
export default async function DeckPlayPage({ params, searchParams }: PageProps<"/w/[wid]/slides/[id]/play">) {
  const { wid, id } = await params;
  const query = await searchParams;
  const loaded = await loadDeck(wid, id);
  if (!loaded) return <main className="mx-auto max-w-md flex-1 px-4 py-16 text-center text-muted">{t.slides.notFound}</main>;
  const at = Number(query.at);
  return <DeckPlayer deck={loaded.deck} deckId={id} shortId={loaded.shortId} title={loaded.title} presenter={query.presenter === "1"} startAt={Number.isFinite(at) && at > 0 ? at - 1 : 0} />;
}
