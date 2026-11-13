"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { wishlistEmbedView, wishlistsForEmbed, type WishlistEmbedView } from "@/app/wishlist-actions";
import { workspacePath } from "@/lib/paths";
import { LIGHT_GRADIENTS, WISHLIST_GRADIENTS, patternImage } from "@/lib/wishlist";
import { Icon } from "@/components/ui/icon";
import { birthdayLabel } from "./wishlist-view";

const w = t.wishlists;
const e = t.wishlists.embed;

// The live card of a wishlist inside another service: what shows is read with the
// viewer's own access every time; without it, only "unavailable", never the name.
export function WishlistEmbedCard({ shortId, view, compact }: { shortId: string; view: WishlistEmbedView; compact?: boolean }) {
  const light = LIGHT_GRADIENTS.includes(view.design.gradient);
  const background = view.design.pattern ? `${patternImage(view.design.pattern)}, ${WISHLIST_GRADIENTS[view.design.gradient]}` : WISHLIST_GRADIENTS[view.design.gradient];
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface" data-wishlist-embed-card>
      <div className={`flex flex-1 flex-col justify-end gap-0.5 p-3 ${compact ? "min-h-14" : "min-h-24"} ${light ? "text-slate-900" : "text-white"}`} style={{ backgroundImage: background }}>
        <span className="text-xs font-medium opacity-80">{view.ownerName}</span>
        <span className="line-clamp-2 break-words text-base font-semibold leading-tight">{view.title || w.title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-muted">
        <Icon name="gift" size={12} />
        <span className="min-w-0 flex-1">{w.forBirthday(birthdayLabel(view.birthday))} · {w.wishCount(view.count)}</span>
        <Link href={workspacePath(shortId, `/wishlists/${view.id}`)} className="inline-flex min-h-11 items-center gap-1 font-medium text-accent hover:underline md:min-h-0" data-wishlist-embed-open>
          {e.open}
          <Icon name="arrow-up-right" size={12} />
        </Link>
      </div>
    </div>
  );
}

export function WishlistUnavailable() {
  return (
    <p className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-3 text-sm text-muted" data-wishlist-unavailable>
      <Icon name="lock" size={14} />
      {e.unavailable}
    </p>
  );
}

// Choosing a wishlist: published ones the person may see, searched by owner or title.
export function WishlistPicker({ shortId, onPick }: { shortId: string; onPick: (id: string) => void }) {
  const [list, setList] = useState<WishlistEmbedView[] | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let alive = true;
    wishlistsForEmbed(shortId).then((items) => alive && setList(items));
    return () => {
      alive = false;
    };
  }, [shortId]);
  const q = query.trim().toLowerCase();
  const shown = (list ?? []).filter((x) => !q || x.ownerName.toLowerCase().includes(q) || x.title.toLowerCase().includes(q)).slice(0, 30);
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3" data-wishlist-picker>
      <p className="flex items-center gap-1.5 text-sm font-medium"><Icon name="gift" size={14} />{e.pick}</p>
      <input
        value={query}
        onChange={(ev) => setQuery(ev.target.value)}
        placeholder={e.search}
        aria-label={e.search}
        className="min-h-11 w-full rounded-lg border border-border bg-background px-2 text-base md:min-h-9 md:text-sm"
      />
      {list === null ? (
        <p className="text-sm text-muted">{e.loading}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">{e.none}</p>
      ) : (
        <ul className="max-h-64 divide-y divide-border overflow-auto">
          {shown.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => onPick(x.id)} className="flex min-h-11 w-full items-center gap-2 px-1 text-left text-sm hover:bg-hover md:min-h-9" data-wishlist-pick={x.id}>
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: WISHLIST_GRADIENTS[x.design.gradient] }} aria-hidden="true" />
                <span className="font-medium">{x.ownerName}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{x.title || w.title}</span>
                <span className="shrink-0 text-xs text-muted">{birthdayLabel(x.birthday)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// An embed: the picker while nothing is chosen (for who may edit), then the live card.
export function WishlistEmbed({ shortId, wishlistId, editable, onPick, compact }: {
  shortId: string;
  wishlistId: string;
  editable: boolean;
  onPick: (id: string) => void;
  compact?: boolean;
}) {
  const [view, setView] = useState<WishlistEmbedView | null | undefined>(undefined);
  useEffect(() => {
    if (!shortId || !wishlistId) return;
    let alive = true;
    wishlistEmbedView(shortId, wishlistId).then((v) => alive && setView(v));
    return () => {
      alive = false;
    };
  }, [shortId, wishlistId]);
  if (!wishlistId) return editable && shortId ? <WishlistPicker shortId={shortId} onPick={onPick} /> : null;
  if (view === undefined) return <p className="p-3 text-sm text-muted" data-export-loading>{e.loading}</p>;
  if (view === null) return <WishlistUnavailable />;
  return <WishlistEmbedCard shortId={shortId} view={view} compact={compact} />;
}
