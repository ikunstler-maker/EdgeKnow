// Obriy (company apps), run at the end of the "nodes" part: the owner adds an app in the
// browser, a member sees the tile but can't add or change apps, the tile opens a new tab
// safely, an outsider sees nothing, and the gallery is one tile per row on a phone.

import { APP, alice, alphaShort, bob, check, colleague, colleagueCookies, newPage, sql, until } from "./common.mjs";

export async function appsChecks() {
  const base = `${APP}/w/${alphaShort}/apps`;
  await alice.goto(base);
  await alice.locator("[data-app-add]").click();
  const form = alice.getByRole("dialog", { name: "Новий додаток" });
  await form.locator("[data-app-url]").fill("javascript:alert(1)");
  await form.locator("[data-app-save]").click();
  check("a javascript: link is refused", (await form.getByRole("alert").count()) === 1 && sql("select count(*) from public.service_objects where service = 'apps'") === "0");
  await form.locator("[data-app-url]").fill("https://crm.example.com/");
  await form.locator("[data-app-title]").fill("Team CRM");
  await form.locator("[data-app-category]").fill("Sales");
  await form.locator("[data-app-description]").fill("Clients and deals");
  await form.locator("[data-app-save]").click();
  check("the owner adds an app", await until(() => sql("select count(*) from public.service_objects where service = 'apps' and title = 'Team CRM'") === "1", 15000));
  check("…open to the whole workspace as viewers", sql("select workspace_role from public.service_objects where title = 'Team CRM'") === "viewer");

  await colleague.goto(base);
  const tile = colleague.locator('[data-app="Team CRM"]');
  await tile.waitFor({ timeout: 15000 });
  const link = tile.locator("a[target=_blank]");
  check("a member sees the tile, opening in a new tab safely", (await link.getAttribute("rel")) === "noopener noreferrer" && (await link.getAttribute("href")) === "https://crm.example.com/");
  check("…with no add button and no settings", (await colleague.locator("[data-app-add]").count()) === 0 && (await tile.locator("[data-app-settings]").count()) === 0);
  check("…filtered by its category", (await colleague.locator("[data-app-categories]").getByRole("link", { name: "Sales" }).count()) === 1);

  await bob.goto(base);
  check("an outsider sees no app", (await bob.locator("[data-app]").count()) === 0);

  const phone = await newPage(colleagueCookies);
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(base);
  await phone.locator("[data-app]").first().waitFor({ timeout: 15000 });
  const widths = await phone.evaluate(() => ({ tile: document.querySelector("[data-app]").getBoundingClientRect().width, page: innerWidth, scroll: document.documentElement.scrollWidth }));
  check("on a phone one tile fills the row, no sideways scroll", widths.tile > widths.page * 0.8 && widths.scroll <= widths.page, JSON.stringify(widths));
  await phone.context().close();
}
