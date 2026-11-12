"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { createWishlist, type WishlistCard } from "@/app/wishlist-actions";
import { workspacePath } from "@/lib/paths";
import { WishlistCards } from "@/components/wishlists/wishlist-cards";
import { Icon } from "@/components/ui/icon";
import { buttonClass } from "@/components/ui/button";

const w = t.wishlists;

// One's own wishlists as cards, and the button that makes (or opens) the one for the
// next birthday.
export function MyWishlists({ shortId, wishlists, today }: { shortId: string; wishlists: WishlistCard[]; today: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const create = () =>
    startTransition(async () => {
      setError(null);
      const result = await createWishlist(shortId);
      const id = result.ok ? result.id : (result as { id?: string }).id;
      if (id) return router.push(workspacePath(shortId, `/wishlists/${id}`));
      setError(result.ok ? null : (w.errors[result.error] ?? w.errors.unknown));
    });
  const hasComing = wishlists.some((x) => x.birthday >= today);
  return (
    <section aria-labelledby="my-wishlists" className="rounded-xl border border-border bg-surface p-4" data-my-wishlists>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="my-wishlists" className="flex-1 text-sm font-semibold">{w.heading}</h2>
        <button type="button" disabled={pending} onClick={create} className={buttonClass(hasComing ? "subtle" : "primary")} data-wishlist-create>
          <Icon name="gift" size={14} />
          {hasComing ? w.open : w.create}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">{w.intro}</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-3">
        {wishlists.length ? <WishlistCards items={wishlists} shortId={shortId} mine today={today} /> : <p className="text-sm text-muted">{w.none}</p>}
      </div>
    </section>
  );
}
