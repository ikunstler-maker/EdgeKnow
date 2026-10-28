"use client";

import "@blocknote/mantine/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { uk as blockNoteUk } from "@blocknote/core/locales";
import { syntaxHighlighter } from "@blocknote/code-block";
import {
  BasicTextStyleButton,
  FormattingToolbar,
  FilePanelController,
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
import { resolveAttachmentUrl, uploadImage, UploadError } from "@/lib/attachments";
import { CHIP_PRESETS } from "@/lib/chips";
import type { CommentThread, MentionPerson, PeopleNames } from "@/lib/comments";
import type { PageNode } from "@/lib/pages";
import { getMentionCandidates } from "@/app/comment-actions";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { ChipPeopleContext } from "./chips";
import { ImageError } from "@/lib/image-compression";
import { parseYouTubeUrl, youTubeWatchUrl } from "@/lib/youtube";
import {
  CommentHighlights,
  CommentsColumn,
  CommentsSheet,
  useComments,
  useWide,
  type CommentsController,
} from "./comments";
import { ImageFilePanel, ImageWidthButtons } from "./image-tools";
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

// Starts a comment on the selected text (the toolbar appears over any selection).
function CommentButton({ onComment }: { onComment: () => void }) {
  const Components = useComponentsContext()!;
  return (
    <Components.FormattingToolbar.Button
      mainTooltip={t.comments.add}
      label={t.comments.add}
      icon={<span aria-hidden="true">💬</span>}
      onClick={onComment}
    />
  );
}

// Monospace text: the code font without the code background.
function MonoButton() {
  const editor = useBlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>();
  const Components = useComponentsContext()!;
  const active = Boolean(editor.getActiveStyles().mono);
  return (
    <Components.FormattingToolbar.Button
      mainTooltip={t.editor.mono}
      label={t.editor.mono}
      isSelected={active}
      icon={<span aria-hidden="true" style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13 }}>M</span>}
      onClick={() => editor.toggleStyles({ mono: true })}
    />
  );
}

function slashMenuItems(editor: Editor): DefaultReactSuggestionItem[] {
  const items = getDefaultReactSlashMenuItems(editor);
  const callout: DefaultReactSuggestionItem = {
    title: t.editor.callout.title,
    subtext: t.editor.callout.subtext,
    aliases: t.editor.callout.aliases,
    group: t.editor.groups.special,
    icon: <span aria-hidden="true">ℹ️</span>,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "callout" }),
  };
  // In BlockNote's own media group (next to images): the menu groups adjacent items only.
  const mediaGroup = items.find((item) => item.title === editor.dictionary.slash_menu.image.title)?.group;
  const youtube: DefaultReactSuggestionItem = {
    title: t.editor.youtube.title,
    subtext: t.editor.youtube.subtext,
    aliases: t.editor.youtube.aliases,
    group: mediaGroup ?? t.editor.groups.media,
    icon: <span aria-hidden="true">▶️</span>,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "youtube" }),
  };
  const lastMedia = mediaGroup ? items.findLastIndex((item) => item.group === mediaGroup) : -1;
  if (lastMedia >= 0) items.splice(lastMedia + 1, 0, youtube);
  else items.push(youtube);
  const diagram: DefaultReactSuggestionItem = {
    title: t.editor.diagram.title,
    subtext: t.editor.diagram.subtext,
    aliases: t.editor.diagram.aliases,
    group: t.editor.groups.special,
    icon: <span aria-hidden="true">🔷</span>,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "diagram" }),
  };
  // Headings in one group: H1–H4, the subtitle, then the collapsible ones.
  const menu = editor.dictionary.slash_menu;
  const byTitle = (title: string) => items.find((item) => item.title === title);
  const headingGroup = byTitle(menu.heading.title)?.group ?? t.editor.groups.special;
  const plain = [menu.heading, menu.heading_2, menu.heading_3, menu.heading_4].map((d) => byTitle(d.title));
  const toggles = [menu.toggle_heading, menu.toggle_heading_2, menu.toggle_heading_3].map((d) => byTitle(d.title));
  const subtitle: DefaultReactSuggestionItem = {
    title: t.editor.subtitle.title,
    subtext: t.editor.subtitle.subtext,
    aliases: t.editor.subtitle.aliases,
    group: headingGroup,
    icon: byTitle(menu.paragraph.title)?.icon,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "subtitle" }),
  };
  const toggleH4: DefaultReactSuggestionItem = {
    title: t.editor.toggleHeading4.title,
    subtext: t.editor.toggleHeading4.subtext,
    aliases: t.editor.toggleHeading4.aliases,
    group: headingGroup,
    icon: toggles[2]?.icon ?? plain[3]?.icon,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "heading", props: { level: 4, isToggleable: true } }),
  };
  const headingItems = [...plain, subtitle, ...toggles, toggleH4]
    .filter((item): item is DefaultReactSuggestionItem => Boolean(item))
    .map((item) => ({ ...item, group: headingGroup }));
  const firstHeading = items.findIndex((item) => headingItems.some((h) => h.title === item.title));
  const rest = items.filter((item) => !headingItems.some((h) => h.title === item.title));
  rest.splice(Math.max(0, firstHeading), 0, ...headingItems);
  items.splice(0, items.length, ...rest);
  const chip: DefaultReactSuggestionItem = {
    title: t.editor.chips.dropdownTitle,
    subtext: t.editor.chips.dropdownSubtext,
    aliases: t.editor.chips.dropdownAliases,
    group: t.editor.groups.special,
    icon: <span aria-hidden="true">🏷️</span>,
    onItemClick: () => {
      const preset = CHIP_PRESETS[0];
      editor.insertInlineContent([
        { type: "chip", props: { name: preset.name, options: JSON.stringify(preset.options), value: preset.options[0].id } },
        " ",
      ]);
    },
  };
  // Page and person chips are picked from the "@" menu.
  const mention: DefaultReactSuggestionItem = {
    title: t.editor.chips.mentionTitle,
    subtext: t.editor.chips.mentionSubtext,
    aliases: t.editor.chips.mentionAliases,
    group: t.editor.groups.special,
    icon: <span aria-hidden="true">@</span>,
    onItemClick: () => editor.getExtension(SuggestionMenu)?.openSuggestionMenu("@", { deleteTriggerCharacter: true, ignoreQueryLength: true }),
  };
  return [...items, callout, diagram, chip, mention];
}

// "@": people who can see the page, then pages, as chips.
function mentionItems(editor: Editor, people: MentionPerson[], pages: PageNode[], currentPageId: string): DefaultReactSuggestionItem[] {
  const personItems = people.map((person) => ({
    title: person.label,
    group: t.editor.chips.people,
    icon: <span aria-hidden="true">👤</span>,
    onItemClick: () => editor.insertInlineContent([{ type: "personChip", props: { userId: person.userId, label: person.label } }, " "]),
  }));
  const pageItems = pages
    .filter((p) => p.id !== currentPageId)
    .map((page) => ({
      title: page.title || t.pages.untitled,
      group: t.editor.chips.pages,
      icon: <span aria-hidden="true">{page.icon ?? "📄"}</span>,
      onItemClick: () => editor.insertInlineContent([{ type: "pageChip", props: { pageId: page.id } }, " "]),
    }));
  return [...personItems, ...pageItems];
}

export type PageEditorProps = {
  pageId: string;
  initialContent: unknown;
  initialVersion: number;
  editable: boolean;
  canComment: boolean;
  userId: string;
  threads: CommentThread[];
  people: PeopleNames;
};

export default function PageEditor({
  pageId,
  initialContent,
  initialVersion,
  editable,
  canComment,
  userId,
  threads,
  people,
}: PageEditorProps) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const editor = useCreateBlockNote({
    schema,
    dictionary: {
      ...blockNoteUk,
      placeholders: { ...blockNoteUk.placeholders, default: t.editor.placeholder },
      slash_menu: {
        ...blockNoteUk.slash_menu,
        toggle_heading: { ...blockNoteUk.slash_menu.toggle_heading, ...t.editor.toggleHeadings[0] },
        toggle_heading_2: { ...blockNoteUk.slash_menu.toggle_heading_2, ...t.editor.toggleHeadings[1] },
        toggle_heading_3: { ...blockNoteUk.slash_menu.toggle_heading_3, ...t.editor.toggleHeadings[2] },
      },
    },
    initialContent:
      Array.isArray(initialContent) && initialContent.length > 0
        ? (initialContent as EditorBlock[])
        : undefined,
    tables: { headers: true, cellBackgroundColor: true, cellTextColor: true },
    // Images are compressed in the browser and stored privately; the document keeps
    // only their storage path, turned into a short-lived signed URL for display.
    uploadFile: async (file) => {
      setUploadError(null);
      try {
        const { url } = await uploadImage(pageId, file);
        // BlockNote applies the returned object as a block update.
        return { props: { url, name: file.name.replace(/\.[^.]+$/, "") } };
      } catch (error) {
        const code = error instanceof ImageError || error instanceof UploadError ? error.message : "upload_failed";
        setUploadError(t.editor.image.errors[code] ?? t.editor.image.errors.upload_failed);
        throw error;
      }
    },
    resolveFileUrl: resolveAttachmentUrl,
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

  const pagesContext = useOptionalPages();
  const [chipPeople, setChipPeople] = useState<MentionPerson[]>([]);
  useEffect(() => {
    let alive = true;
    void getMentionCandidates(pageId).then((list) => alive && setChipPeople(list));
    return () => {
      alive = false;
    };
  }, [pageId]);

  const getContent = useCallback(() => editor.document as unknown[], [editor]);
  const autosave = useAutosave({ pageId, initialVersion, getContent });
  const [headings, setHeadings] = useState<Heading[]>(() => collectHeadings(editor.document));
  // Bumped on every change so comment cards follow their fragments.
  const [layoutKey, setLayoutKey] = useState(0);

  const commentProps = { editor, pageId, threads, people, userId, canComment, initialVersion };
  const comments = useComments(commentProps);
  const wide = useWide();
  const [sheet, setSheet] = useState<"threads" | "archive" | null>(null);
  const hasColumn = wide && (comments.visible.length > 0 || comments.draft !== null);
  const startComment = comments.start;
  // On narrow screens a new comment is written in the sheet.
  const sheetShown = sheet ?? (!wide && comments.draft ? "threads" : null);

  // Opening a link to a section (#block-id) scrolls to it once the text is on screen.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) requestAnimationFrame(() => scrollToBlock(id));
  }, []);

  const formattingToolbar = useMemo(
    () =>
      function Toolbar() {
        // Readers see no formatting; commenters only the comment button.
        if (!editable) {
          return canComment ? (
            <FormattingToolbar>
              <CommentButton onComment={startComment} />
            </FormattingToolbar>
          ) : null;
        }
        return (
          <FormattingToolbar>
            {[
              ...getFormattingToolbarItems(),
              <ImageWidthButtons key="imageWidthButtons" />,
              <BasicTextStyleButton key="codeStyleButton" basicTextStyle="code" />,
              <MonoButton key="monoButton" />,
              <ClearFormattingButton key="clearFormattingButton" />,
              ...(canComment ? [<CommentButton key="commentButton" onComment={startComment} />] : []),
            ]}
          </FormattingToolbar>
        );
      },
    [editable, canComment, startComment],
  );

  // A click on highlighted text opens its thread.
  const openThreadAt = (target: EventTarget) => {
    const id = (target as HTMLElement).closest?.("[data-comment-thread]")?.getAttribute("data-comment-thread");
    if (!id || !comments.visible.some((th) => th.id === id && th.status === "open")) return;
    comments.setActive(id);
    if (!wide) setSheet("threads");
  };

  return (
    <div className={`xl:grid xl:gap-8 ${hasColumn ? "xl:grid-cols-[minmax(0,1fr)_18rem]" : "xl:grid-cols-[minmax(0,1fr)_13rem]"}`}>
      <CommentHighlights threads={threads} active={comments.active} />
      <div className="min-w-0" onClick={(event) => openThreadAt(event.target)}>
        <div className="mb-2 flex min-h-6 flex-wrap items-center justify-end gap-3">
          {comments.archived.length > 0 && (
            <button type="button" onClick={() => setSheet("archive")} className="text-xs text-muted hover:text-foreground hover:underline">
              {t.comments.archive(comments.archived.length)}
            </button>
          )}
          {editable ? <SaveIndicator status={autosave.status} /> : <span className="text-xs text-muted">{t.editor.readOnly}</span>}
        </div>
        {uploadError && (
          <p role="alert" className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
            {uploadError}
          </p>
        )}
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
        <ChipPeopleContext value={chipPeople}>
        <BlockNoteView
          editor={editor}
          editable={editable}
          slashMenu={false}
          formattingToolbar={false}
          filePanel={false}
          spellCheck
          className="ek-editor"
          onChange={() => {
            setHeadings(collectHeadings(editor.document));
            setLayoutKey((n) => n + 1);
            if (editable) autosave.onChange();
          }}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => filterSuggestionItems(slashMenuItems(editor), query)}
          />
          {editable && (
            <SuggestionMenuController
              triggerCharacter="@"
              getItems={async (query) =>
                filterSuggestionItems(mentionItems(editor, chipPeople, pagesContext?.pages ?? [], pageId), query).slice(0, 12)
              }
            />
          )}
          <FormattingToolbarController formattingToolbar={formattingToolbar} />
          <FilePanelController filePanel={ImageFilePanel} />
        </BlockNoteView>
        </ChipPeopleContext>
      </div>
      {hasColumn ? (
        <>
          <CommentsColumn controller={comments} props={commentProps} layoutKey={layoutKey} />
          <TableOfContents headings={headings} asButton />
        </>
      ) : (
        <TableOfContents headings={headings} />
      )}
      {!wide && comments.visible.length > 0 && (
        <CommentsButton controller={comments} onOpen={() => setSheet("threads")} />
      )}
      {sheetShown && (
        <CommentsSheet
          title={sheetShown === "archive" ? t.comments.archiveTitle : t.comments.column}
          threads={sheetShown === "archive" ? comments.archived : comments.visible}
          controller={comments}
          props={commentProps}
          showDraft={sheetShown === "threads"}
          onClose={() => {
            setSheet(null);
            comments.cancelDraft();
          }}
        />
      )}
    </div>
  );
}

// Narrow screens: a floating button above the contents button.
function CommentsButton({ controller, onOpen }: { controller: CommentsController; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed bottom-18 right-4 z-30 min-h-11 rounded-full border border-border bg-background px-4 text-sm shadow-lg"
    >
      💬 {t.comments.open(controller.visible.length)}
    </button>
  );
}
