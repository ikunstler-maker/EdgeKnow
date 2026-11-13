// Browser test, part "live": real-time co-editing of a presentation (phase 1).
// The workspace owner turns it on; two editors see each other and each other's changes at
// once; a viewer sees them too but cannot change the document through the channel; viewers'
// cursors only once an editor allows them; "Follow" takes your view to the other person's
// slide; one editor saves for everyone.
// Needs local Supabase with Realtime. Usage: node scripts/e2e/live.mjs status.json http://localhost:3000

import { createClient } from "@supabase/supabase-js";
import { APP, API, ANON, alice, aliceClient, alphaId, alphaShort, check, colleague, colleagueClient, finish, sql, until } from "./common.mjs";

const deckData = (id) => JSON.parse(sql(`select data::text from public.service_objects where id = '${id}'`));
const nodesOf = (id) => (deckData(id)?.slides ?? []).flatMap((s) => s.nodes ?? []);

// Without the switch nothing is live: no presence in the studio bar.
const made = await aliceClient.rpc("create_service_object", {
  ws: alphaId,
  target_service: "slides",
  new_kind: "deck",
  new_title: "Live deck",
  new_data: { version: 1, slides: [{ id: "s1", background: "#ffffff", nodes: [] }, { id: "s2", background: "#eeeeee", nodes: [] }] },
});
const deckId = made.data?.id;
check("a deck for the live test", Boolean(deckId), JSON.stringify(made.error ?? made.data));
const deckUrl = `${APP}/w/${alphaShort}/slides/${deckId}`;

// The owner turns co-editing on in the workspace settings.
await alice.goto(`${APP}/w/${alphaShort}/settings`);
const liveSwitch = alice.locator("[data-live-collab] input");
await liveSwitch.waitFor({ timeout: 20000 });
check("the switch is off by default", !(await liveSwitch.isChecked()));
await liveSwitch.check();
check("the owner turns co-editing on", await until(() => sql(`select live_collab from public.workspaces where id = '${alphaId}'`) === "t", 10000));
// Not the owner: no switch.
await colleague.goto(`${APP}/w/${alphaShort}/settings`);
await colleague.waitForTimeout(1500);
check("a member has no such switch", (await colleague.locator("[data-live-collab]").count()) === 0);

// Two editors in one deck see each other.
await alice.goto(deckUrl);
await colleague.goto(deckUrl);
const aliceSvg = alice.locator("[data-deck-canvas] svg");
await aliceSvg.waitFor({ timeout: 30000 });
await colleague.locator("[data-deck-canvas] svg").waitFor({ timeout: 30000 });
const seesOther = async (page) => (await page.locator("[data-live-peer]").count()) > 0;
let shown = false;
for (let i = 0; i < 60 && !shown; i++) {
  shown = (await seesOther(alice)) && (await seesOther(colleague));
  if (!shown) await alice.waitForTimeout(500);
}
check("two editors see each other in the studio bar", shown);

// A rectangle drawn by one shows at the other's at once, before any reload.
let box = await aliceSvg.boundingBox();
for (let i = 0; i < 20; i++) {
  await alice.waitForTimeout(250);
  const again = await aliceSvg.boundingBox();
  if (again && Math.abs(again.width - box.width) < 1 && Math.abs(again.y - box.y) < 1) break;
  box = again;
}
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
await alice.locator('[data-tool="RECTANGLE"]').click();
await alice.mouse.move(...at(0.1, 0.1));
await alice.mouse.down();
await alice.mouse.move(...at(0.3, 0.3), { steps: 5 });
await alice.mouse.up();
const colleagueRects = colleague.locator('[data-deck-canvas] [data-node="RECTANGLE"]');
const t0 = Date.now();
const arrived = await colleagueRects.first().waitFor({ timeout: 5000 }).then(() => true, () => false);
check("the other editor sees the new rectangle within a few seconds", arrived, `${Date.now() - t0} ms`);
// The cursor and the selection outline of the other person show on the same slide.
await alice.mouse.move(...at(0.6, 0.6), { steps: 3 });
check("…and the other person's cursor", await colleague.locator("[data-live-cursor]").first().waitFor({ timeout: 5000 }).then(() => true, () => false));
check("…with what they selected outlined", await colleague.locator("[data-live-selection]").first().waitFor({ timeout: 5000 }).then(() => true, () => false));

// Both change things at the same time: nothing is lost.
const colleagueSvg = colleague.locator("[data-deck-canvas] svg");
const cbox = await colleagueSvg.boundingBox();
const cat = (fx, fy) => [cbox.x + cbox.width * fx, cbox.y + cbox.height * fy];
await colleague.locator('[data-tool="ELLIPSE"]').click();
await colleague.mouse.move(...cat(0.5, 0.5));
await colleague.mouse.down();
await colleague.mouse.move(...cat(0.7, 0.7), { steps: 4 });
await colleague.mouse.up();
await alice.locator('[data-tool="RECTANGLE"]').click();
await alice.mouse.move(...at(0.7, 0.1));
await alice.mouse.down();
await alice.mouse.move(...at(0.9, 0.3), { steps: 4 });
await alice.mouse.up();
const both = async (page) => (await page.locator('[data-deck-canvas] [data-node="RECTANGLE"]').count()) === 2 && (await page.locator('[data-deck-canvas] [data-node="ELLIPSE"]').count()) === 1;
check("changes made at the same time reach both", await (async () => {
  for (let i = 0; i < 30; i++) {
    if ((await both(alice)) && (await both(colleague))) return true;
    await alice.waitForTimeout(300);
  }
  return false;
})());
check("…and one of them saves it all", await until(() => nodesOf(deckId).length === 3, 15000), JSON.stringify(nodesOf(deckId).map((n) => n.type)));

// Undo takes back only one's own change.
await colleague.locator("[data-deck-canvas]").focus();
await colleague.keyboard.press("Control+z");
check("undo takes back only one's own change", await until(() => {
  const types = nodesOf(deckId).map((n) => n.type).sort().join(",");
  return types === "RECTANGLE,RECTANGLE";
}, 15000), JSON.stringify(nodesOf(deckId).map((n) => n.type)));

// Follow: the colleague follows Alice; Alice goes to slide 2; the colleague's view goes too.
await colleague.locator("[data-live-peer]").first().click();
await colleague.locator("[data-live-following]").waitFor({ timeout: 5000 });
await alice.locator('[data-slide-thumb="2"]').click();
await alice.mouse.move(...at(0.5, 0.5), { steps: 2 });
check("following someone shows their slide", await colleague.locator('[data-slide-thumb="2"][aria-current="true"], [data-slide-thumb="2"] [aria-current="true"]').first().waitFor({ timeout: 6000 }).then(() => true, async () => (await colleague.locator("[data-deck-canvas] svg").getAttribute("aria-label"))?.includes("2") ?? false));
check("…and the person sees who follows them", await alice.locator("[data-live-followers]").waitFor({ timeout: 8000 }).then(() => true, () => false));
await colleague.locator("[data-live-unfollow]").click();
check("…until one stops following", (await colleague.locator("[data-live-following]").count()) === 0);

// A viewer: the colleague can only view a second deck.
const viewDeck = (await aliceClient.rpc("create_service_object", { ws: alphaId, target_service: "slides", new_kind: "deck", new_title: "Live view", new_data: { version: 1, slides: [{ id: "v1", background: "#ffffff", nodes: [] }] } })).data?.id;
await aliceClient.rpc("set_service_object_workspace_role", { target_object: viewDeck, new_role: "viewer" });
await alice.goto(`${APP}/w/${alphaShort}/slides/${viewDeck}`);
await colleague.goto(`${APP}/w/${alphaShort}/slides/${viewDeck}`);
await alice.locator("[data-deck-canvas] svg").waitFor({ timeout: 30000 });
await colleague.locator("[data-deck-canvas] svg").waitFor({ timeout: 30000 });
await until(() => false, 3000);
let vbox = await alice.locator("[data-deck-canvas] svg").boundingBox();
const vat = (fx, fy) => [vbox.x + vbox.width * fx, vbox.y + vbox.height * fy];
await alice.locator('[data-tool="RECTANGLE"]').click();
await alice.mouse.move(...vat(0.2, 0.2));
await alice.mouse.down();
await alice.mouse.move(...vat(0.4, 0.4), { steps: 4 });
await alice.mouse.up();
check("a viewer sees an editor's change live", await colleague.locator('[data-deck-canvas] [data-node="RECTANGLE"]').first().waitFor({ timeout: 8000 }).then(() => true, () => false));
// The viewer's cursor does not reach the editor while viewers' cursors are off.
const cbox2 = await colleague.locator("[data-deck-canvas] svg").boundingBox();
await colleague.mouse.move(cbox2.x + cbox2.width * 0.5, cbox2.y + cbox2.height * 0.5, { steps: 4 });
await alice.waitForTimeout(1500);
check("viewers' cursors are off by default", (await alice.locator("[data-live-cursor]").count()) === 0);
check("…the setting is off in the database", sql(`select live_viewer_cursors from public.service_objects where id = '${viewDeck}'`) === "f");
// The editor allows them.
await alice.locator("[data-studio-more]").click();
await alice.locator('[data-live-viewer-cursors="off"]').click();
check("an editor shows viewers' cursors", await until(() => sql(`select live_viewer_cursors from public.service_objects where id = '${viewDeck}'`) === "t", 8000));
let viewerCursor = false;
for (let i = 0; i < 20 && !viewerCursor; i++) {
  await colleague.mouse.move(cbox2.x + cbox2.width * (0.3 + i * 0.01), cbox2.y + cbox2.height * 0.5);
  await colleague.waitForTimeout(400);
  viewerCursor = (await alice.locator("[data-live-cursor]").count()) > 0;
}
check("…then the viewer's cursor shows", viewerCursor);

// Straight through the channel: a viewer's change is refused by the database.
{
  const { data } = await colleagueClient.auth.getSession();
  const rt = createClient(API, ANON, { accessToken: async () => data.session.access_token });
  await rt.realtime.setAuth(data.session.access_token);
  const ch = rt.channel(`live:${viewDeck}:doc`, { config: { private: true, broadcast: { ack: true } } });
  const joined = await new Promise((resolve) => ch.subscribe((s) => (s === "SUBSCRIBED" ? resolve(true) : s === "CHANNEL_ERROR" ? resolve(false) : null)));
  const sent = joined ? await ch.send({ type: "broadcast", event: "u", payload: { d: "AAA=" } }) : "not joined";
  check("a viewer may read the channel but not send a change", joined && sent !== "ok", `joined ${joined}, sent ${sent}`);
  await rt.removeAllChannels();
  // Someone without access to the document cannot even join.
  const outsider = createClient(API, ANON, { accessToken: async () => data.session.access_token });
  const hidden = (await aliceClient.rpc("create_service_object", { ws: alphaId, target_service: "slides", new_kind: "deck", new_title: "Private live", new_data: { version: 1, slides: [] } })).data?.id;
  await aliceClient.rpc("set_service_object_workspace_role", { target_object: hidden, new_role: null });
  await outsider.realtime.setAuth(data.session.access_token);
  const ch2 = outsider.channel(`live:${hidden}:doc`, { config: { private: true } });
  const joined2 = await new Promise((resolve) => ch2.subscribe((s) => (s === "SUBSCRIBED" ? resolve(true) : s === "CHANNEL_ERROR" ? resolve(false) : null)));
  check("without access to the document one cannot join its channel", joined2 === false);
  await outsider.removeAllChannels();
}

// "Design" files are live the same way.
{
  const designId = (await aliceClient.rpc("create_service_object", { ws: alphaId, target_service: "boards", new_kind: "design", new_title: "Live design", new_data: { version: 1, kind: "design", pages: [{ id: "p1", name: "Page 1", background: "#1e1f24", nodes: [], flows: [] }] } })).data?.id;
  const url = `${APP}/w/${alphaShort}/boards/${designId}`;
  await alice.goto(url);
  await colleague.goto(url);
  const canvas = alice.locator("[data-design-canvas] svg");
  await canvas.waitFor({ timeout: 30000 });
  await colleague.locator("[data-design-canvas] svg").waitFor({ timeout: 30000 });
  let met = false;
  for (let i = 0; i < 40 && !met; i++) {
    met = (await alice.locator("[data-live-peer]").count()) > 0 && (await colleague.locator("[data-live-peer]").count()) > 0;
    if (!met) await alice.waitForTimeout(500);
  }
  check("Design: two editors see each other", met);
  const b = await canvas.boundingBox();
  await alice.locator('[data-tool="RECTANGLE"]').click();
  await alice.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3);
  await alice.mouse.down();
  await alice.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5, { steps: 4 });
  await alice.mouse.up();
  check("Design: the other editor sees a new layer at once", await colleague.locator('[data-design-canvas] [data-node="RECTANGLE"]').first().waitFor({ timeout: 6000 }).then(() => true, () => false));
  check("Design: saved once for both", await until(() => (JSON.parse(sql(`select data::text from public.service_objects where id = '${designId}'`)).pages?.[0]?.nodes ?? []).length === 1, 15000));
}

// Idea boards (phase 2): merged by the canvas library's own element versions.
const untilAsync = async (condition, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
};
{
  const boardId = (await aliceClient.rpc("create_service_object", { ws: alphaId, target_service: "boards", new_kind: "board", new_title: "Live ideas", new_data: { elements: [], appState: {}, files: {} } })).data?.id;
  check("an idea board for the live test", Boolean(boardId));
  const url = `${APP}/w/${alphaShort}/boards/${boardId}`;
  const stickiesSaved = () => sql(`select count(*) from public.service_objects o, jsonb_array_elements(o.data -> 'elements') e where o.id = '${boardId}' and e -> 'customData' ->> 'sticky' = 'true' and coalesce((e ->> 'isDeleted')::boolean, false) = false`);
  const shownStickies = async (page) => Number(await page.locator("[data-board-canvas]").getAttribute("data-board-stickies"));
  for (const page of [alice, colleague]) {
    await page.goto(url);
    await page.locator("[data-board-canvas] canvas").first().waitFor({ timeout: 30000 });
    // An empty board offers templates: start empty.
    const chooser = page.locator("[data-template-chooser] button").last();
    if (await chooser.isVisible().catch(() => false)) await chooser.click();
  }
  let met = false;
  for (let i = 0; i < 40 && !met; i++) {
    met = (await alice.locator("[data-live-peer]").count()) > 0 && (await colleague.locator("[data-live-peer]").count()) > 0;
    if (!met) await alice.waitForTimeout(500);
  }
  check("Idea board: two editors see each other", met);
  await alice.waitForTimeout(1500);

  await alice.locator('[data-sticky-color="yellow"]').click();
  check("Idea board: a sticky note added by one shows at the other's at once", await untilAsync(async () => (await shownStickies(colleague)) === 1, 6000), String(await shownStickies(colleague)));

  // Both add one at the same time: nothing is lost, one of them saves it all.
  await Promise.all([colleague.locator('[data-sticky-color="green"]').click(), alice.locator('[data-sticky-color="blue"]').click()]);
  check("Idea board: notes added at the same time reach both", await untilAsync(async () => (await shownStickies(alice)) === 3 && (await shownStickies(colleague)) === 3, 8000), `${await shownStickies(alice)} ${await shownStickies(colleague)}`);
  check("Idea board: …and one of them saves it all", await until(() => stickiesSaved() === "3", 15000), stickiesSaved());

  // The other person's cursor.
  const area = alice.locator("[data-board-canvas] .excalidraw__canvas.interactive");
  const box = await area.boundingBox();
  for (let i = 0; i < 6; i++) await alice.mouse.move(box.x + box.width * (0.35 + i * 0.05), box.y + box.height * 0.6, { steps: 2 });
  check("Idea board: the other person's cursor shows", await colleague.locator("[data-live-cursor]").first().waitFor({ timeout: 6000 }).then(() => true, () => false));

  // Undo takes back only one's own note.
  const cbox = await colleague.locator("[data-board-canvas] .excalidraw__canvas.interactive").boundingBox();
  await colleague.mouse.click(cbox.x + cbox.width * 0.05, cbox.y + cbox.height * 0.95);
  await colleague.keyboard.press("Control+z");
  check("Idea board: undo takes back only one's own note", await untilAsync(async () => stickiesSaved() === "2" && (await shownStickies(alice)) === 2, 15000), `${stickiesSaved()} ${await shownStickies(alice)}`);

  // Follow.
  await colleague.locator("[data-live-peer]").first().click();
  await colleague.locator("[data-live-following]").waitFor({ timeout: 5000 });
  await alice.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 2 });
  check("Idea board: the person sees who follows them", await alice.locator("[data-live-followers]").waitFor({ timeout: 8000 }).then(() => true, () => false));
  await colleague.locator("[data-live-unfollow]").click();
}

// Mind maps of Nodo (phase 3, CORE-4): the same channels, merged with Yjs like presentations.
{
  const mapId = (await aliceClient.rpc("create_service_object", { ws: alphaId, target_service: "nodes", new_kind: "mindmap", new_title: "Live map", new_data: { nodes: [{ id: "root1", parent: null, text: "Root" }] } })).data?.id;
  check("a mind map for the live test", Boolean(mapId));
  const url = `${APP}/w/${alphaShort}/nodes/${mapId}`;
  await alice.goto(url);
  await colleague.goto(url);
  await alice.locator("[data-mind-map]").waitFor({ timeout: 30000 });
  await colleague.locator("[data-mind-map]").waitFor({ timeout: 30000 });
  let met = false;
  for (let i = 0; i < 40 && !met; i++) {
    met = (await alice.locator("[data-live-peer]").count()) > 0 && (await colleague.locator("[data-live-peer]").count()) > 0;
    if (!met) await alice.waitForTimeout(500);
  }
  check("Map: two editors see each other", met);
  await alice.waitForTimeout(1500);
  const shown = async (page) => page.locator("[data-map-node]").count();
  await alice.locator("[data-mind-map]").focus();
  await alice.keyboard.press("F2");
  await alice.keyboard.press("End");
  await alice.keyboard.press("Tab");
  await alice.keyboard.type("From Alice");
  await alice.keyboard.press("Escape");
  check("Map: a node added by one shows at the other's at once", await untilAsync(async () => (await colleague.locator('[data-map-node="From Alice"]').count()) === 1, 8000));
  const savedNodes = () => JSON.parse(sql(`select data::text from public.service_objects where id = '${mapId}'`)).nodes?.length ?? 0;
  check("Map: one of them saves it", await until(() => savedNodes() === 2, 15000), String(savedNodes()));
  const area = await alice.locator("[data-mind-map]").boundingBox();
  for (let i = 0; i < 6; i++) await alice.mouse.move(area.x + area.width * (0.3 + i * 0.05), area.y + area.height * 0.7, { steps: 2 });
  check("Map: the other person's cursor shows", await colleague.locator("[data-live-cursor]").first().waitFor({ timeout: 6000 }).then(() => true, () => false));
  check("Map: both see the same nodes", (await shown(alice)) === (await shown(colleague)));
}

// Switched off: the studio bar shows no one, saving goes on as before.
await aliceClient.rpc("set_live_collab", { ws: alphaId, enabled: false });
await alice.goto(deckUrl);
await alice.locator("[data-deck-canvas] svg").waitFor({ timeout: 30000 });
await alice.waitForTimeout(3000);
check("switched off: no one shows in the studio bar", (await alice.locator("[data-live-peer]").count()) === 0);

await finish("live");
