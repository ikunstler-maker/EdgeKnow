"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { copyWishlist, type WishlistCard } from "@/app/wishlist-actions";
import { workspacePath } from "@/lib/paths";
import { LIGHT_GRADIENTS, WISHLIST_GRADIENTS, patternImage } from "@/lib/wishlist";
import { Icon } from "@/components/ui/icon";
import { buttonClass } from "@/components/ui/button";
import { birthdayLabel } from "./wishlist-view";

const w = t.wishlists;

function Card({ item, shortId, mine }: { item: WishlistCard; shortId: string; mine: boolean }) {
  const light = LIGHT_GRADIENTS.includes(item.design.gradient);
  const background = item.design.pattern ? `${patternImage(item.design.pattern)}, ${WISHLIST_GRADIENTS[item.design.gradient]}` : WISHLIST_GRADIENTS[item.design.gradient];
  return (
    <Link href={workspacePath(shortId, `/wishlists/${item.id}`)} className="group block overflow-hidden rounded-xl border border-border bg-surface transition hover:shadow-md" data-wishlist-card>
      <div className={`relative flex h-24 items-end p-3 ${light ? "text-slate-900" : "text-white"}`} style={{ backgroundImage: background }}>
        <span className="line-clamp-2 break-words text-base font-semibold leading-tight">{item.title || w.title}</span>
        {mine && !item.published && <span className="absolute right-2 top-2 rounded-md bg-black/40 px-1.5 py-0.5 text-[11px] font-medium text-white">{w.draft}</span>}
      </div>
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
        <Icon name="gift" size={12} />
        <span className="min-w-0 flex-1">{w.forBirthday(birthdayLabel(item.birthday))}</span>
        <span className="shrink-0">{w.wishCount(item.count)}</span>
      </div>
    </Link>
  );
}

// Wishlists as preview cards: the coming birthday's first, then other future ones; past
// ones folded into one compact line (the owner may copy one to the next birthday).
export function WishlistCards({ items, shortId, mine, today }: { items: WishlistCard[]; shortId: string; mine: boolean; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const coming = items.filter((x) => x.birthday >= today).sort((a, b) => a.birthday.localeCompare(b.birthday));
  const past = items.filter((x) => x.birthday < today);
  const copy = (id: string) =>
    startTransition(async () => {
      setError(null);
      const result = await copyWishlist(shortId, id);
      if (!result.ok) return setError(result.error === "exists" ? w.errors.copyExists : (w.errors[result.error] ?? w.errors.unknown));
      router.push(workspacePath(shortId, `/wishlists/${result.id}`));
    });
  if (!items.length) return null;
  return (
    <div className="space-y-3" data-wishlist-cards>
      {coming.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {coming.map((item) => <Card key={item.id} item={item} shortId={shortId} mine={mine} />)}
        </div>
      )}
      {past.length > 0 && (
        <div className="rounded-lg border border-border" data-wishlist-archive>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-11 w-full items-center gap-2 px-3 text-sm text-muted hover:text-foreground md:min-h-9">
            <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
            {w.archive(past.length)}
          </button>
          {open && (
            <ul className="divide-y divide-border border-t border-border">
              {past.map((item) => (
                <li key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-sm" data-wishlist-past>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: WISHLIST_GRADIENTS[item.design.gradient] }} aria-hidden="true" />
                  <Link href={workspacePath(shortId, `/wishlists/${item.id}`)} className="min-w-0 flex-1 truncate hover:text-accent">{item.title || w.title}</Link>
                  <span className="shrink-0 text-xs text-muted">{birthdayLabel(item.birthday)}</span>
                  {mine && (
                    <button type="button" disabled={pending} onClick={() => copy(item.id)} className={buttonClass("ghost")} data-wishlist-copy-past>
                      <Icon name="copy" size={14} />
                      <span className="hidden sm:inline">{w.copyToNext}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
