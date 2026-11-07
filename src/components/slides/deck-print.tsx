"use client";

import { useEffect } from "react";
import { t } from "@/i18n";
import { sizeOf, type Deck } from "@/lib/slides";
import { SlideView } from "./slide-view";

// A deck as pages of its own size, one per slide (and the speaker's notes after each, if
// asked), then the browser's print window — where "Save as PDF" makes the file.
export function DeckPrint({ deck, shortId, title, notes }: { deck: Deck; shortId: string; title: string; notes: boolean }) {
  const size = sizeOf(deck);
  useEffect(() => {
    const images = Array.from(document.querySelectorAll<SVGImageElement>("[data-deck-print] image"));
    const ready = Promise.all(images.map((img) => new Promise((resolve) => {
      const probe = new Image();
      probe.onload = probe.onerror = () => resolve(null);
      probe.src = img.getAttribute("href") ?? "";
    })));
    const timer = setTimeout(() => void ready.then(() => window.print()), 300);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div data-deck-print>
      <style>{`
        @page { size: ${size.w}px ${size.h}px; margin: 0; }
        @media print {
          body * { visibility: hidden; }
          [data-deck-print], [data-deck-print] * { visibility: visible; }
          [data-deck-print] { position: absolute; left: 0; top: 0; }
          [data-print-hint] { display: none; }
        }
        [data-print-page] { width: ${size.w}px; height: ${size.h}px; break-after: page; page-break-after: always; overflow: hidden; }
      `}</style>
      <p className="p-4 text-sm text-muted" data-print-hint>
        {t.slides.print.hint(title || t.slides.untitled)}
      </p>
      {deck.slides.map((slide, i) => (
        <div key={slide.id}>
          <div data-print-page>
            <SlideView slide={slide} shortId={shortId} size={size} prefix={`pr${i}`} className="block h-full w-full" />
          </div>
          {notes && (
            <div data-print-page className="bg-white p-16 text-black" style={{ fontSize: Math.round(size.h / 30) }}>
              <p className="mb-4 font-bold">{t.slides.slideN(i + 1)}</p>
              <p className="whitespace-pre-wrap">{slide.notes || "—"}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
