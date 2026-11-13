"use server";

import { wishlistEmbedView } from "@/app/wishlist-actions";
import { dataClient } from "@/lib/team-db/data";
import { readWorkbook } from "@/lib/sheets";
import { collectRefs, MAX_SHEET_ROWS, type MdObject, type MdSheet, type MdSheetTab, type MdTaskChip, type MdTaskList } from "@/lib/page-markdown";
import { boardView } from "./board-actions";
import { nodeObjectView } from "./node-actions";
import { sheetView } from "./sheet-actions";
import { surveyView } from "./survey-actions";
import { taskChips, taskEmbed } from "./task-wiki-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// More embeds than this on one page are shown as "no access" in the file.
const MAX_EMBEDS = 60;

export type PageExport = {
  title: string;
  icon: string | null;
  content: unknown;
  sheets: Record<string, MdSheet | null>;
  boards: Record<string, MdObject | null>;
  wishlists: Record<string, MdObject | null>;
  nodes: Record<string, MdObject | null>;
  surveys: Record<string, MdObject | null>;
  taskLists: Record<string, MdTaskList | null>;
  taskChips: Record<string, MdTaskChip>;
  files: string[];
};

type Cell = { m?: unknown; v?: unknown; ct?: { t?: string; s?: { v?: unknown }[] } };

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  const cell = value as Cell;
  if (cell.ct?.t === "inlineStr" && Array.isArray(cell.ct.s)) return cell.ct.s.map((part) => String(part?.v ?? "")).join("");
  if (cell.m !== undefined && cell.m !== null) return String(cell.m);
  return cell.v === null || cell.v === undefined ? "" : String(cell.v);
}

// A sheet's filled area as text rows (top-left corner to the last filled cell).
function sheetTab(sheet: Record<string, unknown>): MdSheetTab {
  const cells = Array.isArray(sheet.celldata) ? (sheet.celldata as { r: number; c: number; v: unknown }[]) : [];
  const grid = new Map<number, Map<number, string>>();
  let lastRow = -1;
  let lastColumn = -1;
  for (const cell of cells) {
    const text = cellText(cell?.v);
    if (!text || !Number.isInteger(cell.r) || !Number.isInteger(cell.c)) continue;
    if (!grid.has(cell.r)) grid.set(cell.r, new Map());
    grid.get(cell.r)!.set(cell.c, text);
    lastRow = Math.max(lastRow, cell.r);
    lastColumn = Math.max(lastColumn, cell.c);
  }
  const shown = Math.min(lastRow + 1, MAX_SHEET_ROWS);
  const rows = Array.from({ length: shown }, (_, r) => Array.from({ length: lastColumn + 1 }, (_, c) => grid.get(r)?.get(c) ?? ""));
  return { name: String(sheet.name ?? ""), rows, totalRows: lastRow + 1 };
}

const pick = <T,>(ids: Set<string>) => [...ids].slice(0, MAX_EMBEDS) as T[];

// Everything a page's Markdown export needs, read with the reader's own access:
// what they can't see comes back as null (or missing) and is written as "no access".
export async function pageExport(shortId: string, pageId: string): Promise<PageExport | null> {
  if (!UUID.test(pageId)) return null;
  const db = await dataClient(shortId);
  const { data: page } = await db.from("pages").select("title, icon, content").eq("id", pageId).maybeSingle();
  if (!page) return null;
  const refs = collectRefs(page.content);

  const [sheets, boards, nodes, surveys, lists, chips, wishlists] = await Promise.all([
    Promise.all(pick<string>(refs.sheets).map(async (id) => {
      const view = await sheetView(shortId, id);
      if (!view) return [id, null] as const;
      const workbook = readWorkbook(view.data, "");
      const sheet: MdSheet = {
        id: view.id,
        title: view.title,
        tabs: workbook.sheets.map(sheetTab),
        charts: (workbook.charts ?? []).map((chart) => ({ id: chart.id, title: chart.title ?? "" })),
      };
      return [id, sheet] as const;
    })),
    Promise.all(pick<string>(refs.boards).map(async (id) => {
      const view = await boardView(shortId, id);
      return [id, view ? { id: view.id, title: view.title } : null] as const;
    })),
    Promise.all(pick<string>(refs.nodes).map(async (id) => {
      const view = await nodeObjectView(shortId, id);
      return [id, view ? { id: view.id, title: view.title, kind: view.kind } : null] as const;
    })),
    Promise.all(pick<string>(refs.surveys).map(async (id) => {
      const view = await surveyView(shortId, id);
      return [id, view ? { id: view.id, title: view.title } : null] as const;
    })),
    Promise.all(pick<string>(refs.taskLists).map(async (key) => {
      const [projectId, mine] = key.split(":");
      const embed = await taskEmbed(shortId, projectId, mine === "1");
      return [key, embed] as const;
    })),
    taskChips(shortId, [...refs.taskChips]),
    Promise.all(pick<string>(refs.wishlists).map(async (id) => {
      const view = await wishlistEmbedView(shortId, id);
      return [id, view ? { id: view.id, title: view.title || `${view.ownerName}` } : null] as const;
    })),
  ]);

  // Names of the people tasks are assigned to (only those the reader can see).
  const assigneeIds = [...new Set(lists.flatMap(([, embed]) => embed?.tasks.map((task) => task.assignee_id) ?? []).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (assigneeIds.length) {
    const { data: people } = await db.from("profiles").select("id, name, email").in("id", assigneeIds);
    for (const person of (people ?? []) as { id: string; name: string | null; email: string }[]) names.set(person.id, person.name || person.email);
  }

  const taskLists: Record<string, MdTaskList | null> = {};
  for (const [key, embed] of lists) {
    if (!embed) {
      taskLists[key] = null;
      continue;
    }
    const statuses = new Map(embed.statuses.map((status) => [status.id, status]));
    taskLists[key] = {
      key: embed.project.key,
      name: `${embed.project.icon ? `${embed.project.icon} ` : ""}${embed.project.name}`,
      total: embed.total,
      tasks: embed.tasks.map((task) => ({
        key: `${embed.project.key}-${task.number}`,
        title: task.title,
        status: statuses.get(task.status_id)?.name ?? "",
        done: statuses.get(task.status_id)?.category === "done",
        assignee: task.assignee_id ? (names.get(task.assignee_id) ?? null) : null,
      })),
    };
  }

  return {
    title: page.title as string,
    icon: (page.icon as string | null) ?? null,
    content: page.content,
    sheets: Object.fromEntries(sheets),
    boards: Object.fromEntries(boards),
    wishlists: Object.fromEntries(wishlists),
    nodes: Object.fromEntries(nodes),
    surveys: Object.fromEntries(surveys),
    taskLists,
    taskChips: Object.fromEntries(chips.filter((chip) => !chip.deleted).map((chip) => [chip.id, { key: chip.key, title: chip.title, status: chip.status }])),
    files: [...refs.files],
  };
}
