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
import { directImageUrl, isDriveImageUrl, isExternalImageUrl } from "@/lib/attachments";
import { getImageQuality, IMAGE_QUALITIES, setImageQuality, type ImageQuality } from "@/lib/image-compression";
import { Icon } from "@/components/ui/icon";

// The image panel: upload (with the quality choice) or a link to an image elsewhere.
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
        { name: t.editor.image.byLink, tabPanel: <ImageLinkTab blockId={props.blockId} /> },
      ]}
    />
  );
}

// Not copied to our storage: the picture shows while the other site keeps it.
function ImageLinkTab({ blockId }: { blockId: string }) {
  const editor = useBlockNoteEditor();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = () => {
    const value = directImageUrl(url);
    if (value === "drive_folder") return setError(t.editor.image.errors.drive_folder);
    if (!isExternalImageUrl(value)) return setError(t.editor.image.errors.link_https);
    const fromDrive = isDriveImageUrl(value);
    setChecking(true);
    // Make sure it really is a picture before putting it on the page.
    const probe = new Image();
    probe.onload = () => {
      setChecking(false);
      if (!editor.getBlock(blockId)) return;
      const name = fromDrive ? "" : decodeURIComponent(new URL(value).pathname.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
      editor.updateBlock(blockId, { props: { url: value, name } as never });
    };
    probe.onerror = () => {
      setChecking(false);
      setError(fromDrive ? t.editor.image.errors.drive_private : t.editor.image.errors.link_unreachable);
    };
    probe.referrerPolicy = "no-referrer";
    probe.src = value;
  };

  return (
    <form
      className="flex flex-col gap-2 p-1 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        type="url"
        inputMode="url"
        value={url}
        placeholder="https://…"
        aria-label={t.editor.image.linkLabel}
        onChange={(event) => {
          setUrl(event.target.value);
          setError(null);
        }}
        className="min-h-11 rounded-md border border-border bg-background px-2 text-base md:text-sm"
      />
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={!url.trim() || checking} className="min-h-11 rounded-md bg-accent px-3 font-medium text-white disabled:opacity-60">
        {t.editor.image.insertLink}
      </button>
      <p className="text-xs text-muted">{t.editor.image.linkHint}</p>
      <p className="text-xs text-muted">{t.editor.image.driveHint}</p>
    </form>
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

// BlockNote's own preview toggle has an English label; this one is translated.
export function PreviewToggleButton() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  const selected = useSelectedBlocks();
  const block = selected.length === 1 ? selected[0] : undefined;
  const props = block?.props as { url?: unknown; showPreview?: unknown } | undefined;
  if (!editor.isEditable || !block || typeof props?.url !== "string" || typeof props.showPreview !== "boolean") return null;
  const label = editor.dictionary.formatting_toolbar.file_preview_toggle.tooltip;
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label={label}
      mainTooltip={label}
      icon={<Icon name="image" />}
      isSelected={props.showPreview}
      onClick={() => editor.updateBlock(block, { props: { showPreview: !props.showPreview } as never })}
    />
  );
}
