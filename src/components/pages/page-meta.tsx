"use client";

import { useSyncExternalStore } from "react";
import { t } from "@/i18n";

const noop = () => () => {};

// Dates are formatted in the viewer's own time zone, so they render only in the
// browser (the server doesn't know the reader's zone).
function LocalTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    noop,
    () =>
      new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(iso),
      ),
    () => "",
  );
  return <time dateTime={iso}>{text}</time>;
}

export function PageMeta({
  author,
  createdAt,
  updatedAt,
}: {
  author: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return (
    <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
      {author && (
        <span>
          {t.pageMeta.author}: {author}
        </span>
      )}
      <span>
        {t.pageMeta.created} <LocalTime iso={createdAt} />
      </span>
      <span>
        {t.pageMeta.updated} <LocalTime iso={updatedAt} />
      </span>
    </p>
  );
}
