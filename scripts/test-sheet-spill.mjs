// Spilling of table results into neighbouring cells (SOTA-1), as Excel's dynamic arrays.
// Run: node --experimental-strip-types --no-warnings scripts/test-sheet-spill.mjs
import assert from "node:assert/strict";
import { spillWrites } from "../src/components/sheets/sheet-spill.ts";

const formula = (v, f = "=SEQUENCE(3)") => ({ v, f, m: "x" });
const values = (writes) => writes.filter((w) => "value" in w).map((w) => `${w.r},${w.c}=${w.value}`).sort();

// A column result fills the cells below; the formula's cell shows the first value.
{
  const data = [[formula([[1], [2], [3]])], [null], [null]];
  const writes = spillWrites(data);
  assert.deepEqual(values(writes), ["1,0=2", "2,0=3"]);
  assert.ok(writes.some((w) => w.shown === "1" && w.r === 0 && w.c === 0));
  assert.ok(writes.filter((w) => "value" in w).every((w) => w.owner === "0,0"));
}

// A table result fills right and down.
{
  const data = [[formula([[1, 2], [3, 4]]), null], [null, null]];
  assert.deepEqual(values(spillWrites(data)), ["0,1=2", "1,0=3", "1,1=4"]);
}

// Something of its own in the way: nothing is written, the formula shows #SPILL!.
{
  const data = [[formula([[1], [2], [3]])], [{ v: "mine", m: "mine" }], [null]];
  const writes = spillWrites(data);
  assert.deepEqual(values(writes), []);
  assert.ok(writes.some((w) => w.shown === "#SPILL!"));
}

// A smaller result clears the spilled cells it no longer reaches; a single value spills nothing.
{
  const data = [[formula([[7]])], [{ v: 2, m: "2", ekSpill: "0,0" }], [{ v: 3, m: "3", ekSpill: "0,0" }]];
  const writes = spillWrites(data);
  assert.deepEqual(writes.filter((w) => w.clear).map((w) => `${w.r},${w.c}`).sort(), ["1,0", "2,0"]);
}

// Up to date already: nothing to do.
{
  const data = [[{ ...formula([[1], [2]]), m: "1" }], [{ v: 2, m: "2", ekSpill: "0,0" }]];
  assert.deepEqual(spillWrites(data), []);
}

console.log("sheet spill: all checks passed");
