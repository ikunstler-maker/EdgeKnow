// "Design" components and variants (BORDY-1): copies follow their component.
// Run: node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-design-components.mjs
import assert from "node:assert/strict";
import { componentSet, detachInstance, layoutAll, newInstance, syncInstances, variantName } from "../src/lib/design.ts";

const frame = (id, x, extra = {}) => ({ id, type: "FRAME", x, y: 0, width: 100, height: 40, rotation: 0, ...extra });
const rect = (id, parentId, x, extra = {}) => ({ id, type: "RECTANGLE", x, y: 10, width: 20, height: 20, rotation: 0, parentId, ...extra });

// A copy gets the component's layers, shifted to where it stands, locked.
let nodes = [frame("btn", 0, { component: "Button/Primary", fill: "#2563eb" }), rect("bg", "btn", 10)];
const made = newInstance(nodes, "btn");
assert.ok(made);
nodes = made.nodes;
const copy = nodes.find((n) => n.id === made.id);
assert.equal(copy.instanceOf, "btn");
assert.equal(copy.x, 140);
const inside = nodes.filter((n) => n.parentId === made.id);
assert.equal(inside.length, 1);
assert.equal(inside[0].x, 150);
assert.equal(inside[0].locked, true);
assert.equal(inside[0].fromComponent, "bg");
assert.equal(copy.fill, "#2563eb");

// A change of the component reaches the copy; the copy keeps its own place.
nodes = nodes.map((n) => (n.id === "bg" ? { ...n, width: 60, fill: "#ff0000" } : n.id === "btn" ? { ...n, fill: "#000000" } : n));
nodes = layoutAll(nodes);
const after = nodes.find((n) => n.parentId === made.id);
assert.equal(after.width, 60);
assert.equal(after.fill, "#ff0000");
assert.equal(nodes.find((n) => n.id === made.id).fill, "#000000");
assert.equal(nodes.find((n) => n.id === made.id).x, 140);
// Stable: running again changes nothing.
assert.equal(JSON.stringify(syncInstances(nodes)), JSON.stringify(nodes));

// A variant: the copy switched to another component of the set takes its layers.
nodes = [...nodes, frame("btn2", 0, { component: "Button/Secondary", y: 100 }), rect("dot", "btn2", 5, { y: 105 })];
nodes = layoutAll(nodes.map((n) => (n.id === made.id ? { ...n, instanceOf: "btn2" } : n)));
assert.deepEqual(nodes.filter((n) => n.parentId === made.id).map((n) => n.fromComponent), ["dot"]);
assert.equal(componentSet("Button/Primary"), "Button");
assert.equal(variantName("Button/Primary"), "Primary");

// Detached: the layers are its own, unlocked, and no longer follow.
nodes = detachInstance(nodes, made.id);
assert.equal(nodes.find((n) => n.id === made.id).instanceOf, undefined);
assert.ok(nodes.filter((n) => n.parentId === made.id).every((n) => !n.locked && !n.fromComponent));

console.log("design components: all checks passed");
