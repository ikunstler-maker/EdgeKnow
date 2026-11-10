"use client";

import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { PageBody } from "@/components/editor/page-body";

const p = t.pageExport.print;
// Waits for the editor, the embeds and the pictures, but never longer than this.
const MAX_WAIT_MS = 20_000;
// Everything must stay loaded this long (embeds can start more loading after the first).
const QUIET_MS = 1_200;

function settled(root: HTMLElement): boolean {
  if (!root.querySelector(".bn-editor")) return false;
  if (root.querySelector("[data-export-loading], [data-task-chip='loading']")) return false;
  return Array.from(root.querySelectorAll("img")).every((img) => img.complete);
}

// The page as the reader sees it (live embeds with their own access; what they can't
// see shows "no access" without a name), then the browser's print window.
export function PagePrint({ pageId, title, icon, content, version, userId }: { pageId: string; title: string; icon: string | null; content: unknown; version: number; userId: string }) {
  const [ready, setReady] = useState(false);
  const print = useCallback(() => window.print(), []);

  // Printed on light paper whatever the screen theme; put back on leaving.
  useEffect(() => {
    const html = document.documentElement;
    const before = html.dataset.theme;
    html.dataset.theme = "light";
    return () => {
      if (before === undefined) delete html.dataset.theme;
      else html.dataset.theme = before;
    };
  }, []);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-page-print]");
    if (!root) return;
    const started = Date.now();
    let quietSince = 0;
    let done = false;
    const timer = setInterval(() => {
      // Pictures further down the page load now, not when scrolled to.
      root.querySelectorAll<HTMLImageElement>("img[loading='lazy']").forEach((img) => (img.loading = "eager"));
      const now = Date.now();
      if (settled(root)) quietSince ||= now;
      else quietSince = 0;
      if (!done && ((quietSince && now - quietSince >= QUIET_MS) || now - started >= MAX_WAIT_MS)) {
        done = true;
        clearInterval(timer);
        setReady(true);
        window.print();
      }
    }, 300);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6" data-page-print>
      <style>{`
        @page { size: A4; margin: 16mm 14mm; }
        @media print {
          body * { visibility: hidden; }
          [data-page-print], [data-page-print] * { visibility: visible; }
          [data-page-print] { position: absolute; left: 0; top: 0; width: 100%; max-width: none; padding: 0; }
          [data-print-hint] { display: none !important; }
          [data-page-print] .bn-block-outer, [data-page-print] img, [data-page-print] table, [data-page-print] [contenteditable="false"] { break-inside: avoid; }
          [data-page-print] h1, [data-page-print] h2, [data-page-print] h3, [data-page-print] h4 { break-after: avoid; }
        }
      `}</style>
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3 text-sm" data-print-hint>
        <p className="flex-1">{ready ? p.hint(title) : p.waiting}</p>
        <button type="button" onClick={print} className="min-h-11 rounded-md border border-border bg-background px-3 hover:bg-surface md:min-h-9">
          {p.again}
        </button>
      </div>
      {icon && <div className="text-5xl">{icon}</div>}
      <h1 className="mt-2 text-4xl font-bold">{title}</h1>
      <div className="mt-6">
        <PageBody pageId={pageId} initialContent={content} initialVersion={version} editable={false} canComment={false} userId={userId} threads={[]} people={{}} print />
      </div>
    </div>
  );
}
