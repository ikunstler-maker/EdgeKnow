"use client";

import { useState } from "react";
import {
  FilePanel,
  UploadTab,
  useBlockNoteEditor,
  useComponentsContext,
  useSelectedBlocks,
  type FilePanelProps,
} from "@blocknote/react";
import { t } from "@/i18n";
import { getImageQuality, IMAGE_QUALITIES, setImageQuality, type ImageQuality } from "@/lib/image-compression";

// The image panel: upload only (import by URL is v2), with the quality choice above it.
export function ImageFilePanel(props: FilePanelProps) {
  const [, setLoading] = useState(false);
  return (
    <FilePanel
      {...props}
      tabs={[
        {
          name: t.editor.image.qualityLabel,
          tabPanel: (
            <div className="flex flex-col gap-2 p-1">
              <QualitySelect />
              <UploadTab blockId={props.blockId} setLoading={setLoading} />
            </div>
          ),
        },
      ]}
    />
  );
}

function QualitySelect() {
  const [quality, setQuality] = useState<ImageQuality>(() => getImageQuality());
  return (
    <label className="flex flex-col gap-1 text-sm">
      {t.editor.image.qualityLabel}
      <select
        value={quality}
        onChange={(event) => {
          const next = event.target.value as ImageQuality;
          setQuality(next);
          setImageQuality(next);
        }}
        className="min-h-11 rounded-md border border-border bg-background px-2"
      >
        {Object.keys(IMAGE_QUALITIES).map((key) => (
          <option key={key} value={key}>
            {t.editor.image.qualities[key]}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted">{t.editor.image.qualityHint}</span>
    </label>
  );
}

const WIDTHS = ["25", "50", "100", "full"] as const;

// Width steps for a selected image: 25 / 50 / 100 % of its own size, or the full column.
export function ImageWidthButtons() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  const selected = useSelectedBlocks(editor);
  const block = selected.length === 1 && selected[0].type === "image" ? selected[0] : null;
  if (!block || !editor.isEditable) return null;

  const apply = (step: (typeof WIDTHS)[number]) => {
    const container = editor.domElement?.querySelector(".bn-block-group")?.clientWidth ?? 700;
    const img = editor.domElement?.querySelector<HTMLImageElement>(
      `[data-node-type="blockContainer"][data-id="${CSS.escape(block.id)}"] img`,
    );
    const natural = img?.naturalWidth || container;
    const width = step === "full" ? container : Math.round((natural * Number(step)) / 100);
    editor.updateBlock(block, { props: { previewWidth: Math.min(width, container) } });
  };

  return (
    <>
      {WIDTHS.map((step) => (
        <Components.FormattingToolbar.Button
          key={step}
          label={t.editor.image.widths[step]}
          mainTooltip={`${t.editor.image.widthLabel}: ${t.editor.image.widths[step]}`}
          onClick={() => apply(step)}
        >
          {t.editor.image.widths[step]}
        </Components.FormattingToolbar.Button>
      ))}
    </>
  );
}
