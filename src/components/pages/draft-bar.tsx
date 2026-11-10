"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { publishPage } from "@/app/page-actions";
import { usePages } from "./pages-provider";

const d = t.drafts;

// Under the title of an unpublished page: who sees it, and "Publish" for its author
// and editors (optionally with the pages inside it). A published page inside a draft
// only says so.
export function DraftBar({ pageId, ownDraft, canPublish }: { pageId: string; ownDraft: boolean; canPublish: boolean }) {
  const { pages } = usePages();
  const router = useRouter();
  const [withChildren, setWithChildren] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Pages inside this one that the reader sees (publishing skips the ones they can't edit).
  const inside = (() => {
    const found = new Set<string>();
    let frontier = [pageId];
    while (frontier.length) {
      const next = pages.filter((p) => p.parentId && frontier.includes(p.parentId) && !found.has(p.id)).map((p) => p.id);
      next.forEach((id) => found.add(id));
      frontier = next;
    }
    return found.size;
  })();

  if (!ownDraft) {
    return (
      <p className="mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted" data-draft-bar="inside">
        {d.underDraft}
      </p>
    );
  }

  const publish = () =>
    startTransition(async () => {
      setStatus(null);
      const result = await publishPage(pageId, inside > 0 && withChildren);
      if (result.ok) {
        setStatus(d.published((result as { published?: number }).published ?? 1));
        router.refresh();
      } else {
        setStatus(d.errors[result.error] ?? t.common.unknownError);
      }
    });

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm" data-draft-bar="own">
      <span className="rounded border border-border px-1.5 text-xs font-medium text-muted">{d.badge}</span>
      <p className="min-w-0 flex-1 text-muted">{d.note}</p>
      {canPublish && (
        <div className="flex flex-wrap items-center gap-3">
          {inside > 0 && (
            <label className="flex min-h-11 items-center gap-2 md:min-h-9">
              <input type="checkbox" checked={withChildren} onChange={(event) => setWithChildren(event.target.checked)} className="h-4 w-4" />
              {d.withChildren(inside)}
            </label>
          )}
          <button
            type="button"
            onClick={publish}
            disabled={pending}
            className="min-h-11 rounded-md bg-accent px-3 font-medium text-white disabled:opacity-60 md:min-h-9"
            data-publish-page
          >
            {pending ? d.publishing : d.publish}
          </button>
        </div>
      )}
      {status && (
        <p role="status" className="w-full text-sm">
          {status}
        </p>
      )}
    </div>
  );
}
