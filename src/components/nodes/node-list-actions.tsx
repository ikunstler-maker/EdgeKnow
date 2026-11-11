"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { createNodeMap, deleteNodeMapForever, trashNodeMap } from "@/app/node-actions";

const buttonClass = "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";

export function NewNodeMapButton({ shortId, kind = "mindmap" }: { shortId: string; kind?: "mindmap" | "flow" }) {
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
            const made = await createNodeMap(shortId, kind);
            if (!made.ok) return setError(t.nodes.errors[made.error] ?? t.common.unknownError);
            router.push(workspacePath(shortId, `/nodes/${made.id}`));
          })
        }
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium disabled:opacity-50 md:h-8 md:min-h-0 ${kind === "flow" ? "border border-border bg-hover hover:border-border-strong" : "bg-accent text-white"}`}
      >
        {kind === "flow" ? t.nodes.newFlow : t.nodes.newMap}
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
