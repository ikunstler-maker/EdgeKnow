// Real-time co-editing of an idea board (phase 2): the board's canvas library keeps a
// version on every element, so two copies are merged element by element without Yjs.
// The newer version of an element wins; on the same version the lower random "nonce"
// wins (as the library's own collaboration does), so every copy ends the same way.
// Deleted elements stay as "tombstones" while the room is open, so a deletion is shared.

export type BoardElement = { id: string; version: number; versionNonce: number; index?: string | null; isDeleted?: boolean } & Record<string, unknown>;
export type BoardLook = { viewBackgroundColor?: string; gridModeEnabled?: boolean };
export type BoardFiles = Record<string, { file: string; mimeType: string }>;
// The whole board as the room shares it: elements with tombstones, the look and picture links.
export type BoardScene = { elements: BoardElement[]; appState: BoardLook; files: BoardFiles };

export const elementKey = (e: Pick<BoardElement, "version" | "versionNonce">) => `${e.version}:${e.versionNonce}`;

// Whether the incoming copy of an element replaces the local one.
export function wins(incoming: BoardElement, local: BoardElement | undefined) {
  if (!local) return true;
  if (incoming.version !== local.version) return incoming.version > local.version;
  return incoming.versionNonce < local.versionNonce;
}

// The library draws elements in the order of their fractional "index" (compared as plain
// strings); elements without one keep their place.
function byIndex(list: BoardElement[]) {
  return list
    .map((e, at) => ({ e, at }))
    .sort((a, b) => {
      const x = a.e.index ?? null;
      const y = b.e.index ?? null;
      if (x !== null && y !== null && x !== y) return x < y ? -1 : 1;
      if (x !== null && y !== null && a.e.id !== b.e.id) return a.e.id < b.e.id ? -1 : 1;
      return a.at - b.at;
    })
    .map((x) => x.e);
}

// Local elements with the incoming ones merged in. `busy` are elements the person is
// changing right now (typing in, resizing, drawing): theirs stay until they finish, and
// then their newer version wins anyway. Returns null when nothing changes.
export function mergeElements(local: readonly BoardElement[], incoming: readonly BoardElement[], busy: ReadonlySet<string> = new Set()): BoardElement[] | null {
  const at = new Map(local.map((e, i) => [e.id, i]));
  const next = [...local];
  let changed = false;
  for (const e of incoming) {
    if (!e || typeof e.id !== "string" || typeof e.version !== "number") continue;
    const i = at.get(e.id);
    const mine = i === undefined ? undefined : next[i];
    if (busy.has(e.id) || !wins(e, mine)) continue;
    changed = true;
    if (i === undefined) {
      at.set(e.id, next.length);
      next.push(e);
    } else next[i] = e;
  }
  return changed ? byIndex(next) : null;
}

// What changed locally since the room last knew (`known`: id → version key); `known` is
// updated to what is sent.
export function changedSince(elements: readonly BoardElement[], known: Map<string, string>): BoardElement[] {
  const out: BoardElement[] = [];
  for (const e of elements) {
    const key = elementKey(e);
    if (known.get(e.id) === key) continue;
    known.set(e.id, key);
    out.push(e);
  }
  return out;
}

// Lists of elements split so that each message stays under the channel's size limit.
export function batches(list: readonly BoardElement[], limit: number): BoardElement[][] {
  const out: BoardElement[][] = [];
  let part: BoardElement[] = [];
  let size = 0;
  for (const e of list) {
    const n = JSON.stringify(e).length;
    if (part.length && size + n > limit) {
      out.push(part);
      part = [];
      size = 0;
    }
    part.push(e);
    size += n;
  }
  if (part.length) out.push(part);
  return out;
}
