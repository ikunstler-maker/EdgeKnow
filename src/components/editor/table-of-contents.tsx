"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";

export type Heading = { id: string; level: number; text: string };

// Headings H1–H3 anywhere in the document (including nested blocks), in order.
export function collectHeadings(blocks: readonly unknown[]): Heading[] {
  const out: Heading[] = [];
  const walk = (list: readonly unknown[]) => {
    for (const raw of list) {
      const block = raw as {
        id: string;
        type: string;
        props?: { level?: number };
        content?: unknown;
        children?: unknown[];
      };
      if (block.type === "heading" && (block.props?.level ?? 1) <= 3) {
        const text = Array.isArray(block.content)
          ? block.content.map((c) => (c as { text?: string }).text ?? "").join("")
          : "";
        if (text.trim()) out.push({ id: block.id, level: block.props?.level ?? 1, text: text.trim() });
      }
      if (block.children?.length) walk(block.children);
    }
  };
  walk(blocks);
  return out;
}

export function scrollToBlock(id: string) {
  const el = document.querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(id)}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // A shareable link to the section.
  history.replaceState(null, "", `#${id}`);
  return true;
}

// The heading the reader is in: the last one above the top quarter of the screen.
function useActiveHeading(headings: Heading[]) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!headings.length) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let current: string | null = headings[0].id;
        for (const h of headings) {
          const el = document.querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(h.id)}"]`);
          if (el && el.getBoundingClientRect().top < window.innerHeight * 0.25) current = h.id;
        }
        setActive(current);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [headings]);
  return active;
}

function HeadingList({ headings, active, onPick }: { headings: Heading[]; active: string | null; onPick?: () => void }) {
  if (!headings.length) return <p className="text-sm text-muted">{t.toc.empty}</p>;
  return (
    <ul className="flex flex-col">
      {headings.map((h) => (
        <li key={h.id}>
          <button
            type="button"
            onClick={() => {
              scrollToBlock(h.id);
              onPick?.();
            }}
            style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
            className={`w-full truncate rounded-md py-1.5 pr-2 text-left text-sm hover:bg-surface max-md:min-h-11 ${
              active === h.id ? "font-medium text-accent" : "text-muted"
            }`}
          >
            {h.text}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Desktop: a sticky column next to the text. Phone (and pages whose column holds
// comments): a "Зміст" button that opens a bottom sheet.
export function TableOfContents({ headings, asButton = false }: { headings: Heading[]; asButton?: boolean }) {
  const active = useActiveHeading(headings);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      {!asButton && (
        <nav aria-label={t.toc.title} className="sticky top-12 hidden max-h-[calc(100dvh-6rem)] overflow-y-auto xl:block">
          <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-muted">{t.toc.title}</p>
          <HeadingList headings={headings} active={active} />
        </nav>
      )}

      {headings.length > 0 && (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={`fixed bottom-4 right-4 z-30 min-h-11 rounded-full border border-border bg-background px-4 text-sm shadow-lg ${
            asButton ? "" : "xl:hidden"
          }`}
        >
          ☰ {t.toc.open}
        </button>
      )}

      {sheetOpen &&
        createPortal(
          <div className={`fixed inset-0 z-50 ${asButton ? "" : "xl:hidden"}`} onClick={() => setSheetOpen(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              role="dialog"
              aria-label={t.toc.title}
              onClick={(event) => event.stopPropagation()}
              className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-xl bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl"
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">{t.toc.title}</p>
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  aria-label={t.toc.close}
                  className="min-h-11 min-w-11"
                >
                  ✕
                </button>
              </div>
              <HeadingList headings={headings} active={active} onPick={() => setSheetOpen(false)} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
