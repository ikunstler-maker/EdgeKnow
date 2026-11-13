// Idea board co-editing: elements merged by their versions (no browser needed).
// Run: node --experimental-strip-types --no-warnings scripts/test-board-sync.mjs
import assert from "node:assert/strict";
import { batches, changedSince, elementKey, mergeElements, wins } from "../src/lib/live/board-sync.ts";

const el = (id, version, nonce = 5, extra = {}) => ({ id, version, versionNonce: nonce, index: null, ...extra });

// The newer version wins; on the same version the lower nonce, so every copy ends the same.
assert.equal(wins(el("a", 3), el("a", 2)), true);
assert.equal(wins(el("a", 2), el("a", 3)), false);
assert.equal(wins(el("a", 2, 1), el("a", 2, 9)), true);
assert.equal(wins(el("a", 2, 9), el("a", 2, 1)), false);
assert.equal(wins(el("a", 1), undefined), true);

// Two copies changed at the same time converge whichever order the changes arrive in.
{
  const base = [el("a", 1), el("b", 1)];
  const left = [el("a", 2, 7, { x: 10 }), el("b", 1), el("c", 1)];
  const right = [el("a", 2, 3, { x: 20 }), el("b", 2, 1, { isDeleted: true })];
  const l = mergeElements(left, right) ?? left;
  const r = mergeElements(mergeElements(base, right) ?? base, left) ?? base;
  const norm = (list) => JSON.stringify([...list].sort((p, q) => (p.id < q.id ? -1 : 1)));
  assert.equal(norm(l), norm(r));
  assert.equal(l.find((e) => e.id === "a").x, 20, "same version: lower nonce wins");
  assert.equal(l.find((e) => e.id === "b").isDeleted, true, "a deletion is shared as a tombstone");
  assert.ok(l.some((e) => e.id === "c"), "a new element is kept");
}

// Nothing changes → null; an older copy never replaces a newer one.
assert.equal(mergeElements([el("a", 3)], [el("a", 2)]), null);
assert.equal(mergeElements([el("a", 3)], [el("a", 3)]), null);

// What the person is changing right now stays theirs.
assert.equal(mergeElements([el("a", 3)], [el("a", 9)], new Set(["a"])), null);

// Drawing order follows the fractional index (plain string order).
{
  const merged = mergeElements([el("x", 1, 1, { index: "a2" }), el("y", 1, 1, { index: "a0" })], [el("z", 1, 1, { index: "a1" })]);
  assert.deepEqual(merged.map((e) => e.id), ["y", "z", "x"]);
}

// Only what changed since the room last knew is sent, once.
{
  const known = new Map([["a", elementKey(el("a", 1))]]);
  const sent = changedSince([el("a", 1), el("b", 1), el("a", 1)], known);
  assert.deepEqual(sent.map((e) => e.id), ["b"]);
  assert.deepEqual(changedSince([el("a", 2), el("b", 1)], known).map((e) => e.id), ["a"]);
  assert.deepEqual(changedSince([el("a", 2), el("b", 1)], known), []);
}

// Big changes are split under the channel's size limit; nothing is lost.
{
  const list = Array.from({ length: 50 }, (_, i) => el(`e${i}`, 1, 1, { points: Array.from({ length: 40 }, (_, j) => [j, j]) }));
  const parts = batches(list, 2000);
  assert.ok(parts.length > 1);
  assert.equal(parts.flat().length, 50);
  assert.ok(parts.every((p) => p.length === 1 || JSON.stringify(p).length <= 2000 + 100));
}

console.log("board sync: all checks passed");
