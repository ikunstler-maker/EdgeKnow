"use client";

import { useState } from "react";
import { t } from "@/i18n";
import { ASPECTS, MAX_SIDE, MIN_SIDE, aspectOf, aspectSize, type Size } from "@/lib/slides";
import { Icon } from "@/components/ui/icon";

const z = t.slides.size;
const chip = (on: boolean) => `min-h-11 rounded-md border px-2 text-sm hover:bg-surface md:min-h-9 ${on ? "border-accent bg-accent/10" : "border-border"}`;

// The deck's slide size: a ratio (the long side 1920) or own pixels; changeable at any
// time — what is on the slides is fitted into the new size (or left where it is).
export function SizePicker({ size, onChange }: { size: Size; onChange: (size: Size, fit: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState(String(size.w));
  const [h, setH] = useState(String(size.h));
  const [fit, setFit] = useState(true);
  const current = aspectOf(size);
  const apply = (next: Size) => {
    if (next.w === size.w && next.h === size.h) return;
    onChange(next, fit);
    setW(String(next.w));
    setH(String(next.h));
  };
  const own = { w: Math.round(Number(w)), h: Math.round(Number(h)) };
  const ownOk = own.w >= MIN_SIDE && own.w <= MAX_SIDE && own.h >= MIN_SIDE && own.h <= MAX_SIDE;
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => {
          setW(String(size.w));
          setH(String(size.h));
          setOpen(!open);
        }}
        aria-expanded={open}
        className={chip(open)}
        title={z.title}
        data-size-button
      >
        <Icon name="template" className="mr-1 inline" />
        {current ?? z.custom} · {size.w}×{size.h}
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-72 space-y-3 rounded-lg border border-border bg-background p-3 text-sm shadow-xl" role="dialog" aria-label={z.title} data-size-dialog>
          <p className="font-medium">{z.title}</p>
          <div className="grid grid-cols-4 gap-1">
            {ASPECTS.map((a) => (
              <button key={a} type="button" onClick={() => apply(aspectSize(a))} aria-pressed={current === a} className={chip(current === a)} data-aspect={a}>
                {a}
              </button>
            ))}
          </div>
          <fieldset className="space-y-1">
            <legend className="text-xs text-muted">{z.own}</legend>
            <div className="flex items-end gap-1">
              <label className="flex flex-1 flex-col text-xs text-muted">
                {z.width}
                <input type="number" min={MIN_SIDE} max={MAX_SIDE} value={w} onChange={(e) => setW(e.target.value)} className="min-h-11 rounded-md border border-border bg-background px-2 text-sm text-foreground md:min-h-9" data-size-w />
              </label>
              <span className="pb-2">×</span>
              <label className="flex flex-1 flex-col text-xs text-muted">
                {z.height}
                <input type="number" min={MIN_SIDE} max={MAX_SIDE} value={h} onChange={(e) => setH(e.target.value)} className="min-h-11 rounded-md border border-border bg-background px-2 text-sm text-foreground md:min-h-9" data-size-h />
              </label>
              <button type="button" disabled={!ownOk} onClick={() => apply(own)} className={chip(false)} data-size-apply>
                {z.apply}
              </button>
            </div>
            {!ownOk && <p className="text-xs text-danger">{z.limits(MIN_SIDE, MAX_SIDE)}</p>}
          </fieldset>
          <label className="flex min-h-11 items-center gap-2 md:min-h-9">
            <input type="checkbox" className="h-5 w-5" checked={fit} onChange={(e) => setFit(e.target.checked)} data-size-fit />
            {z.fit}
          </label>
          <p className="text-xs text-muted">{z.hint}</p>
          <button type="button" onClick={() => setOpen(false)} className={`${chip(false)} w-full`}>
            {t.common.close}
          </button>
        </div>
      )}
    </span>
  );
}
