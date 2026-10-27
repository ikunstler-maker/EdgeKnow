"use client";

import "@blocknote/mantine/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { uk as blockNoteUk } from "@blocknote/core/locales";
import { syntaxHighlighter } from "@blocknote/code-block";
import {
  BasicTextStyleButton,
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { t } from "@/i18n";
import { parseYouTubeUrl, youTubeWatchUrl } from "@/lib/youtube";
import { schema, type EditorBlock } from "./schema";
import { collectHeadings, scrollToBlock, TableOfContents, type Heading } from "./table-of-contents";
import { useAutosave } from "./use-autosave";
import { SaveIndicator, ConflictBanner } from "./save-status";
import { fetchYouTubeInfo } from "./youtube-block";

type Editor = typeof schema.BlockNoteEditor;

// Removes every inline style from the selected text (bold, colours, code, …).
function ClearFormattingButton() {
  const editor = useBlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>();
  const Components = useComponentsContext()!;
  return (
    <Components.FormattingToolbar.Button
      mainTooltip={t.editor.clearFormatting}
      label={t.editor.clearFormatting}
      icon={<span aria-hidden="true">⌫</span>}
      onClick={() => editor.removeStyles(editor.getActiveStyles())}
    />
  );
}

function slashMenuItems(editor: Editor): DefaultReactSuggestionItem[] {
  const special = t.editor.groups.special;
  return [
    ...getDefaultReactSlashMenuItems(editor),
    {
      title: t.editor.callout.title,
      subtext: t.editor.callout.subtext,
      aliases: t.editor.callout.aliases,
      group: special,
      icon: <span aria-hidden="true">ℹ️</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "callout" }),
    },
    {
      title: t.editor.youtube.title,
      subtext: t.editor.youtube.subtext,
      aliases: t.editor.youtube.aliases,
      group: t.editor.groups.media,
      icon: <span aria-hidden="true">▶️</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "youtube" }),
    },
  ];
}

export type PageEditorProps = {
  pageId: string;
  initialContent: unknown;
  initialVersion: number;
  editable: boolean;
};

export default function PageEditor({ pageId, initialContent, initialVersion, editable }: PageEditorProps) {
  const editor = useCreateBlockNote({
    schema,
    dictionary: {
      ...blockNoteUk,
      placeholders: { ...blockNoteUk.placeholders, default: t.editor.placeholder },
    },
    initialContent:
      Array.isArray(initialContent) && initialContent.length > 0
        ? (initialContent as EditorBlock[])
        : undefined,
    tables: { headers: true },
    extensions: [syntaxHighlighter],
    // A YouTube link pasted on its own becomes a video card.
    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
      const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
      const ref = !text.includes(" ") ? parseYouTubeUrl(text) : null;
      if (!ref) return defaultPasteHandler();
      const url = youTubeWatchUrl(ref);
      const block = insertOrUpdateBlockForSlashMenu(editor, { type: "youtube", props: { url } });
      void fetchYouTubeInfo(url).then((info) => {
        if (editor.getBlock(block.id)) {
          editor.updateBlock(block.id, { props: { title: info.title ?? "", author: info.author ?? "" } });
        }
      });
      return true;
    },
  });

  const getContent = useCallback(() => editor.document as unknown[], [editor]);
  const autosave = useAutosave({ pageId, initialVersion, getContent });
  const [headings, setHeadings] = useState<Heading[]>(() => collectHeadings(editor.document));

  // Opening a link to a section (#block-id) scrolls to it once the text is on screen.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) requestAnimationFrame(() => scrollToBlock(id));
  }, []);

  const formattingToolbar = useMemo(
    () =>
      function Toolbar() {
        return (
          <FormattingToolbar>
            {[
              ...getFormattingToolbarItems(),
              <BasicTextStyleButton key="codeStyleButton" basicTextStyle="code" />,
              <ClearFormattingButton key="clearFormattingButton" />,
            ]}
          </FormattingToolbar>
        );
      },
    [],
  );

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-8">
      <div className="min-w-0">
        <div className="mb-2 flex min-h-6 items-center justify-end">
          {editable ? <SaveIndicator status={autosave.status} /> : <span className="text-xs text-muted">{t.editor.readOnly}</span>}
        </div>
        {autosave.conflict && (
          <ConflictBanner
            conflict={autosave.conflict}
            onKeepMine={autosave.keepMine}
            onTakeTheirs={async () => {
              try {
                await navigator.clipboard.writeText(await editor.blocksToMarkdownLossy(editor.document));
                alert(t.editor.conflict.copied);
              } catch {
                // Clipboard blocked: nothing more we can do before reloading.
              }
              autosave.discardLocal();
              window.location.reload();
            }}
          />
        )}
        <BlockNoteView
          editor={editor}
          editable={editable}
          slashMenu={false}
          formattingToolbar={false}
          spellCheck
          className="ek-editor"
          onChange={() => {
            setHeadings(collectHeadings(editor.document));
            if (editable) autosave.onChange();
          }}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => filterSuggestionItems(slashMenuItems(editor), query)}
          />
          <FormattingToolbarController formattingToolbar={formattingToolbar} />
        </BlockNoteView>
      </div>
      <TableOfContents headings={headings} />
    </div>
  );
}
