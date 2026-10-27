"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { pagePath } from "@/lib/paths";
import { errorMessage } from "@/components/pages/pages-provider";
import { deletePageForever, restorePage } from "@/app/page-actions";

export type TrashItem = {
  id: string;
  title: string;
  icon: string | null;
  deletedLabel: string;
  daysLeft: number;
};

export function TrashList({ items, workspaceShortId }: { items: TrashItem[]; workspaceShortId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => setError(errorMessage(await action())));

  if (items.length === 0) {
    return <p className="mt-8 text-muted">{t.trash.empty}</p>;
  }

  return (
    <>
      <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <Link href={pagePath(workspaceShortId, item.id)} className="flex min-w-0 flex-1 items-center gap-2">
              <span>{item.icon ?? "📄"}</span>
              <span className="min-w-0">
                <span className="block truncate">{item.title}</span>
                <span className="block text-xs text-muted">
                  {item.deletedLabel} · {t.trash.daysLeft(item.daysLeft)}
                </span>
              </span>
            </Link>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => restorePage(item.id))}
              className="min-h-11 rounded-lg border border-border px-3 text-sm hover:bg-surface disabled:opacity-60"
            >
              {t.trash.restore}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm(t.trash.confirmDelete(item.title))) run(() => deletePageForever(item.id));
              }}
              className="min-h-11 rounded-lg border border-border px-3 text-sm text-danger hover:bg-surface disabled:opacity-60"
            >
              {t.trash.deleteForever}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
