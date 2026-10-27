"use client";

import { useTransition } from "react";
import { t } from "@/i18n";
import { restorePage } from "@/app/page-actions";

export function TrashedBanner({ trashRootId }: { trashRootId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm">
      <span className="flex-1">{t.pages.inTrashBanner}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => void (await restorePage(trashRootId)))}
        className="min-h-11 rounded-md border border-border bg-background px-3 hover:bg-surface disabled:opacity-60"
      >
        {t.pages.restore}
      </button>
    </div>
  );
}
