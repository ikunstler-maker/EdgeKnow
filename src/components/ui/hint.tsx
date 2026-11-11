"use client";

import { useId, useState } from "react";
import { Icon } from "./icon";

// A small "i" beside a heading or a control: the explanation shows on hover, on
// keyboard focus and on a tap, instead of sitting on the page as a paragraph.
export function Hint({ text, label }: { text: string; label: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60 md:h-6 md:w-6"
      >
        <Icon name="info" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-full z-40 mt-1 w-64 max-w-[80vw] rounded-lg border border-border-strong bg-overlay p-3 text-xs font-normal leading-relaxed text-foreground shadow-xl"
        >
          {text}
        </span>
      )}
    </span>
  );
}
