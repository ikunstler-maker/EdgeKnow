"use client";

import dynamic from "next/dynamic";
import { createReactBlockSpec } from "@blocknote/react";
import { t } from "@/i18n";
import { HEIGHTS, parseDiagram } from "@/lib/diagram";

// React Flow loads only on pages that have a diagram.
const DiagramCanvas = dynamic(() => import("./diagram-canvas"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted" data-export-loading>{t.editor.diagram.loading}</p>,
});

// A node diagram: rounded rectangles on a grid, connected by arrows.
export const diagramBlock = createReactBlockSpec(
  {
    type: "diagram",
    propSchema: {
      data: { default: "" },
      height: { default: HEIGHTS.m as number },
    },
    content: "none",
  },
  {
    // Taps and drags inside the canvas belong to the diagram, not to the editor's
    // block selection (it's still moved with the side handle).
    meta: { selectable: false },
    render: ({ block, editor }) => (
      <DiagramCanvas
        data={block.props.data}
        height={block.props.height}
        editable={editor.isEditable}
        onChange={(data) => editor.updateBlock(block, { props: { data } })}
        onHeightChange={(height) => editor.updateBlock(block, { props: { height } })}
      />
    ),
    // Copying or exporting the page keeps the node titles and links as text.
    toExternalHTML: ({ block }) => {
      const diagram = parseDiagram(block.props.data);
      const title = new Map(diagram.nodes.map((n) => [n.id, `${n.emoji ? `${n.emoji} ` : ""}${n.title || t.editor.diagram.untitled}`]));
      return (
        <div>
          <p>{t.editor.diagram.title}</p>
          <ul>
            {diagram.nodes.map((n) => (
              <li key={n.id}>{title.get(n.id)}</li>
            ))}
            {diagram.edges.map((e) => (
              <li key={e.id}>
                {title.get(e.source)} → {title.get(e.target)}
              </li>
            ))}
          </ul>
        </div>
      );
    },
  },
);
