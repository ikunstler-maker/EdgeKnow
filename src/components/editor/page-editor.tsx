"use client";

import "@blocknote/mantine/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { en as blockNoteEn, uk as blockNoteUk } from "@blocknote/core/locales";
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
import { currentLocale, t } from "@/i18n";
import { useResolvedTheme } from "@/lib/use-theme";
import { resolveAttachmentUrl, uploadImage, UploadError } from "@/lib/attachments";
import { chipPresets } from "@/lib/chips";
import type { CommentThread, MentionPerson, PeopleNames } from "@/lib/comments";
import type { PageNode } from "@/lib/pages";
import { getMentionCandidates } from "@/app/comment-actions";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { Popover } from "@/components/ui/popover";
import { publishPageStats } from "@/components/pages/page-stats";
import { ChipPeopleContext } from "./chips";
import { rememberTask } from "./task-chip-store";
import { eventWhen, rememberEvent } from "./event-chip";
import { searchEvents } from "@/app/calendar-actions";
import { TaskFromSelectionButton, TaskFromSelectionDialog } from "./task-from-selection";
import { createTaskFromPage, searchTasksForChip } from "@/app/task-wiki-actions";
import { EditorPageContext } from "./navigation-block";
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
import { ImageFilePanel, ImageWidthButtons, PreviewToggleButton } from "./image-tools";
import { schema, type EditorBlock } from "./schema";
import { collectHeadings, scrollToBlock, TableOfContents, type Heading } from "./table-of-contents";
import { publishSidebarToc, setTocPlacement, useTocPlacement, type TocPlacement } from "./toc-store";
import { useAutosave } from "./use-autosave";
import { SaveIndicator, ConflictBanner } from "./save-status";
import { fetchYouTubeInfo } from "./youtube-block";
import { Icon } from "@/components/ui/icon";

type Editor = typeof schema.BlockNoteEditor;

// Removes every inline style from the selected text (bold, colours, code, …).
function ClearFormattingButton() {
  const editor = useBlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>();
  const Components = useComponentsContext()!;
  return (
    <Components.FormattingToolbar.Button
      mainTooltip={t.editor.clearFormatting}
      label={t.editor.clearFormatting}
      icon={<Icon name="close" />}
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
      icon={<Icon name="comment" />}
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
    icon: <Icon name="play" />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "youtube" }),
  };
  const lastMedia = mediaGroup ? items.findLastIndex((item) => item.group === mediaGroup) : -1;
  const gallery: DefaultReactSuggestionItem = {
    title: t.editor.gallery.title,
    subtext: t.editor.gallery.subtext,
    aliases: t.editor.gallery.aliases,
    group: mediaGroup ?? t.editor.groups.media,
    icon: <Icon name="image" />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "gallery" }),
  };
  if (lastMedia >= 0) items.splice(lastMedia + 1, 0, youtube, gallery);
  else items.push(youtube, gallery);
  const diagram: DefaultReactSuggestionItem = {
    title: t.editor.diagram.title,
    subtext: t.editor.diagram.subtext,
    aliases: t.editor.diagram.aliases,
    group: t.editor.groups.special,
    icon: <Icon name="layers" />,
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
    icon: <Icon name="tag" />,
    onItemClick: () => {
      const preset = chipPresets()[0];
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
  const linkCard: DefaultReactSuggestionItem = {
    title: t.editor.linkCard.title,
    subtext: t.editor.linkCard.subtext,
    aliases: t.editor.linkCard.aliases,
    group: t.editor.groups.special,
    icon: <Icon name="link" />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "linkCard" }),
  };
  const navigation: DefaultReactSuggestionItem = {
    title: t.editor.navigation.title,
    subtext: t.editor.navigation.subtext,
    aliases: t.editor.navigation.aliases,
    group: t.editor.groups.special,
    icon: <Icon name="list" />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "navigation" }),
  };
  const tasksEmbed: DefaultReactSuggestionItem = {
    title: t.tasks.wiki.embedTitle,
    subtext: t.tasks.wiki.embedSubtext,
    aliases: t.tasks.wiki.embedAliases,
    group: t.editor.groups.special,
    icon: <Icon name="template" />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "tasks" }),
  };
  // A task chip is picked from the "@" menu, like pages and people.
  const taskChipItem: DefaultReactSuggestionItem = {
    title: t.tasks.wiki.chipTitle,
    subtext: t.tasks.wiki.chipSubtext,
    aliases: t.tasks.wiki.chipAliases,
    group: t.editor.groups.special,
    icon: <Icon name="task" />,
    onItemClick: () => editor.getExtension(SuggestionMenu)?.openSuggestionMenu("@", { deleteTriggerCharacter: true, ignoreQueryLength: true }),
  };
  const nodeMap: DefaultReactSuggestionItem = {
    title: t.nodes.embed.title,
    subtext: t.nodes.embed.subtext,
    aliases: t.nodes.embed.aliases,
    group: t.editor.groups.special,
    icon: <Icon name="share" />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "nodeMap" }),
  };
  const boardEmbed: DefaultReactSuggestionItem = {
    title: t.boards.embed.title,
    subtext: t.boards.embed.subtext,
    aliases: t.boards.embed.aliases,
    group: t.editor.groups.special,
    icon: <Icon name="note" />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "boardEmbed" }),
  };
  const wishlistEmbed: DefaultReactSuggestionItem = {
    title: t.wishlists.embed.title,
    subtext: t.wishlists.embed.subtext,
    aliases: t.wishlists.embed.aliases,
    group: t.editor.groups.special,
    icon: <Icon name="gift" />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "wishlistEmbed" }),
  };
  const sheetEmbed: DefaultReactSuggestionItem = {
    title: t.sheets.embed.title,
    subtext: t.sheets.embed.subtext,
    aliases: t.sheets.embed.aliases,
    group: t.editor.groups.special,
    icon: <Icon name="table" />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "sheetEmbed" }),
  };
  const surveyEmbed: DefaultReactSuggestionItem = {
    title: t.surveys.embed.title,
    subtext: t.surveys.embed.subtext,
    aliases: t.surveys.embed.aliases,
    group: t.editor.groups.special,
    icon: <Icon name="file-text" />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "surveyEmbed" }),
  };
  return [...items, callout, navigation, linkCard, diagram, chip, mention, taskChipItem, tasksEmbed, nodeMap, boardEmbed, sheetEmbed, surveyEmbed, wishlistEmbed];
}

// "@": calendar events the person sees, by title (Doba, phase 2b).
async function eventMentionItems(editor: Editor, shortId: string, query: string): Promise<DefaultReactSuggestionItem[]> {
  if (query.trim().length < 2) return [];
  const found = await searchEvents(shortId, query).catch(() => []);
  return found.slice(0, 5).map((event) => ({
    title: `${event.title} · ${eventWhen(event)}`,
    group: t.calendar.chip.group,
    icon: <Icon name="calendar" />,
    onItemClick: () => {
      rememberEvent({ ...event, cancelled: false });
      editor.insertInlineContent([{ type: "eventChip", props: { eventId: event.id } }, " "]);
    },
  }));
}

// "@": tasks by key or title, and a new task from what was typed (step Z4).
async function taskMentionItems(editor: Editor, shortId: string, query: string, pageId: string): Promise<DefaultReactSuggestionItem[]> {
  const { tasks, projects } = await searchTasksForChip(shortId, query).catch(() => ({ tasks: [], projects: [] }));
  const insert = (taskId: string) => editor.insertInlineContent([{ type: "taskChip", props: { taskId } }, " "]);
  const found = tasks.map((task) => ({
    title: `${task.key} ${task.title}`,
    group: t.tasks.wiki.mentionGroup,
    icon: <Icon name="task" />,
    onItemClick: () => {
      rememberTask(task);
      insert(task.id);
    },
  }));
  const title = query.trim();
  const create = title.length >= 2 && !/^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/.test(title)
    ? projects
        .filter((p) => p.canEdit)
        .slice(0, 3)
        .map((project) => ({
          title: t.tasks.wiki.newTaskIn(project.key, title),
          group: t.tasks.wiki.newTaskGroup,
          icon: <Icon name="plus" />,
          onItemClick: async () => {
            const made = await createTaskFromPage(shortId, project.id, title, pageId);
            if (made.ok) insert(made.id);
          },
        }))
    : [];
  return [...found, ...create];
}

// "@": people who can see the page, then pages, as chips.
function mentionItems(editor: Editor, people: MentionPerson[], pages: PageNode[], currentPageId: string): DefaultReactSuggestionItem[] {
  const personItems = people.map((person) => ({
    title: person.label,
    group: t.editor.chips.people,
    icon: <Icon name="user" />,
    onItemClick: () => editor.insertInlineContent([{ type: "personChip", props: { userId: person.userId, label: person.label } }, " "]),
  }));
  const pageItems = pages
    .filter((p) => p.id !== currentPageId)
    .map((page) => ({
      title: page.title || t.pages.untitled,
      group: t.editor.chips.pages,
      icon: page.icon ? <span aria-hidden="true">{page.icon}</span> : <Icon name="file-text" className="text-muted" />,
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
  // "Save as PDF": the text only (no comments, contents or save state), light theme, read-only.
  print?: boolean;
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
  print = false,
}: PageEditorProps) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  // The editor's own menus in the interface language.
  const editorDictionary = currentLocale() === "en" ? blockNoteEn : blockNoteUk;
  const shownTheme = useResolvedTheme();
  const theme = print ? "light" : shownTheme;
  const editor = useCreateBlockNote({
    schema,
    dictionary: {
      ...editorDictionary,
      placeholders: { ...editorDictionary.placeholders, default: t.editor.placeholder },
      slash_menu: {
        ...editorDictionary.slash_menu,
        toggle_heading: { ...editorDictionary.slash_menu.toggle_heading, ...t.editor.toggleHeadings[0] },
        toggle_heading_2: { ...editorDictionary.slash_menu.toggle_heading_2, ...t.editor.toggleHeadings[1] },
        toggle_heading_3: { ...editorDictionary.slash_menu.toggle_heading_3, ...t.editor.toggleHeadings[2] },
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
  useEffect(() => {
    publishPageStats(editor.document, true);
    return () => publishPageStats(null);
  }, [editor]);
  // Bumped on every change so comment cards follow their fragments.
  const [layoutKey, setLayoutKey] = useState(0);

  const commentProps = { editor, pageId, threads, people, userId, canComment, initialVersion };
  const comments = useComments(commentProps);
  const wide = useWide();
  const [sheet, setSheet] = useState<"threads" | "archive" | null>(null);
  // A task from the selected text: its dialog lives here, not in the toolbar.
  const [taskTitle, setTaskTitle] = useState<string | null>(null);
  const closeTaskDialog = useCallback(() => setTaskTitle(null), []);
  const hasColumn = wide && (comments.visible.length > 0 || comments.draft !== null);
  // With comments on the page, the contents go where the reader chose.
  const placement = useTocPlacement();
  const [tab, setTab] = useState<"toc" | "comments">("comments");
  const commentsStart = comments.start;
  const startComment = useCallback(() => {
    setTab("comments");
    commentsStart();
  }, [commentsStart]);
  const leftToc = hasColumn && placement === "left";
  useEffect(() => {
    publishSidebarToc(leftToc ? headings : null);
    return () => publishSidebarToc(null);
  }, [leftToc, headings]);
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
              // BlockNote's preview toggle is swapped for a translated one.
              ...getFormattingToolbarItems().map((item) =>
                item.key === "filePreviewButton" ? <PreviewToggleButton key="filePreviewButton" /> : item,
              ),
              <ImageWidthButtons key="imageWidthButtons" />,
              <BasicTextStyleButton key="codeStyleButton" basicTextStyle="code" />,
              <MonoButton key="monoButton" />,
              <ClearFormattingButton key="clearFormattingButton" />,
              ...(pagesContext ? [<TaskFromSelectionButton key="taskFromSelection" onOpen={setTaskTitle} />] : []),
              ...(canComment ? [<CommentButton key="commentButton" onComment={startComment} />] : []),
            ]}
          </FormattingToolbar>
        );
      },
    [editable, canComment, startComment, pagesContext],
  );

  // A click on highlighted text opens its thread.
  const openThreadAt = (target: EventTarget) => {
    const id = (target as HTMLElement).closest?.("[data-comment-thread]")?.getAttribute("data-comment-thread");
    if (!id || !comments.visible.some((th) => th.id === id && th.status === "open")) return;
    comments.setActive(id);
    setTab("comments");
    if (!wide) setSheet("threads");
  };

  if (print) {
    return (
      <EditorPageContext value={{ pageId }}>
        <ChipPeopleContext value={chipPeople}>
          <BlockNoteView editor={editor} editable={false} theme="light" slashMenu={false} formattingToolbar={false} filePanel={false} sideMenu={false} className="ek-editor" />
        </ChipPeopleContext>
      </EditorPageContext>
    );
  }

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
        <EditorPageContext value={{ pageId }}>
        <ChipPeopleContext value={chipPeople}>
        <BlockNoteView
          editor={editor}
          editable={editable}
          theme={theme}
          slashMenu={false}
          formattingToolbar={false}
          filePanel={false}
          spellCheck
          className="ek-editor"
          onChange={() => {
            setHeadings(collectHeadings(editor.document));
            publishPageStats(editor.document);
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
              getItems={async (query) => [
                ...filterSuggestionItems(mentionItems(editor, chipPeople, pagesContext?.pages ?? [], pageId), query).slice(0, 8),
                ...(pagesContext ? await taskMentionItems(editor, pagesContext.workspace.shortId, query, pageId) : []),
                ...(pagesContext ? await eventMentionItems(editor, pagesContext.workspace.shortId, query) : []),
              ]}
            />
          )}
          <FormattingToolbarController formattingToolbar={formattingToolbar} />
          <FilePanelController filePanel={ImageFilePanel} />
        </BlockNoteView>
        </ChipPeopleContext>
        </EditorPageContext>
        {taskTitle !== null && pagesContext && (
          <TaskFromSelectionDialog editor={editor} shortId={pagesContext.workspace.shortId} pageId={pageId} initialTitle={taskTitle} onClose={closeTaskDialog} />
        )}
        {hasColumn && placement === "bottom" && <TableOfContents headings={headings} variant="bottom" />}
      </div>
      {hasColumn ? (
        <div>
          <RightPanelHeader
            placement={placement}
            tab={tab}
            onTab={setTab}
            commentCount={comments.visible.length}
            hasHeadings={headings.length > 0}
          />
          {placement === "right" && tab === "toc" && headings.length > 0 ? (
            <div className="sticky top-16 max-h-[calc(100dvh-8rem)] overflow-y-auto">
              <TableOfContents headings={headings} variant="embedded" />
            </div>
          ) : (
            <CommentsColumn controller={comments} props={commentProps} layoutKey={layoutKey} />
          )}
        </div>
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

// The right column on pages with comments: "Зміст | Коментарі" and where the
// contents should live.
function RightPanelHeader({
  placement,
  tab,
  onTab,
  commentCount,
  hasHeadings,
}: {
  placement: TocPlacement;
  tab: "toc" | "comments";
  onTab: (tab: "toc" | "comments") => void;
  commentCount: number;
  hasHeadings: boolean;
}) {
  const [settings, setSettings] = useState<HTMLElement | null>(null);
  const tabs = placement === "right" && hasHeadings;
  const tabClass = (active: boolean) =>
    `min-h-8 rounded-full px-3 text-sm ${active ? "bg-background font-medium shadow-sm" : "text-muted hover:text-foreground"}`;
  // A compact switch that stays on screen while scrolling, so the contents or the
  // comments open from anywhere on the page.
  return (
    <div className="sticky top-3 z-20 mb-3 flex justify-end">
      <div className="flex items-center gap-1 rounded-full border border-border bg-surface/95 p-1 shadow-sm backdrop-blur">
        {tabs ? (
          <div role="tablist" aria-label={t.toc.panel} className="flex gap-0.5">
            <button type="button" role="tab" aria-selected={tab === "toc"} onClick={() => onTab("toc")} className={tabClass(tab === "toc")}>
              <Icon name="list" className="mr-1 inline" />
              {t.toc.title}
            </button>
            <button type="button" role="tab" aria-selected={tab === "comments"} onClick={() => onTab("comments")} className={tabClass(tab === "comments")}>
              <Icon name="info" className="mr-1 inline" />
              {t.comments.column}
              {commentCount > 0 && ` ${commentCount}`}
            </button>
          </div>
        ) : (
          <span className="px-3 text-sm text-muted">
            <Icon name="info" className="mr-1 inline" />
            {t.comments.column}
            {commentCount > 0 && ` ${commentCount}`}
          </span>
        )}
        {hasHeadings && (
          <button
            type="button"
            onClick={(event) => setSettings(settings ? null : event.currentTarget)}
            aria-label={t.toc.placementLabel}
            title={t.toc.placementLabel}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-background hover:text-foreground"
          >
            <Icon name="settings" />
          </button>
        )}
      </div>
      {settings && (
        <Popover anchor={settings} onClose={() => setSettings(null)} width={240}>
          <div role="radiogroup" aria-label={t.toc.placementLabel} className="p-1">
            <p className="px-2 pb-1 pt-1 text-xs text-muted">{t.toc.placementLabel}</p>
            {(["right", "bottom", "left"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={placement === value}
                onClick={() => {
                  setTocPlacement(value);
                  setSettings(null);
                }}
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-surface md:min-h-9"
              >
                <span className="w-4 text-accent">{placement === value && <Icon name="check" size={14} />}</span>
                {t.toc.placements[value]}
              </button>
            ))}
          </div>
        </Popover>
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
      <Icon name="info" className="mr-1 inline" />
      {t.comments.open(controller.visible.length)}
    </button>
  );
}
