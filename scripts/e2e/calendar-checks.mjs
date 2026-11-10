// Doba (company calendar), run at the end of the "nodes" part: an event made in the
// browser, a request to join and its approval, a private event that others see only
// as "busy", an outsider, the week on a phone.

import { APP, alice, aliceClient, alphaId, alphaShort, bob, check, colleague, colleagueClient, colleagueCookies, colleagueId, newPage, sql, until } from "./common.mjs";

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

// Time off (phase 1b): policies from the templates, a yearly accrual pressed twice, a
// request, its approval, the absence on the calendar, cancelling — all in the browser.
export async function timeOffChecks() {
  const base = `${APP}/w/${alphaShort}/calendar/time-off`;
  const one = (query) => sql(query);
  const year = new Date().getFullYear();

  // The owner starts from the four templates, sets the vacation norm and accrues it.
  await alice.goto(`${base}?tab=settings`);
  await alice.locator("[data-seed-policies]").click({ timeout: 15000 });
  await alice.locator('[data-policy="Відпустка"]').waitFor({ timeout: 15000 }).catch(() => {});
  check("the four starting policies are made with 0 days", one(`select count(*) || ' ' || sum(days_per_year) from public.leave_policies where workspace_id = '${alphaId}'`) === "4 0.0");
  await alice.locator('[data-policy="Відпустка"] [data-edit-policy]').click();
  await alice.locator('[data-policy-form] [data-policy-field="days_per_year"]').fill("10");
  await alice.locator("[data-save-policy]").click();
  const vacation = one(`select id from public.leave_policies where workspace_id = '${alphaId}' and kind = 'vacation'`);
  check("the owner sets ten days of vacation", await until(() => one(`select days_per_year from public.leave_policies where id = '${vacation}'`) === "10.0", 15000));
  await alice.locator('[data-policy="Відпустка"] [data-accrue]').click({ timeout: 15000 });
  const members = one(`select count(*) from public.workspace_members where workspace_id = '${alphaId}' and status = 'active' and role <> 'guest'`);
  const accrued = () => one(`select count(*) from public.leave_balances where policy_id = '${vacation}' and year = ${year} and kind = 'accrual'`);
  check("“accrue for the year” gives everyone the norm", await until(() => accrued() === members, 15000), `${accrued()} of ${members}`);
  await alice.locator('[data-policy="Відпустка"] [data-accrue]').click();
  await alice.locator("[data-leave-message]").waitFor({ timeout: 15000 }).catch(() => {});
  await alice.waitForTimeout(800);
  check("…and pressed again doubles nobody", accrued() === members, accrued());
  // The request below may fall into the next year at the very end of December: that year gets its norm too.
  await aliceClient.rpc("accrue_leave_year", { ws: alphaId, target_policy: vacation, target_year: year + 1 });

  // The colleague asks for a Monday at least a week ahead.
  const ahead = new Date(Date.now() + 7 * 864e5);
  ahead.setUTCDate(ahead.getUTCDate() + ((8 - ahead.getUTCDay()) % 7));
  const day = ahead.toISOString().slice(0, 10);
  await colleague.goto(base);
  await colleague.locator('[data-leave-balance="Відпустка"] [data-leave-left]').waitFor({ timeout: 15000 });
  check("a member sees their own balance", (await colleague.locator('[data-leave-balance="Відпустка"] [data-leave-left]').innerText()).includes("10"));
  const ask = async (policy) => {
    await colleague.locator("[data-new-leave]").click();
    const form = colleague.locator("[data-leave-form]");
    await form.locator('[data-leave-field="policy"]').selectOption({ label: policy });
    await form.locator('[data-leave-field="from"]').fill(day);
    await form.locator('[data-leave-field="to"]').fill(day);
    await form.locator("[data-send-leave]").click();
  };
  await ask("Відпустка");
  const mine = () => one(`select status || ' ' || days from public.leave_requests where workspace_id = '${alphaId}' and user_id = '${colleagueId}' and policy_id = '${vacation}' order by created_at desc limit 1`);
  check("a request for a day waits for approval", await until(() => mine() === "pending 1.0", 15000), mine());
  await colleague.locator("[data-leave-form]").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await ask("Віддалена робота");
  await colleague.locator("[data-leave-error]").waitFor({ timeout: 15000 }).catch(() => {});
  check("a second request for the same day is refused", (await colleague.locator("[data-leave-error]").count()) === 1 && one(`select count(*) from public.leave_requests where user_id = '${colleagueId}'`) === "1");
  await colleague.keyboard.press("Escape");

  // The owner (nobody leads the colleague's unit) is told and approves.
  check("who decides is told", one(`select count(*) from public.notifications n join public.leave_requests r on r.id = n.leave_request_id where n.kind = 'leave_request' and r.user_id = '${colleagueId}'`) === "1");
  await alice.goto(`${base}?tab=inbox`);
  await alice.locator("[data-inbox-request] [data-approve-leave]").first().click({ timeout: 15000 });
  check("the owner approves it", await until(() => mine() === "approved 1.0", 15000), mine());
  const requestId = one(`select id from public.leave_requests where user_id = '${colleagueId}' and policy_id = '${vacation}'`);
  const self = await colleagueClient.rpc("decide_leave_request", { target: requestId, approve: true, note: "" });
  check("nobody decides on their own request", self.data?.ok === false, JSON.stringify(self.data));

  // The absence shows on the calendar and in the team list; an outsider gets nothing.
  await alice.goto(`${APP}/w/${alphaShort}/calendar?view=week&date=${day}`);
  await alice.locator("[data-week] [data-absence]").first().waitFor({ timeout: 15000 }).catch(() => {});
  check("an approved absence shows on the calendar", (await alice.locator("[data-week] [data-absence]").count()) >= 1);
  await bob.goto(`${base}?tab=team`);
  const outsider = await bob.locator("body").innerText();
  check("an outsider sees no absences", (await bob.locator("[data-absence]").count()) === 0 && !outsider.includes("colleague@alpha.test"), bob.url());

  // A phone: no sideways scroll.
  const phone = await newPage(colleagueCookies);
  await phone.setViewportSize({ width: 390, height: 780 });
  await phone.goto(base);
  await phone.locator("[data-leave-mine]").waitFor({ timeout: 15000 });
  const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("the time-off page fits a phone", sideways <= 0, `overflow ${sideways}px`);
  await phone.context().close();

  // The colleague cancels before the day comes: the day is free again.
  await colleague.goto(base);
  await colleague.locator("[data-leave-request] [data-cancel-leave]").first().click({ timeout: 15000 });
  check("an approved request cancelled before it starts gives the day back", await until(() => mine() === "cancelled 1.0", 15000), mine());
  const numbers = (await colleagueClient.rpc("my_leave", { ws: alphaId, target_year: Number(day.slice(0, 4)) })).data?.policies?.find((p) => p.id === vacation);
  check("…the balance is whole again", Number(numbers?.used) === 0 && Number(numbers?.pending) === 0, JSON.stringify(numbers));
}

// Repeating events (phase 2a): a series made in the browser, one day changed, one
// cancelled, "this and the following", free/busy that follows, a reminder in the bell.
export async function repeatChecks() {
  const base = `${APP}/w/${alphaShort}/calendar`;
  const one = (query) => sql(query);
  const dayAt = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

  // A weekly series, four times, from the form.
  await alice.goto(`${base}?view=list`);
  await alice.locator("[data-new-event]").click();
  const form = alice.locator("[data-event-form]");
  await form.locator('[data-event-field="title"]').fill("Standup");
  await form.locator('[data-event-field="repeat"]').selectOption("weekly");
  await form.locator('[data-event-field="repeat_end"]').selectOption("count");
  await form.locator('[data-event-field="repeat_count"]').fill("4");
  await form.locator("[data-save-event]").click();
  const standup = () => one(`select repeat_freq || ' ' || repeat_count || ' ' || (repeat_until is not null) || ' ' || coalesce(reminder_minutes::text, '-') from public.calendar_events where title = 'Standup'`);
  check("a weekly series for four times is saved with its last day worked out", await until(() => standup() === "weekly 4 true 10", 15000), standup());
  await alice.locator('[data-list] [data-event="Standup"]').first().waitFor({ timeout: 15000 }).catch(() => {});
  check("…and shows as four days in the list", (await alice.locator('[data-list] [data-event="Standup"]').count()) === 4);

  // A daily series of five days from tomorrow, with the colleague.
  const first = dayAt(1);
  const { data: made } = await aliceClient.rpc("create_calendar_event", {
    ws: alphaId,
    fields: { title: "Daily sync", description: "", location: "", meeting_url: "", starts_at: `${first}T09:00:00Z`, ends_at: `${first}T09:30:00Z`, all_day: false, time_zone: "UTC", visibility: "open", repeat: { freq: "daily", count: 5 } },
    people: [colleagueId],
  });
  const series = made?.id;
  check("(setup) a daily series", made?.ok === true, JSON.stringify(made));
  const openDay = async (day, title = "Daily sync") => {
    await alice.goto(`${base}?view=week&date=${day}`);
    await alice.locator(`[data-day-column="${day}"] [data-event="${title}"]`).click({ timeout: 15000 });
    await alice.locator("[data-event-title]").waitFor({ timeout: 15000 });
  };
  const busyDays = async () => {
    const { data } = await colleagueClient.rpc("calendar_busy", { ws: alphaId, people: [(await aliceClient.auth.getUser()).data.user.id], range_from: `${first}T00:00:00Z`, range_to: `${dayAt(6)}T00:00:00Z` });
    return (data ?? []).filter((slot) => slot.starts_at.slice(11, 16) === "09:00" || slot.starts_at.slice(11, 16) === "14:00").map((slot) => `${slot.starts_at.slice(0, 10)} ${slot.starts_at.slice(11, 16)}`);
  };

  // "Only this event": the second day gets its own title.
  await openDay(dayAt(2));
  await alice.locator("[data-edit-event]").click();
  await alice.locator('[data-series-scope] [data-scope="one"]').click();
  await alice.locator('[data-event-form][data-event-scope="one"] [data-event-field="title"]').fill("Daily sync (special)");
  await alice.locator("[data-save-event]").click();
  const special = () => one(`select title from public.calendar_event_exceptions where event_id = '${series}' and occurrence_date = '${dayAt(2)}'`);
  check("“only this event” changes one day of the series", await until(() => special() === "Daily sync (special)", 15000), special());
  check("…and leaves the series' own title", one(`select title from public.calendar_events where id = '${series}'`) === "Daily sync");

  // One day cancelled: gone from the grid, and the time is free for others.
  await openDay(dayAt(3));
  await alice.locator("[data-cancel-event]").click();
  await alice.locator('[data-series-scope] [data-scope="one"]').click();
  const cancelledDay = () => one(`select cancelled::text from public.calendar_event_exceptions where event_id = '${series}' and occurrence_date = '${dayAt(3)}'`);
  check("one day of the series is cancelled", await until(() => cancelledDay() === "true", 15000), cancelledDay());
  const busyAfterCancel = await busyDays();
  check("…and free/busy no longer has it", busyAfterCancel.length === 4 && !busyAfterCancel.some((d) => d.startsWith(dayAt(3))), JSON.stringify(busyAfterCancel));

  // "This and the following" from the fourth day: 14:00 from then on.
  await openDay(dayAt(4));
  await alice.locator("[data-edit-event]").click();
  await alice.locator('[data-series-scope] [data-scope="following"]').click();
  const following = alice.locator('[data-event-form][data-event-scope="following"]');
  await following.locator('[data-event-field="title"]').fill("Late sync");
  await following.locator('[data-event-field="start"]').fill(`${dayAt(4)}T14:00`);
  await alice.locator("[data-save-event]").click();
  const late = () => one(`select repeat_count || ' ' || repeat_until || ' ' || (select count(*) from public.calendar_event_attendees a where a.event_id = e.id) from public.calendar_events e where title = 'Late sync'`);
  check("“this and the following” starts a new series with what is left and the same people", await until(() => late() === `2 ${dayAt(5)} 2`, 15000), late());
  check("…and the old series ends the day before", one(`select repeat_until::text from public.calendar_events where id = '${series}'`) === dayAt(3));
  const busyAfterSplit = await busyDays();
  check("…free/busy follows: two days at 09:00, two at 14:00, the cancelled one free", JSON.stringify(busyAfterSplit) === JSON.stringify([`${dayAt(1)} 09:00`, `${dayAt(2)} 09:00`, `${dayAt(4)} 14:00`, `${dayAt(5)} 14:00`]), JSON.stringify(busyAfterSplit));

  // A reminder: an event in five minutes reaches the invited colleague's bell.
  const soon = new Date(Date.now() + 5 * 60000).toISOString();
  await aliceClient.rpc("create_calendar_event", {
    ws: alphaId,
    fields: { title: "Starting soon", description: "", location: "", meeting_url: "", starts_at: soon, ends_at: new Date(Date.now() + 35 * 60000).toISOString(), all_day: false, time_zone: "UTC", visibility: "open", reminder_minutes: 10 },
    people: [colleagueId],
  });
  await colleague.goto(`${base}?view=list`);
  const reminded = () => one(`select count(*) from public.notifications n join public.calendar_events e on e.id = n.event_id where n.kind = 'event_reminder' and n.user_id = '${colleagueId}' and e.title = 'Starting soon'`);
  check("a reminder reaches the invited person's bell, once", (await until(() => reminded() === "1", 40000)) && reminded() === "1", reminded());
}
