"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import type { Embed } from "@/lib/slides";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { searchTasksForChip, type ChipTask } from "@/app/task-wiki-actions";
import { pageCard } from "@/app/page-actions";
import { SheetEmbed } from "@/components/editor/sheet-block";
import { SurveyEmbed } from "@/components/editor/survey-block";
import { BoardEmbed } from "@/components/editor/board-block";
import { NodeMapEmbed } from "@/components/editor/node-map-block";
import { TaskChipView, TasksEmbedView } from "@/components/editor/task-blocks";
import { WishlistEmbed } from "@/components/wishlists/wishlist-embed";
import { VaultFileEmbed } from "@/components/files/vault-file-embed";
import { Icon } from "@/components/ui/icon";
import { LinkChip } from "@/components/editor/link-chip";
import { ChipPicker } from "@/components/sheets/chip-picker";
import { rememberCellChip } from "@/components/sheets/sheet-chips";

const e = t.slides.embeds;
const inputClass = "min-h-11 w-full rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";

// A live object of another service on a slide: the same embeds as in wiki pages, with the
// viewer's own access. `setup` lets the editor pick the object (the embeds' own pickers).
export function SlideEmbed({ embed, setup, onEmbed }: { embed: Embed; setup: boolean; onEmbed: (embed: Embed) => void }) {
  const pages = useOptionalPages();
  const shortId = pages?.workspace.shortId ?? "";
  switch (embed.kind) {
    case "sheet":
      return <SheetEmbed sheetId={embed.id} chartId={embed.chartId ?? ""} pageEditable={setup} onPick={(id, chartId) => onEmbed({ ...embed, id, chartId: chartId || undefined })} />;
    case "survey":
      return <SurveyEmbed surveyId={embed.id} view={embed.view ?? "form"} pageEditable={setup} onPick={(id, view) => onEmbed({ ...embed, id, view })} />;
    case "board":
      return <BoardEmbed boardId={embed.id} pageEditable={setup} onPick={(id) => onEmbed({ ...embed, id })} />;
    case "map":
      return <NodeMapEmbed objectId={embed.id} pageEditable={setup} onPick={(id) => onEmbed({ ...embed, id })} />;
    case "tasks":
      return (
        <TasksEmbedView
          projectId={embed.id}
          view="list"
          mine={!!embed.mine}
          editable={setup}
          onChange={(props) => onEmbed({ ...embed, id: props.projectId ?? embed.id, mine: props.mine ?? embed.mine })}
        />
      );
    case "task":
      return embed.id ? <TaskCard taskId={embed.id} /> : setup ? <TaskPicker shortId={shortId} onPick={(id) => onEmbed({ ...embed, id })} /> : <NoAccess />;
    case "wishlist":
      return <WishlistEmbed shortId={shortId} wishlistId={embed.id} editable={setup} onPick={(id) => onEmbed({ ...embed, id })} />;
    case "file":
      return <VaultFileEmbed shortId={shortId} fileId={embed.id} editable={setup} onPick={(id) => onEmbed({ ...embed, id })} />;
    case "page":
      return embed.id ? <PageCard shortId={shortId} pageId={embed.id} /> : setup ? <PagePicker onPick={(id) => onEmbed({ ...embed, id })} /> : <NoAccess />;
    case "chip":
      return <ChipEmbed link={embed.link} setup={setup} onLink={(link) => onEmbed({ ...embed, link })} />;
  }
}

// A chip on a slide (UI-4): any page, task, table, board or file of the workspace, its live title.
function ChipEmbed({ link, setup, onLink }: { link?: string; setup: boolean; onLink: (link: string) => void }) {
  const [picking, setPicking] = useState(false);
  const pages = useOptionalPages();
  return (
    <div className="flex h-full items-center justify-center gap-2 p-2 text-base" data-embed-chip>
      {link ? <LinkChip link={link} className="text-sm" attr="data-slide-chip" /> : !setup && <NoAccess />}
      {setup && pages && (
        <button type="button" onClick={() => setPicking(true)} className="rounded-md border border-border bg-background px-2 py-1 text-sm hover:bg-surface" data-embed-chip-pick>
          {link ? e.chipChange : e.chipPick}
        </button>
      )}
      {picking && pages && (
        <ChipPicker
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            setPicking(false);
            const url = `${window.location.origin}${picked.path}`;
            rememberCellChip(url, pages.workspace.shortId, { state: "ok", service: picked.service, title: picked.title, href: picked.path });
            onLink(url);
          }}
        />
      )}
    </div>
  );
}

const NoAccess = () => (
  <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border p-4 text-sm text-muted" data-embed-no-access>
    <Icon name="lock" className="mr-1 inline" />
    {e.noAccess}
  </div>
);

function TaskCard({ taskId }: { taskId: string }) {
  return (
    <div className="flex h-full items-center rounded-lg border border-border bg-background p-3" data-embed-task>
      <TaskChipView taskId={taskId} />
    </div>
  );
}

function TaskPicker({ shortId, onPick }: { shortId: string; onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<ChipTask[]>([]);
  useEffect(() => {
    if (!shortId) return;
    let alive = true;
    const timer = setTimeout(() => void searchTasksForChip(shortId, query).then((r) => alive && setTasks(r.tasks)), 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [shortId, query]);
  return (
    <div className="h-full space-y-2 overflow-auto rounded-lg border border-border bg-background p-3 text-sm" data-embed-picker="task">
      <input value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder={e.findTask} aria-label={e.findTask} className={inputClass} autoFocus />
      <ul>
        {tasks.slice(0, 12).map((task) => (
          <li key={task.id}>
            <button type="button" onClick={() => onPick(task.id)} className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left hover:bg-surface md:min-h-9">
              <span className="font-mono text-xs text-muted">{task.key}</span>
              <span className="truncate">{task.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PageCard({ shortId, pageId }: { shortId: string; pageId: string }) {
  const [card, setCard] = useState<Awaited<ReturnType<typeof pageCard>> | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void pageCard(shortId, pageId).then((c) => alive && setCard(c));
    return () => {
      alive = false;
    };
  }, [shortId, pageId]);
  if (card === undefined) return <div className="h-full animate-pulse rounded-lg bg-surface" />;
  if (!card) return <NoAccess />;
  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden rounded-lg border border-border bg-background p-4" data-embed-page>
      <p className="text-lg font-semibold">
        {card.icon ? `${card.icon} ` : ""}{card.title || t.pages.untitled}
      </p>
      <p className="line-clamp-4 text-sm text-muted">{card.snippet}</p>
      <Link href={workspacePath(shortId, `/p/${card.id}`)} className="mt-auto text-sm text-accent hover:underline">
        {e.open}
        <Icon name="arrow-right" size={14} className="ml-1 inline" />
      </Link>
    </div>
  );
}

function PagePicker({ onPick }: { onPick: (id: string) => void }) {
  const pages = useOptionalPages()?.pages ?? [];
  return (
    <div className="h-full overflow-auto rounded-lg border border-border bg-background p-3 text-sm" data-embed-picker="page">
      <p className="mb-2 text-muted">{e.pickPage}</p>
      <ul>
        {pages.slice(0, 200).map((page) => (
          <li key={page.id}>
            <button type="button" onClick={() => onPick(page.id)} className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left hover:bg-surface md:min-h-9">
              {page.icon ? <span>{page.icon}</span> : <Icon name="file-text" className="text-muted" />}
              <span className="truncate">{page.title || t.pages.untitled}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
