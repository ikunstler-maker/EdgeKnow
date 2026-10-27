"use client";

import { defaultProps } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { t } from "@/i18n";

export const CALLOUT_VARIANTS = ["info", "warning", "success", "error"] as const;
type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

const ICONS: Record<CalloutVariant, string> = {
  info: "ℹ️",
  warning: "⚠️",
  success: "✅",
  error: "⛔",
};

// A highlighted paragraph with an icon. Clicking the icon cycles through the four kinds.
export const calloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      textAlignment: defaultProps.textAlignment,
      variant: { default: "info", values: CALLOUT_VARIANTS },
    },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => {
      const variant = block.props.variant as CalloutVariant;
      const next = CALLOUT_VARIANTS[(CALLOUT_VARIANTS.indexOf(variant) + 1) % CALLOUT_VARIANTS.length];
      return (
        <div className={`ek-callout ek-callout-${variant}`} data-variant={variant}>
          <button
            type="button"
            contentEditable={false}
            disabled={!editor.isEditable}
            className="ek-callout-icon"
            aria-label={`${t.editor.callout.changeVariant}: ${t.editor.callout.variants[variant]}`}
            title={t.editor.callout.variants[variant]}
            onClick={() => editor.updateBlock(block, { props: { variant: next } })}
          >
            {ICONS[variant]}
          </button>
          <div className="ek-callout-text" ref={contentRef} />
        </div>
      );
    },
  },
);
