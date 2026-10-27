"use client";

import { t } from "@/i18n";
import { usePages } from "./pages-provider";

export function NewPageButton() {
  const { create, pending } = usePages();
  return (
    <button
      type="button"
      onClick={() => create(null)}
      disabled={pending}
      className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-60"
    >
      ＋ {t.sidebar.newPage}
    </button>
  );
}
