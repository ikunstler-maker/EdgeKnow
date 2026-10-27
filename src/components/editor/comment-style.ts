"use client";

import { createStyleSpec } from "@blocknote/core";

// The commented fragment: a style whose value is the thread id. It moves with the
// text on every edit; the highlight itself comes from CSS for open threads only.
export function commentStyle() {
  const spec = createStyleSpec(
    { type: "comment", propSchema: "string" },
    {
      render: (value) => {
        const span = document.createElement("span");
        span.className = "ek-comment";
        if (value) span.dataset.commentThread = value;
        return { dom: span, contentDOM: span };
      },
    },
  );
  // Typing right after a commented fragment doesn't extend it.
  spec.implementation.mark = spec.implementation.mark.extend({ inclusive: false });
  return spec;
}
