"use client";

import { loadChatChips } from "@/app/chat-actions";
import { taskChips } from "@/app/task-wiki-actions";
import { chipRefOf, type ChipRef } from "@/lib/chat-chips";
import { t } from "@/i18n";
import { drawServiceMark, type ServiceIconId } from "@/components/services/service-icon";

// Chips in table cells (smart chips everywhere, step 2 — UI-2). A cell keeps a plain link
// to something in this workspace; the table draws it as a chip with the service's mark
// and the thing's current title, read with the viewer's own access ("No access" otherwise).

export type CellChip =
  | { state: "loading" }
  | { state: "none" }
  | { state: "ok"; service: ServiceIconId; title: string; href: string };

const cache = new Map<string, CellChip>();
const queue = new Map<string, ChipRef>();
const listeners = new Set<() => void>();
let where = { shortId: "", workspaceId: "" };
let timer: ReturnType<typeof setTimeout> | null = null;

export function onCellChips(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const hrefOf = (ref: ChipRef) => {
  const url = new URL(ref.url);
  return url.pathname + url.search;
};

async function load(refs: ChipRef[]) {
  const from = where;
  const found = await loadChatChips(from.shortId, from.workspaceId, refs).catch(() => null);
  if (!found || from !== where) return;
  const keyOf = (ref: ChipRef) => `${from.shortId}|${ref.key}`;
  const taskIds = refs.flatMap((ref) => (found[ref.key]?.kind === "task" ? [(found[ref.key] as { id: string }).id] : []));
  const tasks = taskIds.length ? await taskChips(from.shortId, taskIds).catch(() => []) : [];
  if (from !== where) return;
  for (const ref of refs) {
    const chip = found[ref.key];
    const href = hrefOf(ref);
    if (!chip || chip.kind === "none") cache.set(keyOf(ref), { state: "none" });
    else if (chip.kind === "page") cache.set(keyOf(ref), { state: "ok", service: "wiki", title: chip.title, href });
    else if (chip.kind === "object") cache.set(keyOf(ref), { state: "ok", service: chip.service === "wishlists" ? "home" : chip.service, title: chip.title, href });
    else if (chip.kind === "file") cache.set(keyOf(ref), { state: "ok", service: "files", title: chip.title ?? "", href });
    else {
      const task = tasks.find((one) => one.id === chip.id);
      cache.set(keyOf(ref), task ? { state: "ok", service: "tasks", title: `${task.key} ${task.title}`, href } : { state: "none" });
    }
  }
  for (const listener of listeners) listener();
}

// The chip of a cell's text, if it is a link to this workspace (asked for if not known yet).
export function cellChipOf(text: unknown, shortId: string, workspaceId: string): CellChip | null {
  if (typeof text !== "string" || !text.startsWith("http") || /\s/.test(text.trim())) return null;
  const ref = chipRefOf(text.trim(), window.location.host, shortId);
  if (!ref) return null;
  if (where.shortId !== shortId || where.workspaceId !== workspaceId) where = { shortId, workspaceId };
  const key = `${shortId}|${ref.key}`;
  const known = cache.get(key);
  if (known) return known;
  cache.set(key, { state: "loading" });
  queue.set(ref.key, ref);
  if (!timer)
    timer = setTimeout(() => {
      timer = null;
      const refs = [...queue.values()];
      queue.clear();
      void load(refs);
    }, 50);
  return { state: "loading" };
}

// A title just picked in "Insert chip" shows at once.
export function rememberCellChip(url: string, shortId: string, chip: CellChip) {
  const ref = chipRefOf(url, window.location.host, shortId);
  if (ref) cache.set(`${shortId}|${ref.key}`, chip);
}

// Over the cell's own drawing: its background, then a pill with the mark and the title.
export function drawCellChip(ctx: CanvasRenderingContext2D, box: { startX: number; startY: number; endX: number; endY: number }, chip: CellChip, background: string) {
  const width = box.endX - box.startX;
  const height = box.endY - box.startY;
  if (width < 12 || height < 10) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.startX + 1, box.startY + 1, width - 2, height - 2);
  ctx.clip();
  ctx.fillStyle = background;
  ctx.fillRect(box.startX + 1, box.startY + 1, width - 2, height - 2);
  const pillHeight = Math.min(18, height - 4);
  const top = box.startY + (height - pillHeight) / 2;
  const left = box.startX + 3;
  let text = chip.state === "ok" ? chip.title || t.editor.chips.untitledObject : chip.state === "none" ? t.editor.chips.noAccess : "…";
  ctx.font = "12px system-ui, -apple-system, Segoe UI, sans-serif";
  const mark = chip.state === "ok" ? 12 : 0;
  // What doesn't fit the cell ends with "…".
  const room = width - 6 - 12 - (mark ? mark + 4 : 0);
  if (ctx.measureText(text).width > room) {
    while (text.length > 1 && ctx.measureText(`${text}…`).width > room) text = text.slice(0, -1);
    text = `${text.trimEnd()}…`;
  }
  const pillWidth = Math.min(width - 6, ctx.measureText(text).width + 12 + (mark ? mark + 4 : 0));
  ctx.fillStyle = chip.state === "ok" ? "#ffffff" : "#f1f5f9";
  ctx.strokeStyle = "#d4d4d8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(left + 0.5, top + 0.5, pillWidth - 1, pillHeight - 1, pillHeight / 2);
  ctx.fill();
  ctx.stroke();
  let x = left + 6;
  if (chip.state === "ok") {
    drawServiceMark(ctx, chip.service, x, top + (pillHeight - mark) / 2, mark);
    x += mark + 4;
  }
  ctx.fillStyle = chip.state === "ok" ? "#18181b" : "#64748b";
  ctx.textBaseline = "middle";
  ctx.beginPath();
  ctx.rect(left, top, pillWidth - 6, pillHeight);
  ctx.clip();
  ctx.fillText(text, x, top + pillHeight / 2);
  ctx.restore();
}
