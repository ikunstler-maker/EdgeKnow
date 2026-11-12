import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { readWishlist } from "@/lib/wishlist";
import { getWorkspace } from "@/lib/workspace";
import { WishlistEditor } from "@/components/wishlists/wishlist-editor";
import { WishlistView } from "@/components/wishlists/wishlist-view";
import { loadWishlistGifts } from "@/app/wishlist-actions";
import { Icon } from "@/components/ui/icon";

export const metadata: Metadata = { title: `${t.wishlists.title} · ${t.app.name}` };

type Row = { id: string; title: string; data: unknown; version: number; owner_id: string };

// A wishlist: its owner edits it here (with a live preview); a colleague who may see it
// views it. Anyone else gets the same page as for a missing one.
export default async function WishlistPage({ params }: PageProps<"/w/[wid]/wishlists/[id]">) {
  const { wid, id } = await params;
  const workspace = await getWorkspace(wid);
  const notFound = (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{t.wishlists.notFoundTitle}</h1>
      <p className="mt-3 text-muted">{t.wishlists.notFound}</p>
    </main>
  );
  if (!workspace || !/^[0-9a-f-]{36}$/.test(id)) return notFound;
  const user = await getCurrentUser();
  const db = await dataClient(wid);
  const { data } = await db.from("service_objects").select("id, title, data, version, owner_id").eq("id", id).eq("service", "wishlists").is("deleted_at", null).maybeSingle();
  const row = data as Row | null;
  if (!row) return notFound;
  const wishlist = readWishlist(row.data);
  const mine = row.owner_id === user.id;
  const { data: owner } = await db.from("profiles").select("name, email").eq("id", row.owner_id).maybeSingle();
  const ownerName = (owner?.name as string | null) || (owner?.email as string | undefined) || "";
  const gifts = mine ? null : await loadWishlistGifts(wid, row.id);

  return (
    <main className={`mx-auto w-full flex-1 space-y-4 px-4 py-6 md:py-8 ${mine ? "max-w-6xl" : "max-w-4xl"}`}>
      <Link href={workspacePath(workspace.shortId, mine ? "/profile" : `/profile/${row.owner_id}`)} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-foreground md:min-h-0">
        <Icon name="arrow-left" size={14} />
        {mine ? t.wishlists.backToProfile : t.wishlists.backTo(ownerName)}
      </Link>
      {mine ? (
        <WishlistEditor shortId={workspace.shortId} id={row.id} initialTitle={row.title} initialData={wishlist} initialVersion={row.version} ownerName={ownerName} />
      ) : (
        <WishlistView title={row.title} data={wishlist} shortId={workspace.shortId} ownerName={ownerName} gifts={gifts ? { wishlistId: row.id, list: gifts } : undefined} />
      )}
    </main>
  );
}
