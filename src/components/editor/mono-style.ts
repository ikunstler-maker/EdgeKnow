"use client";

import { createStyleSpec } from "@blocknote/core";

// Monospace text: the code font without the code background.
export const monoStyle = createStyleSpec(
  { type: "mono", propSchema: "boolean" },
  {
    render: () => {
      const span = document.createElement("span");
      span.className = "ek-mono";
      return { dom: span, contentDOM: span };
    },
  },
);
