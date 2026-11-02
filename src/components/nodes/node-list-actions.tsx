"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { createNodeMap, deleteNodeMapForever, trashNodeMap } from "@/app/node-actions";

const buttonClass = "inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";

export function NewNodeMapButton({ shortId }: { shortId: string }) {
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
            const made = await createNodeMap(shortId, "mindmap");
            if (!made.ok) return setError(t.nodes.errors[made.error] ?? t.common.unknownError);
            router.push(workspacePath(shortId, `/nodes/${made.id}`));
          })
        }
        className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60 md:min-h-9"
      >
        {t.nodes.newMap}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}

export function NodeBinActions({ shortId, id, title }: { shortId: string; id: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<unknown>) =>
    startTransition(async () => {
      await action();
      router.refresh();
    });
  return (
    <div className="flex gap-2">
      <button type="button" disabled={pending} onClick={() => run(() => trashNodeMap(shortId, id, true))} className={buttonClass}>
        {t.nodes.restore}
      </button>
      <button type="button" disabled={pending} onClick={() => confirm(t.nodes.deleteForeverConfirm(title)) && run(() => deleteNodeMapForever(shortId, id))} className={`${buttonClass} text-danger`}>
        {t.nodes.deleteForever}
      </button>
    </div>
  );
}
