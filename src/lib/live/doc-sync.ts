import * as Y from "yjs";

// A document of the canvas engine (a deck, a "Design" file) as a shared Yjs document,
// for real-time co-editing. The editors keep working on plain JSON; this module turns
// a change of that JSON into small Yjs changes and Yjs back into JSON.
//
// Shape: every object is a Y.Map. Plain fields are stored as values (one person's change
// of a field wins over another's, field by field). Lists of items with an "id" (slides,
// pages, layers, flows) are Y.Maps keyed by id with an order number "_o", so two people
// adding, removing or reordering items never duplicate or lose one.

export type ListSpec = { lists?: Record<string, ListSpec> };

export const DECK_SPEC: ListSpec = { lists: { slides: { lists: { nodes: {} } } } };
export const DESIGN_SPEC: ListSpec = { lists: { pages: { lists: { nodes: {}, flows: {} } } } };

const ORDER = "_o";
type Json = Record<string, unknown>;
type Item = Json & { id: string };

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const isItemList = (value: unknown): value is Item[] =>
  Array.isArray(value) && value.every((x) => x && typeof x === "object" && typeof (x as Item).id === "string");

export const rootOf = (doc: Y.Doc) => doc.getMap<unknown>("doc");

// Yjs → JSON.
export function readMap(map: Y.Map<unknown>, spec: ListSpec): Json {
  const out: Json = {};
  map.forEach((value, key) => {
    if (key === ORDER) return;
    const child = spec.lists?.[key];
    if (child && value instanceof Y.Map) {
      const items: { order: number; id: string; item: Json }[] = [];
      (value as Y.Map<unknown>).forEach((itemMap, id) => {
        if (!(itemMap instanceof Y.Map)) return;
        const order = itemMap.get(ORDER);
        items.push({ order: typeof order === "number" ? order : 0, id, item: { ...readMap(itemMap as Y.Map<unknown>, child), id } });
      });
      items.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      out[key] = items.map((x) => x.item);
    } else {
      out[key] = value;
    }
  });
  for (const key of Object.keys(spec.lists ?? {})) if (!(key in out)) out[key] = [];
  return out;
}

// The order numbers that put `ids` in this sequence, changing as few items as possible:
// items already in the right relative order (the longest such run) keep theirs.
function placeOrders(ids: string[], current: Map<string, number>): Map<string, number> {
  const known = ids.map((id, at) => ({ id, at, order: current.get(id) })).filter((x): x is { id: string; at: number; order: number } => x.order !== undefined);
  // Longest increasing run of order numbers (patience sorting).
  const tails: number[] = [];
  const prev: number[] = new Array(known.length).fill(-1);
  for (let i = 0; i < known.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (known[tails[mid]].order < known[i].order) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<string>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(known[i].id);

  const result = new Map<string, number>();
  for (const id of keep) result.set(id, current.get(id)!);
  // Fill the gaps between kept items evenly.
  let i = 0;
  while (i < ids.length) {
    if (keep.has(ids[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < ids.length && !keep.has(ids[j])) j++;
    const low = i > 0 ? result.get(ids[i - 1])! : undefined;
    const high = j < ids.length ? result.get(ids[j])! : undefined;
    const count = j - i;
    for (let k = 0; k < count; k++) {
      const value =
        low === undefined && high === undefined ? k : low === undefined ? high! - (count - k) : high === undefined ? low + k + 1 : low + ((high - low) * (k + 1)) / (count + 1);
      result.set(ids[i + k], value);
    }
    i = j;
  }
  return result;
}

// Writes the change from `before` to `after` into `map`; untouched fields and items stay as
// they are in Yjs (others' changes made meanwhile survive). Run inside a transaction.
export function writeChange(map: Y.Map<unknown>, before: Json, after: Json, spec: ListSpec) {
  for (const key of Object.keys(before)) {
    if (key !== "id" && !(key in after) && map.has(key)) map.delete(key);
  }
  for (const [key, value] of Object.entries(after)) {
    if (key === "id" || key === ORDER || value === undefined) continue;
    const child = spec.lists?.[key];
    if (child && isItemList(value)) {
      const old = isItemList(before[key]) ? (before[key] as Item[]) : [];
      if (old === value) continue;
      let list = map.get(key);
      if (!(list instanceof Y.Map)) {
        list = new Y.Map<unknown>();
        map.set(key, list);
      }
      writeList(list as Y.Map<Y.Map<unknown>>, old, value, child);
    } else if (!same(before[key], value) || !map.has(key)) {
      map.set(key, value);
    }
  }
}

function writeList(list: Y.Map<Y.Map<unknown>>, before: Item[], after: Item[], spec: ListSpec) {
  const keepIds = new Set(after.map((x) => x.id));
  for (const item of before) if (!keepIds.has(item.id) && list.has(item.id)) list.delete(item.id);
  const old = new Map(before.map((x) => [x.id, x]));
  for (const item of after) {
    let itemMap = list.get(item.id);
    if (!(itemMap instanceof Y.Map)) {
      itemMap = new Y.Map<unknown>();
      list.set(item.id, itemMap);
      writeChange(itemMap, {}, item, spec);
    } else if (old.get(item.id) !== item) {
      writeChange(itemMap, old.get(item.id) ?? {}, item, spec);
    }
  }
  // Order: only what moved gets a new number.
  const current = new Map<string, number>();
  for (const item of after) {
    const order = list.get(item.id)?.get(ORDER);
    if (typeof order === "number") current.set(item.id, order);
  }
  const ids = after.map((x) => x.id);
  const sameOrder = before.length === after.length && before.every((x, i) => x.id === ids[i]) && current.size === ids.length;
  if (sameOrder) return;
  for (const [id, order] of placeOrders(ids, current)) {
    const itemMap = list.get(id);
    if (itemMap && itemMap.get(ORDER) !== order) itemMap.set(ORDER, order);
  }
}

// The first state of a shared document, from the saved JSON. Built by a fixed client id
// tied to the saved version, so two people who start the same version at the same moment
// make the very same Yjs data (no doubled slides); a different version never collides.
export function seedUpdate(json: Json, spec: ListSpec, savedVersion: number): Uint8Array {
  const seed = new Y.Doc();
  seed.clientID = 1_000_000 + (Math.abs(Math.trunc(savedVersion)) % 1_000_000_000);
  seed.transact(() => writeChange(rootOf(seed), {}, json, spec));
  const update = Y.encodeStateAsUpdate(seed);
  seed.destroy();
  return update;
}

// `next` with every part equal to `prev` replaced by `prev` itself, so editors that skip
// unchanged slides or layers by reference keep doing so after someone else's change.
export function shareUnchanged<T>(prev: T, next: T): T {
  if (prev === next) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) {
    const byId = new Map(prev.map((x, i) => [x && typeof x === "object" && "id" in x ? (x as Item).id : `#${i}`, x]));
    let changed = prev.length !== next.length;
    const out = next.map((x, i) => {
      const key = x && typeof x === "object" && "id" in x ? (x as Item).id : `#${i}`;
      const shared = byId.has(key) ? shareUnchanged(byId.get(key), x) : x;
      if (shared !== prev[i]) changed = true;
      return shared;
    });
    return (changed ? out : prev) as T;
  }
  if (prev && next && typeof prev === "object" && typeof next === "object" && !Array.isArray(prev) && !Array.isArray(next)) {
    const p = prev as Json;
    const n = next as Json;
    const keys = Object.keys(n);
    let changed = keys.length !== Object.keys(p).length;
    const out: Json = {};
    for (const key of keys) {
      out[key] = key in p ? shareUnchanged(p[key], n[key]) : n[key];
      if (out[key] !== p[key]) changed = true;
    }
    return (changed ? out : prev) as T;
  }
  return same(prev, next) ? prev : next;
}

// Base64 for sending Yjs updates as JSON.
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
