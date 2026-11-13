"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { addTaskWishlist, deleteTaskWishlist } from "@/app/task-actions";
import { WishlistEmbed, WishlistPicker } from "@/components/wishlists/wishlist-embed";
import { Icon } from "@/components/ui/icon";
import { buttonClass, iconButtonClass } from "@/components/ui/button";

const e = t.wishlists.embed;

export type TaskWishlistLink = { id: string; wishlist_id: string; added_by: string | null };

// Colleagues' wishlists linked to a task: live cards, each checked against the reader's
// own access; linking and unlinking follow the task's file rights.
export function TaskWishlists({ shortId, taskId, links, me, canAdd, canDeleteOwn, canDeleteAny }: {
  shortId: string;
  taskId: string;
  links: TaskWishlistLink[];
  me: string;
  canAdd: boolean;
  canDeleteOwn: boolean;
  canDeleteAny: boolean;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!links.length && !canAdd) return null;
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) return setError(t.wishlists.errors[result.error ?? ""] ?? t.wishlists.errors.unknown);
      setPicking(false);
      router.refresh();
    });
  return (
    <section className="mt-5" aria-labelledby={`task-wishlists-${taskId}`} data-task-wishlists>
      <div className="flex items-center gap-2">
        <h2 id={`task-wishlists-${taskId}`} className="flex-1 text-sm font-medium text-muted">{e.heading}</h2>
        {canAdd && !picking && (
          <button type="button" className={buttonClass("ghost")} onClick={() => setPicking(true)} data-task-wishlist-add>
            <Icon name="gift" size={14} />
            {e.attach}
          </button>
        )}
      </div>
      {picking && (
        <div className="mt-2">
          <WishlistPicker shortId={shortId} onPick={(id) => run(() => addTaskWishlist(taskId, id))} />
          <button type="button" className={buttonClass("ghost", "mt-1")} onClick={() => setPicking(false)}>{t.common.cancel}</button>
        </div>
      )}
      {links.length > 0 && (
        <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {links.map((link) => {
            const removable = link.added_by === me ? canDeleteOwn : canDeleteAny;
            return (
              <li key={link.id} className="relative" data-task-wishlist>
                <WishlistEmbed shortId={shortId} wishlistId={link.wishlist_id} editable={false} onPick={() => {}} compact />
                {removable && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => deleteTaskWishlist(link.id))}
                    className={iconButtonClass("subtle", "absolute right-1.5 top-1.5")}
                    aria-label={e.detach}
                    title={e.detach}
                    data-task-wishlist-remove
                  >
                    <Icon name="close" size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </section>
  );
}
