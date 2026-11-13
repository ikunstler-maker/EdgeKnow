import type { Metadata } from "next";
import { t } from "@/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import { filesHome } from "@/lib/drive/task-files";
import { readDeck } from "@/lib/slides";
import { DeckPlayer } from "@/components/slides/deck-player";

export const metadata: Metadata = { title: `${t.slides.player.title} · ${t.app.name}`, robots: { index: false, follow: false } };

// A presentation's show through its link (KADRY-1): open to anyone with the link, signed in
// or not, while the deck's owner keeps the link on. Only the slides come through — embeds of
// other services show as placeholders, pictures through the link's own route.
export default async function PublicShowPage({ params }: PageProps<"/s/[ws]/[token]">) {
  const { ws, token } = await params;
  const missing = <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center text-muted" data-public-show-missing>{t.slides.publicShow.notFound}</main>;
  const admin = createAdminClient();
  if (!admin || !/^[a-z0-9]{4,16}$/.test(ws) || !/^[0-9a-f]{32}$/.test(token)) return missing;
  const { data: workspace } = await admin.from("workspaces").select("id").eq("short_id", ws).maybeSingle();
  if (!workspace) return missing;
  const { rows } = await filesHome(admin, workspace.id).catch(() => ({ rows: null }));
  if (!rows) return missing;
  const { data } = await rows.rpc("public_deck", { token });
  const deck = data as { ok: true; id: string; title: string; data: unknown } | { ok: false } | null;
  if (!deck?.ok) return missing;
  return <DeckPlayer deck={readDeck(deck.data)} deckId={deck.id} shortId={`public/${ws}/${token}`} title={deck.title} presenter={false} publicShow />;
}
