"use client";

import {
  BlockNoteSchema,
  createCodeBlockSpec,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";
import { t } from "@/i18n";
import { calloutBlock } from "./callout-block";
import { commentStyle } from "./comment-style";
import { diagramBlock } from "./diagram-block";
import { youTubeBlock } from "./youtube-block";

// Code blocks with a "Copy" button next to the language picker.
function codeBlockWithCopy() {
  const spec = createCodeBlockSpec({ ...codeBlockOptions, defaultLanguage: "text" });
  const render = spec.implementation.render;
  if (!render) return spec;
  return {
    ...spec,
    implementation: {
      ...spec.implementation,
      // A plain function: BlockNote calls render with its own `this`.
      render(this: ThisParameterType<typeof render>, ...args: Parameters<typeof render>) {
        const view = render.apply(this, args);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ek-code-copy";
        button.contentEditable = "false";
        button.textContent = t.editor.copy;
        button.addEventListener("click", async () => {
          const code = view.contentDOM?.textContent ?? "";
          try {
            await navigator.clipboard.writeText(code);
            button.textContent = t.editor.copied;
            setTimeout(() => (button.textContent = t.editor.copy), 1500);
          } catch {
            // Clipboard blocked; the text can still be selected by hand.
          }
        });
        view.dom.appendChild(button);
        return view;
      },
    },
  };
}

// Images load only when scrolled near (SPEC: lazy loading on phones).
function lazyImage() {
  const spec = defaultBlockSpecs.image;
  const render = spec.implementation.render;
  if (!render) return spec;
  return {
    ...spec,
    implementation: {
      ...spec.implementation,
      render(this: ThisParameterType<typeof render>, ...args: Parameters<typeof render>) {
        const view = render.apply(this, args);
        view.dom.querySelectorAll("img").forEach((img) => (img.loading = "lazy"));
        return view;
      },
    },
  };
}

// Video, audio and file uploads are not part of v1.
const EXCLUDED = new Set(["video", "audio", "file"]);
const textBlocks = Object.fromEntries(
  Object.entries(defaultBlockSpecs).filter(([type]) => !EXCLUDED.has(type)),
) as Omit<typeof defaultBlockSpecs, "video" | "audio" | "file">;

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...textBlocks,
    // H4–H6 are planned for v2.
    heading: createHeadingBlockSpec({ levels: [1, 2, 3] }),
    codeBlock: codeBlockWithCopy(),
    image: lazyImage(),
    callout: calloutBlock(),
    youtube: youTubeBlock(),
    diagram: diagramBlock(),
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    comment: commentStyle(),
  },
});

export type EditorSchema = typeof schema;
export type EditorBlock = EditorSchema["Block"];
