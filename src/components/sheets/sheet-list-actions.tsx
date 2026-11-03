"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { createSheet, deleteSheetForever, trashSheet } from "@/app/sheet-actions";

const buttonClass = "inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";

export function NewSheetButton({ shortId }: { shortId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const made = await createSheet(shortId);
            if (!made.ok) return setError(t.sheets.errors[made.error] ?? t.common.unknownError);
            router.push(workspacePath(shortId, `/sheets/${made.id}`));
          })
        }
        className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60 md:min-h-9"
      >
        {t.sheets.newSheet}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}

export function SheetBinActions({ shortId, id, title }: { shortId: string; id: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<unknown>) =>
    startTransition(async () => {
      await action();
      router.refresh();
    });
  return (
    <div className="flex gap-2">
      <button type="button" disabled={pending} onClick={() => run(() => trashSheet(shortId, id, true))} className={buttonClass}>
        {t.sheets.restore}
      </button>
      <button type="button" disabled={pending} onClick={() => confirm(t.sheets.deleteForeverConfirm(title)) && run(() => deleteSheetForever(shortId, id))} className={`${buttonClass} text-danger`}>
        {t.sheets.deleteForever}
      </button>
    </div>
  );
}
