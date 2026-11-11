"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { createSheet, deleteSheetForever, trashSheet } from "@/app/sheet-actions";

const buttonClass = "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";

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
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50 md:h-8 md:min-h-0"
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
