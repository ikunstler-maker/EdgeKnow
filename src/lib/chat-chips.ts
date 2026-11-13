import { vaultFileIdOf } from "./vault-links";

// Toker live chips: a link to something in the same workspace (a page, a task, a
// table, a board…) shows as a card with its current title; a task's card also
// shows and changes its status and assignee. The reader's own access decides what comes back
// (decision 2026-11-13 "Toker, етап 3").

export const CHIP_SERVICES = ["sheets", "boards", "nodes", "slides", "surveys", "apps", "wishlists"] as const;
export type ChipService = (typeof CHIP_SERVICES)[number];

export type ChipRef =
  | { key: string; url: string; kind: "page"; id: string }
  | { key: string; url: string; kind: "task"; project: string; number: number }
  | { key: string; url: string; kind: "object"; service: ChipService; id: string }
  // A Vault file (VAULT-3): its card is read live with the reader's access, like the rest.
  | { key: string; url: string; kind: "file"; id: string };

export type ChatChip =
  // Gone, or the reader may not see it: a neutral badge, never the title.
  | { kind: "none" }
  | { kind: "page"; title: string; icon: string | null }
  | { kind: "object"; service: ChipService; title: string; icon: string | null }
  // A task: its card reads key, title, status and assignee live (like a wiki chip).
  | { kind: "task"; id: string }
  | { kind: "file"; id: string };

export const MAX_CHIPS = 5;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LINK_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;
const PAGE_RE = new RegExp(`^/w/([^/]+)/p/(${UUID})/?$`);
const TASK_RE = /^\/w\/([^/]+)\/tasks\/([A-Za-z][A-Za-z0-9]{1,9})\/(\d{1,7})\/?$/;
const OBJECT_RE = new RegExp(`^/w/([^/]+)/(${CHIP_SERVICES.join("|")})/(${UUID})/?$`);

// One link → what it points at, when it is this site and this workspace.
export function chipRefOf(url: string, host: string, shortId: string): ChipRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.host !== host) return null;
  const path = parsed.pathname;
  let m = PAGE_RE.exec(path);
  if (m && m[1] === shortId) return { key: `page:${m[2]}`, url, kind: "page", id: m[2] };
  m = TASK_RE.exec(path);
  if (m && m[1] === shortId) {
    const project = m[2].toUpperCase();
    return { key: `task:${project}-${m[3]}`, url, kind: "task", project, number: Number(m[3]) };
  }
  m = OBJECT_RE.exec(path);
  if (m && m[1] === shortId) return { key: `object:${m[3]}`, url, kind: "object", service: m[2] as ChipService, id: m[3] };
  const file = vaultFileIdOf(url, shortId);
  if (file) return { key: `file:${file}`, url, kind: "file", id: file };
  return null;
}

// The workspace links of a message (each once, at most MAX_CHIPS).
export function chipRefsIn(body: string, host: string, shortId: string): ChipRef[] {
  if (!body.includes("/w/")) return [];
  const refs = new Map<string, ChipRef>();
  for (const [url] of body.matchAll(LINK_RE)) {
    const ref = chipRefOf(url, host, shortId);
    if (ref && !refs.has(ref.key)) refs.set(ref.key, ref);
    if (refs.size >= MAX_CHIPS) break;
  }
  return [...refs.values()];
}
