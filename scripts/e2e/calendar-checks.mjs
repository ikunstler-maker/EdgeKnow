// Doba (company calendar), run at the end of the "nodes" part: an event made in the
// browser, a request to join and its approval, a private event that others see only
// as "busy", an outsider, the week on a phone.

import { APP, alice, aliceClient, alphaId, alphaShort, bob, check, colleague, colleagueCookies, colleagueId, newPage, sql, until } from "./common.mjs";

export async function calendarChecks() {
  const base = `${APP}/w/${alphaShort}/calendar`;
  const one = (query) => sql(query);

  // The start page opens the calendar; a new event from the button.
  await alice.goto(`${APP}/w/${alphaShort}`);
  await alice.locator('[data-service="calendar"]').waitFor({ timeout: 15000 });
  check("the start page has the calendar working", (await alice.locator('[data-service="calendar"]', { hasText: "Скоро" }).count()) === 0);
  await alice.goto(`${base}?view=list`);
  await alice.locator("[data-new-event]").click();
  const form = alice.locator("[data-event-form]");
  await form.locator('[data-event-field="title"]').fill("Sprint review");
  await form.locator('[data-event-field="visibility"]').selectOption("request");
  await form.locator('[data-event-field="link"]').fill("https://meet.example.test/sprint");
  await form.locator("[data-save-event]").click();
  await alice.locator('[data-list] [data-event="Sprint review"]').waitFor({ timeout: 15000 }).catch(() => {});
  const eventId = one("select id from public.calendar_events where title = 'Sprint review'");
  check("an event made in the browser is saved and listed", /^[0-9a-f-]{36}$/.test(eventId) && (await alice.locator('[data-list] [data-event="Sprint review"]').count()) === 1, eventId);
  check("…its organizer takes part in it", one(`select status from public.calendar_event_attendees where event_id = '${eventId}'`) === "accepted");

  // A link that isn't https never saves.
  await alice.locator("[data-new-event]").click();
  await form.locator('[data-event-field="title"]').fill("Bad link");
  await form.locator('[data-event-field="link"]').fill("http://plain.example.test");
  check("a link without https can't be saved", await form.locator("[data-save-event]").isDisabled());
  await alice.keyboard.press("Escape");

  // The colleague sees it, asks to join; the organizer approves.
  await colleague.goto(`${base}?view=list`);
  await colleague.locator('[data-list] [data-event="Sprint review"]').click({ timeout: 15000 });
  await colleague.locator("[data-ask-to-join]").click({ timeout: 15000 });
  const requested = await until(() => one(`select status from public.calendar_event_attendees where event_id = '${eventId}' and user_id = '${colleagueId}'`) === "requested", 15000);
  check("a colleague asks to join a “request” event", requested);
  check("…and the organizer is told", one(`select count(*) from public.notifications where kind = 'event_request' and event_id = '${eventId}'`) === "1");
  await alice.goto(`${base}?view=list&event=${eventId}`);
  await alice.locator("[data-requests] [data-approve]").first().click({ timeout: 15000 });
  const accepted = await until(() => one(`select status from public.calendar_event_attendees where event_id = '${eventId}' and user_id = '${colleagueId}'`) === "accepted", 15000);
  check("the organizer lets them in", accepted);

  // A private event tomorrow at 10:00 UTC: the colleague sees no title, only that Alice is busy.
  const day = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: made } = await aliceClient.rpc("create_calendar_event", {
    ws: alphaId,
    fields: { title: "Salary talk", description: "", location: "", meeting_url: "", starts_at: `${day}T10:00:00Z`, ends_at: `${day}T11:00:00Z`, all_day: false, time_zone: "UTC", visibility: "private" },
    people: [],
  });
  check("a private event is made", made?.ok === true, JSON.stringify(made));
  await colleague.goto(`${base}?view=week&date=${day}`);
  await colleague.locator("[data-week]").waitFor({ timeout: 15000 });
  const picker = colleague.locator('[data-people-picker="Доступність"]');
  await picker.locator("input").fill("alice");
  await picker.locator("[data-person-option]").first().click({ timeout: 15000 });
  await colleague.locator("[data-week] [data-busy]").first().waitFor({ timeout: 15000 }).catch(() => {});
  const body = await colleague.locator("body").innerText();
  check("a hidden event shows others only “busy”, never its title", (await colleague.locator("[data-week] [data-busy]").count()) >= 1 && !body.includes("Salary talk"));
  const peek = await colleague.request.get(`${base}?event=${made?.id}`);
  check("…and can't be opened by its address", !(await peek.text()).includes("Salary talk"));

  // An outsider gets nothing of the workspace's calendar.
  await bob.goto(`${base}?view=list`);
  check("an outsider sees no events", !(await bob.locator("body").innerText()).includes("Sprint review"), bob.url());

  // A phone: the week shows one day and the page doesn't scroll sideways.
  const phone = await newPage(colleagueCookies);
  await phone.setViewportSize({ width: 390, height: 780 });
  await phone.goto(`${base}?view=week&date=${day}`);
  await phone.locator('[data-week][data-week-days="1"]').waitFor({ timeout: 15000 }).catch(() => {});
  const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("on a phone the week is one day, with no sideways scroll", (await phone.locator('[data-week][data-week-days="1"]').count()) === 1 && sideways <= 0, `overflow ${sideways}px`);
  await phone.locator('[data-calendar-view="month"]').click();
  await phone.locator("[data-month]").waitFor({ timeout: 15000 });
  const monthSideways = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("…and so is the month", monthSideways <= 0, `overflow ${monthSideways}px`);
  await phone.context().close();

  // Cancelling: gone for the colleague, told to them, restorable by the organizer.
  await alice.goto(`${base}?view=list&event=${eventId}`);
  await alice.locator("[data-cancel-event]").click({ timeout: 15000 });
  const cancelled = await until(() => one(`select (deleted_at is not null)::text from public.calendar_events where id = '${eventId}'`) === "true", 15000);
  await colleague.goto(`${base}?view=list`);
  await colleague.locator("[data-list]").waitFor({ timeout: 15000 });
  check("a cancelled event leaves the colleague's calendar", cancelled && (await colleague.locator('[data-list] [data-event="Sprint review"]').count()) === 0);
  check("…they are told", one(`select count(*) from public.notifications where kind = 'event_change' and event_id = '${eventId}' and user_id = '${colleagueId}'`) === "1");
  await alice.locator("[data-cancelled] button").first().click({ timeout: 15000 });
  check("…and the organizer brings it back", await until(() => one(`select (deleted_at is null)::text from public.calendar_events where id = '${eventId}'`) === "true", 15000));
}
