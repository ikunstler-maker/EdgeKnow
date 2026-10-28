"use client";

import { createReactBlockSpec } from "@blocknote/react";

// "Підзаголовок", as in Google Docs: a larger, muted line under the title. It is
// not a heading, so it stays out of the table of contents.
export const subtitleBlock = createReactBlockSpec(
  {
    type: "subtitle",
    propSchema: {},
    content: "inline",
  },
  {
    render: ({ contentRef }) => <p className="ek-subtitle" ref={contentRef} />,
  },
);
