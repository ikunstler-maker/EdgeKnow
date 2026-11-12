"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { giveWish, ungiveWish, type WishlistGift } from "@/app/wishlist-actions";
import { Icon } from "@/components/ui/icon";

const w = t.wishlists;

// Under a wish, for colleagues: who gives it and who chips in, and one's own part.
export function GiftBar({ shortId, wishlistId, item, gifts, light, accent }: {
  shortId: string;
  wishlistId: string;
  item: string;
  gifts: WishlistGift[];
  light: boolean;
  accent: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const giver = gifts.find((g) => g.kind === "gives");
  const chips = gifts.filter((g) => g.kind === "chips_in");
  const mine = gifts.find((g) => g.mine);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) return setError(w.errors[result.error ?? ""] ?? w.errors.unknown);
      router.refresh();
    });
  const ghost = `inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-medium md:min-h-8 ${light ? "bg-slate-900/10 hover:bg-slate-900/15" : "bg-white/15 hover:bg-white/25"}`;
  return (
    <div className={`mt-2 space-y-1.5 border-t pt-2 text-xs ${light ? "border-slate-900/10" : "border-white/20"}`} data-gift-bar>
      {giver && (
        <p data-gift-giver>
          <Icon name="gift" size={12} className="mr-1 inline" />
          {giver.mine ? w.youGive : w.gives(giver.name)}
        </p>
      )}
      {chips.length > 0 && <p data-gift-chips>{w.chipIn(chips.map((c) => (c.mine ? w.you : c.name)).join(", "))}</p>}
      <div className="flex flex-wrap gap-1.5">
        {!mine && !giver && (
          <button type="button" disabled={pending} onClick={() => run(() => giveWish(shortId, wishlistId, item, "gives"))} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-semibold text-white md:min-h-8" style={{ background: accent }} data-gift-give>
            <Icon name="gift" size={12} />
            {w.iGive}
          </button>
        )}
        {!mine && (
          <button type="button" disabled={pending} onClick={() => run(() => giveWish(shortId, wishlistId, item, "chips_in"))} className={ghost} data-gift-chip>
            <Icon name="users" size={12} />
            {giver ? w.joinChipIn : w.iChipIn}
          </button>
        )}
        {mine && (
          <button type="button" disabled={pending} onClick={() => run(() => ungiveWish(shortId, wishlistId, item))} className={ghost} data-gift-cancel>
            <Icon name="close" size={12} />
            {mine.kind === "gives" ? w.cancelGive : w.cancelChipIn}
          </button>
        )}
      </div>
      {error && <p role="alert" className="font-medium">{error}</p>}
    </div>
  );
}
