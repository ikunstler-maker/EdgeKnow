"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { createBoard, createDesign, deleteBoardForever, trashBoard } from "@/app/board-actions";

const buttonClass = "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";

// Bordy «Дизайн»: a design file next to the idea boards.
export function NewDesignButton({ shortId }: { shortId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const made = await createDesign(shortId);
          if (made.ok) router.push(workspacePath(shortId, `/boards/${made.id}`));
        })
      }
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0"
      data-new-design
    >
      {t.design.newDesign}
    </button>
  );
}

export function NewBoardButton({ shortId }: { shortId: string }) {
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
            const made = await createBoard(shortId);
            if (!made.ok) return setError(t.boards.errors[made.error] ?? t.common.unknownError);
            router.push(workspacePath(shortId, `/boards/${made.id}`));
          })
        }
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50 md:h-8 md:min-h-0"
      >
        {t.boards.newBoard}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}

export function BoardBinActions({ shortId, id, title }: { shortId: string; id: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<unknown>) =>
    startTransition(async () => {
      await action();
      router.refresh();
    });
  return (
    <div className="flex gap-2">
      <button type="button" disabled={pending} onClick={() => run(() => trashBoard(shortId, id, true))} className={buttonClass}>
        {t.boards.restore}
      </button>
      <button type="button" disabled={pending} onClick={() => confirm(t.boards.deleteForeverConfirm(title)) && run(() => deleteBoardForever(shortId, id))} className={`${buttonClass} text-danger`}>
        {t.boards.deleteForever}
      </button>
    </div>
  );
}
