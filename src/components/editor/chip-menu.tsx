"use client";

import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { t } from "@/i18n";
import { searchEvents } from "@/app/calendar-actions";
import { loadChatChips } from "@/app/chat-actions";
import { searchChipTargets } from "@/app/chip-actions";
import { createTaskFromPage, searchTasksForChip } from "@/app/task-wiki-actions";
import { chipRefOf } from "@/lib/chat-chips";
import type { PageNode } from "@/lib/pages";
import { SERVICE_BRANDS } from "@/lib/services";
import { ServiceIcon } from "@/components/services/service-icon";
import { Icon } from "@/components/ui/icon";
import { eventWhen, rememberEvent } from "./event-chip";
import { rememberObjectChip } from "./object-chip";
import { rememberTask } from "./task-chip-store";

// The "@" menu's chips, shared by the wiki and task descriptions (smart chips everywhere,
// UI-1), and a workspace link pasted on its own turned into its chip.

type Inline = { type: string; props: Record<string, string> } | string;
// Any editor whose schema has the chips (method syntax: the wiki's and the task's editors fit).
export type ChipEditor = { insertInlineContent(content: Inline[]): void };

const insertChip = (editor: ChipEditor, chip: { type: string; props: Record<string, string> }) => editor.insertInlineContent([chip, " "]);

// Pages the person sees (from the page list they already have).
export function pageMentionItems(editor: ChipEditor, pages: PageNode[], exceptPageId?: string): DefaultReactSuggestionItem[] {
  return pages
    .filter((p) => p.id !== exceptPageId)
    .map((page) => ({
      title: page.title || t.pages.untitled,
      group: t.editor.chips.pages,
      icon: page.icon ? <span aria-hidden="true">{page.icon}</span> : <Icon name="file-text" className="text-muted" />,
      onItemClick: () => insertChip(editor, { type: "pageChip", props: { pageId: page.id } }),
    }));
}

// Calendar events the person sees, by title (Doba, phase 2b).
export async function eventMentionItems(editor: ChipEditor, shortId: string, query: string): Promise<DefaultReactSuggestionItem[]> {
  if (query.trim().length < 2) return [];
  const found = await searchEvents(shortId, query).catch(() => []);
  return found.slice(0, 5).map((event) => ({
    title: `${event.title} · ${eventWhen(event)}`,
    group: t.calendar.chip.group,
    icon: <Icon name="calendar" />,
    onItemClick: () => {
      rememberEvent({ ...event, cancelled: false });
      insertChip(editor, { type: "eventChip", props: { eventId: event.id } });
    },
  }));
}

// Tasks by key or title; on a wiki page also a new task from what was typed (step Z4).
export async function taskMentionItems(editor: ChipEditor, shortId: string, query: string, pageId?: string): Promise<DefaultReactSuggestionItem[]> {
  const { tasks, projects } = await searchTasksForChip(shortId, query).catch(() => ({ tasks: [], projects: [] }));
  const insert = (taskId: string) => insertChip(editor, { type: "taskChip", props: { taskId } });
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
  const create =
    pageId && title.length >= 2 && !/^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/.test(title)
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

// Tables, boards, maps, slides, surveys, apps, wishlists and Vault files the person sees.
export async function objectMentionItems(editor: ChipEditor, shortId: string, query: string): Promise<DefaultReactSuggestionItem[]> {
  const found = await searchChipTargets(shortId, query).catch(() => []);
  return found.map((hit) => {
    const kind = hit.kind === "file" ? ("files" as const) : hit.service;
    const icon = hit.kind === "object" ? hit.icon : null;
    return {
      title: hit.title || t.editor.chips.untitledObject,
      subtext: kind === "wishlists" ? t.chat.chips.wishlist : SERVICE_BRANDS[kind].name,
      group: hit.kind === "file" ? t.editor.chips.filesGroup : t.editor.chips.objectsGroup,
      icon: kind === "wishlists" ? <Icon name="gift" /> : <ServiceIcon serviceId={kind} size={16} />,
      onItemClick: () => {
        rememberObjectChip(kind, hit.id, hit.title, icon);
        insertChip(editor, { type: "objectChip", props: { kind, objectId: hit.id } });
      },
    };
  });
}

// A link to something in this workspace, pasted on its own, becomes its chip. Returns
// false when the text is not such a link (the editor then pastes as usual).
export function pasteLinkAsChip(editor: ChipEditor, text: string, shortId: string, workspaceId: string): boolean {
  if (!text || /\s/.test(text) || typeof window === "undefined") return false;
  const ref = chipRefOf(text, window.location.host, shortId);
  if (!ref) return false;
  if (ref.kind === "page") insertChip(editor, { type: "pageChip", props: { pageId: ref.id } });
  else if (ref.kind === "object") insertChip(editor, { type: "objectChip", props: { kind: ref.service, objectId: ref.id } });
  else if (ref.kind === "file") insertChip(editor, { type: "objectChip", props: { kind: "files", objectId: ref.id } });
  else {
    // A task link names the project's key and number: its id is looked up with the
    // person's access; without access the link stays plain text.
    void loadChatChips(shortId, workspaceId, [ref])
      .then((found) => {
        const chip = found[ref.key];
        if (chip?.kind === "task") insertChip(editor, { type: "taskChip", props: { taskId: chip.id } });
        else editor.insertInlineContent([text]);
      })
      .catch(() => editor.insertInlineContent([text]));
  }
  return true;
}
