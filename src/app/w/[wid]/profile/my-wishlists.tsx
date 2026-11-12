"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { createWishlist, type MyWishlist } from "@/app/wishlist-actions";
import { workspacePath } from "@/lib/paths";
import { birthdayLabel } from "@/components/wishlists/wishlist-view";
import { Icon } from "@/components/ui/icon";
import { buttonClass } from "@/components/ui/button";

const w = t.wishlists;

// One's own wishlists and the button that makes (or opens) the one for the next birthday.
// Step 3 turns this into preview cards with past ones folded away.
export function MyWishlists({ shortId, wishlists }: { shortId: string; wishlists: MyWishlist[] }) {
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
  return (
    <section aria-labelledby="my-wishlists" className="rounded-xl border border-border bg-surface p-4" data-my-wishlists>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="my-wishlists" className="flex-1 text-sm font-semibold">{w.heading}</h2>
        <button type="button" disabled={pending} onClick={create} className={buttonClass("primary")} data-wishlist-create>
          <Icon name="gift" size={14} />
          {w.create}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">{w.intro}</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {wishlists.length ? (
        <ul className="mt-3 divide-y divide-border">
          {wishlists.map((item) => (
            <li key={item.id}>
              <Link href={workspacePath(shortId, `/wishlists/${item.id}`)} className="flex min-h-11 items-center gap-2 py-1.5 text-sm hover:text-accent" data-my-wishlist>
                <Icon name="gift" size={14} className="text-muted" />
                <span className="min-w-0 flex-1 truncate">{item.title || w.title}</span>
                <span className="text-xs text-muted">{birthdayLabel(item.birthday)}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-xs ${item.published ? "bg-accent/15 text-accent" : "bg-hover text-muted"}`}>{item.published ? w.published : w.draft}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">{w.none}</p>
      )}
    </section>
  );
}
