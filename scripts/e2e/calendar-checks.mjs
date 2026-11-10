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

// Phase 2b: Rukh due dates on the calendar (never another person's private task, at most
// three cards a day), a unit invited to an event, events in search and as a wiki chip.
export async function linkChecks() {
  const base = `${APP}/w/${alphaShort}/calendar`;
  const one = (query) => sql(query);
  const day = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);

  // Five open tasks due on one day (one is the colleague's) and Alice's private one.
  const { data: project } = await aliceClient.rpc("create_task_project", { ws: alphaId, new_name: "Calendar", new_key: "CAL", new_icon: null, status_names: null });
  for (let i = 1; i <= 5; i++) {
    await aliceClient.rpc("create_task", { target_project: project.id, fields: { title: `Due task ${i}`, due_date: day, ...(i === 1 ? { assignee_id: colleagueId } : {}) } });
  }
  await aliceClient.rpc("create_task", { target_project: project.id, fields: { title: "Alice private deadline", due_date: day, private: true } });
  check("(setup) six tasks due on one day", one(`select count(*) from public.tasks where project_id = '${project.id}' and due_date = '${day}'`) === "6");

  await colleague.goto(`${base}?view=week&date=${day}`);
  const cell = colleague.locator(`[data-all-day="${day}"]`);
  await cell.locator("[data-calendar-task]").first().waitFor({ timeout: 15000 }).catch(() => {});
  check("by default the calendar shows my tasks only", (await cell.locator("[data-calendar-task]").count()) === 1 && (await cell.locator('[data-calendar-task="CAL-1"]').count()) === 1);
  await colleague.locator("[data-task-mode]").selectOption("all");
  await cell.locator("[data-more-tasks]").waitFor({ timeout: 15000 }).catch(() => {});
  check("“all I can see”: three cards and a counter for the rest", (await cell.locator("[data-calendar-task]").count()) === 3 && (await cell.locator("[data-more-tasks]").innerText()).includes("+2"), await cell.innerText().catch(() => ""));
  await cell.locator("[data-more-tasks]").click();
  check("…the counter opens them all", (await cell.locator("[data-calendar-task]").count()) === 5);
  check("another person's private task is nowhere on the calendar", !(await colleague.locator("body").innerText()).includes("Alice private deadline"));
  await alice.goto(`${base}?view=week&date=${day}`);
  await alice.locator("[data-task-mode]").selectOption("all");
  await alice.locator(`[data-all-day="${day}"] [data-more-tasks]`).click({ timeout: 15000 });
  check("…while its own person sees it", await until(async () => (await alice.locator(`[data-all-day="${day}"]`).innerText()).includes("Alice private deadline"), 15000));
  const phone = await newPage(colleagueCookies);
  await phone.setViewportSize({ width: 390, height: 780 });
  await phone.goto(`${base}?view=week&date=${day}`);
  await phone.locator("[data-week]").waitFor({ timeout: 15000 });
  const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("a day full of tasks still fits a phone", sideways <= 0, `overflow ${sideways}px`);
  await phone.context().close();

  // A unit invited to a new event from the form.
  const { data: unit } = await aliceClient.rpc("create_workspace_group", { ws: alphaId, new_name: "Calendar crew", parent: null });
  await aliceClient.rpc("set_workspace_group_member", { ws: alphaId, target_group: unit.id, member: colleagueId, included: true });
  await alice.goto(`${base}?view=list`);
  await alice.locator("[data-new-event]").click();
  const form = alice.locator("[data-event-form]");
  await form.locator('[data-event-field="title"]').fill("Quarter plan");
  await form.locator('[data-event-field="visibility"]').selectOption("private");
  await form.locator('[data-event-field="unit"]').selectOption({ label: "Calendar crew" });
  await form.locator("[data-save-event]").click();
  const invited = () => one(`select count(*) from public.calendar_event_attendees a join public.calendar_events e on e.id = a.event_id where e.title = 'Quarter plan' and a.user_id = '${colleagueId}' and a.status = 'invited'`);
  check("inviting a unit invites its people", await until(() => invited() === "1", 15000), invited());
  const plan = one(`select id from public.calendar_events where title = 'Quarter plan'`);

  // Search: the invited colleague finds the private event, an outsider's search gives nothing.
  await colleague.goto(`${APP}/w/${alphaShort}`);
  await colleague.getByRole("button", { name: /Пошук/ }).first().click();
  await colleague.locator("[data-search-events]").click();
  await colleague.getByLabel(/Шукати в назвах/).fill("Quarter");
  await colleague.locator("[data-event-results]").waitFor({ timeout: 15000 }).catch(() => {});
  check("search finds an event the person sees", (await colleague.locator("[data-event-results] li").count()) === 1 && (await colleague.locator("[data-event-results]").innerText()).includes("Quarter plan"));
  await colleague.keyboard.press("Escape");
  const { data: bobHits } = await aliceClient.rpc("calendar_event_chips", { ids: [plan] });
  check("(its organizer reads the chip)", bobHits?.length === 1);

  // A chip of that event on a wiki page: the title for who sees it, "no access" otherwise.
  const { data: page } = await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Chips of events" });
  await aliceClient.rpc("save_page_content", {
    target_page: page.id,
    new_content: [{ id: "c1", type: "paragraph", content: [{ type: "text", text: "See ", styles: {} }, { type: "eventChip", props: { eventId: plan } }], children: [] }],
    base_version: 1,
  });
  await aliceClient.rpc("set_page_workspace_role", { target_page: page.id, new_role: "viewer" });
  await colleague.goto(`${APP}/w/${alphaShort}/p/${page.id}`);
  await colleague.locator('[data-event-chip="Quarter plan"]').waitFor({ timeout: 20000 }).catch(() => {});
  check("an event chip shows the title to who sees the event", (await colleague.locator('[data-event-chip="Quarter plan"]').count()) === 1);
  await aliceClient.rpc("remove_calendar_event_attendee", { target: plan, person: colleagueId });
  await colleague.reload();
  await colleague.locator('[data-event-chip="hidden"]').waitFor({ timeout: 20000 }).catch(() => {});
  check("…and “no access” without the name to who doesn't", (await colleague.locator('[data-event-chip="hidden"]').count()) === 1 && !(await colleague.locator("body").innerText()).includes("Quarter plan"));
}

// Phase 2c: a holiday that isn't taken from the balance and shows on the calendar, a
// start date with a norm in proportion, a monthly policy accrued by the daily run.
export async function holidayChecks() {
  const base = `${APP}/w/${alphaShort}/calendar`;
  const one = (query) => sql(query);
  const year = new Date().getFullYear();
  // A Wednesday at least three weeks ahead, and the Monday–Friday around it (next year at the very end of December).
  const ahead = new Date(Date.now() + 21 * 864e5);
  ahead.setUTCDate(ahead.getUTCDate() + ((8 - ahead.getUTCDay()) % 7));
  const at = (n) => new Date(ahead.getTime() + n * 864e5).toISOString().slice(0, 10);
  const [monday, wednesday, friday] = [at(0), at(2), at(4)];
  const vacation = one(`select id from public.leave_policies where workspace_id = '${alphaId}' and kind = 'vacation'`);

  // The owner adds a holiday in the settings.
  await alice.goto(`${base}/time-off?tab=settings`);
  await alice.locator("[data-holiday-form]").waitFor({ timeout: 15000 });
  if (wednesday.slice(0, 4) !== String(year)) await alice.locator("[data-leave-year]").selectOption(wednesday.slice(0, 4));
  await alice.locator('[data-holiday-field="day"]').fill(wednesday);
  await alice.locator('[data-holiday-field="name"]').fill("Founders day");
  await alice.locator("[data-add-holiday]").click();
  check("a holiday is added in the settings", await until(() => one(`select name from public.leave_holidays where workspace_id = '${alphaId}' and day = '${wednesday}'`) === "Founders day", 15000));
  await alice.locator('[data-holiday="Founders day"]').waitFor({ timeout: 15000 }).catch(() => {});
  const self = await colleagueClient.rpc("save_leave_holiday", { ws: alphaId, holiday: friday, title: "Mine" });
  check("a member can't add holidays", self.data?.ok === false, JSON.stringify(self.data));

  // A week of vacation over it takes four days, not five; the calendar shows the holiday.
  const asked = await colleagueClient.rpc("request_leave", { ws: alphaId, target_policy: vacation, first_day: monday, last_day: friday, part: null, deputy: null, note: "" });
  check("a week with a holiday takes four working days", asked.data?.ok === true && Number(asked.data?.days) === 4, JSON.stringify(asked.data));
  await colleague.goto(`${base}?view=week&date=${wednesday}`);
  await colleague.locator(`[data-week] [data-holiday="Founders day"]`).first().waitFor({ timeout: 15000 }).catch(() => {});
  check("the holiday shows on the calendar", (await colleague.locator(`[data-week] [data-holiday="Founders day"]`).count()) >= 1);
  await colleagueClient.rpc("cancel_leave_request", { target: asked.data?.id });

  // A start date in the settings: the norm of that year is in proportion.
  const { data: paid } = await aliceClient.rpc("save_leave_policy", { ws: alphaId, policy_id: null, fields: { name: "Paid leave", kind: "other", days_per_year: 24, carry_over_max: 0, count_days: "working", requires_approval: true, requires_deputy: false, show_kind: false, allow_negative: false, unlimited: false, active: true, accrual: "monthly" } });
  await alice.goto(`${base}/time-off?tab=settings`);
  const row = alice.locator('[data-sheet-person="colleague@alpha.test"]');
  await row.locator("[data-start-date]").fill(`${year}-07-15`);
  check("a start date is saved from the balance sheet", await until(() => one(`select started_on::text from public.leave_member_settings where workspace_id = '${alphaId}' and user_id = '${colleagueId}'`) === `${year}-07-15`, 15000));
  const norm = one(`select public.leave_norm('${paid.id}', '${colleagueId}', ${year})`);
  check("who started in July gets half of the year's norm", Number(norm) === 12, norm);
  const own = await colleagueClient.from("leave_member_settings").select("user_id, started_on");
  check("a member sees only their own start date", own.data?.length === 1 && own.data[0].user_id === colleagueId, JSON.stringify(own.data));

  // The daily run (the server's cleanup): the monthly policy is brought up to this month, once.
  const run = () => fetch(`${APP}/api/cron/cleanup-files`, { headers: { Authorization: "Bearer ci-cron-secret" } }).then((r) => r.status);
  const given = () => one(`select coalesce(sum(days), 0) || ' in ' || count(*) from public.leave_balances where policy_id = '${paid.id}' and kind = 'monthly'`);
  const first = await run();
  const afterFirst = given();
  await run();
  check("the daily run accrues a monthly policy, and nothing twice", first === 200 && afterFirst === given() && Number(afterFirst.split(" ")[0]) > 0, `${first} ${afterFirst} / ${given()}`);
  const expected = one(`select sum(public.leave_due_by_month('${paid.id}', m.user_id, ${year}, extract(month from now())::int)) from public.workspace_members m where m.workspace_id = '${alphaId}' and m.status = 'active' and m.role <> 'guest'`);
  check("…exactly what is due by this month", Number(expected) === Number(afterFirst.split(" ")[0]), `${expected} vs ${afterFirst}`);
}

// Phase 2d: the grid answers the pointer — the slot under it is shown, a drag down the
// hours or across the days makes an event (sticking to quarters of an hour), the
// "absence" mode asks for time off on the picked days, one's own absence is withdrawn
// from the calendar.
export async function gridChecks() {
  const base = `${APP}/w/${alphaShort}/calendar`;
  const one = (query) => sql(query);
  // A Monday at least five weeks ahead, with its Wednesday in the same year.
  const monday = new Date(Date.now() + 35 * 864e5);
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7));
  if (new Date(monday.getTime() + 2 * 864e5).getUTCFullYear() !== monday.getUTCFullYear()) monday.setUTCDate(monday.getUTCDate() + 7);
  const at = (n) => new Date(monday.getTime() + n * 864e5).toISOString().slice(0, 10);
  const [day1, day3] = [at(0), at(2)];
  const hour = 48; // pixels

  await alice.goto(`${base}?view=week&date=${day1}`);
  const column = alice.locator(`[data-day-column="${day1}"]`);
  await column.waitFor({ timeout: 15000 });
  await alice.waitForTimeout(500);
  const box = await column.boundingBox();
  const x = box.x + box.width / 2;
  const yOf = (hours) => box.y + hours * hour;

  // The slot under the pointer.
  await alice.mouse.move(x, yOf(10.1));
  await alice.locator("[data-hover-slot]").waitFor({ timeout: 5000 }).catch(() => {});
  check("the slot under the pointer is shown", (await alice.locator("[data-hover-slot]").count()) === 1 && (await alice.locator("[data-hover-slot]").innerText()).includes("10:00"), await alice.locator("[data-hover-slot]").innerText().catch(() => "none"));

  // A drag down the hours: 10:00 to about 11:36 sticks to 11:30.
  await alice.mouse.move(x, yOf(10.02));
  await alice.mouse.down();
  await alice.mouse.move(x, yOf(10.8), { steps: 4 });
  await alice.mouse.move(x, yOf(11.6), { steps: 4 });
  const selection = await alice.locator("[data-drag-selection]").first().innerText().catch(() => "");
  await alice.mouse.up();
  const form = alice.locator("[data-event-form]");
  await form.waitFor({ timeout: 15000 });
  const [start, end] = [await form.locator('[data-event-field="start"]').inputValue(), await form.locator('[data-event-field="end"]').inputValue()];
  check("a drag down the hours picks a time that sticks to quarters of an hour", start === `${day1}T10:00` && end === `${day1}T11:30` && selection.includes("10:00") && selection.includes("11:30"), `${start} – ${end} (${selection})`);
  await form.locator('[data-event-field="title"]').fill("Dragged meeting");
  await form.locator("[data-save-event]").click();
  const saved = () => one(`select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') || ' ' || to_char(ends_at at time zone 'UTC', 'HH24:MI') from public.calendar_events where title = 'Dragged meeting'`);
  check("…and the event is saved with it", await until(() => saved() === `${day1}T10:00 11:30`, 15000), saved());

  // A drag along the "all day" row: three whole days.
  await alice.locator(`[data-day-column="${day1}"] [data-event="Dragged meeting"]`).waitFor({ timeout: 15000 }).catch(() => {});
  const first = await alice.locator(`[data-all-day="${day1}"]`).boundingBox();
  const last = await alice.locator(`[data-all-day="${day3}"]`).boundingBox();
  await alice.mouse.move(first.x + first.width / 2, first.y + first.height - 4);
  await alice.mouse.down();
  await alice.mouse.move(last.x + last.width / 2, last.y + last.height - 4, { steps: 6 });
  const pickedCells = await alice.locator("[data-all-day][data-picked]").count();
  await alice.mouse.up();
  await form.waitFor({ timeout: 15000 });
  check("a drag along the days picks whole days", pickedCells === 3 && (await form.locator('[data-event-field="all_day"]').isChecked()) && (await form.locator('[data-event-field="first_day"]').inputValue()) === day1 && (await form.locator('[data-event-field="last_day"]').inputValue()) === day3, `${pickedCells} cells`);
  await alice.keyboard.press("Escape");

  // The "absence" mode in the month: a drag across three days asks for time off on them.
  await colleague.goto(`${base}?view=month&date=${day1}`);
  await colleague.locator("[data-month]").waitFor({ timeout: 15000 });
  await colleague.locator('[data-create-mode="absence"]').click();
  const from = await colleague.locator(`[data-month] [data-day="${day1}"]`).boundingBox();
  const to = await colleague.locator(`[data-month] [data-day="${day3}"]`).boundingBox();
  await colleague.mouse.move(from.x + from.width / 2, from.y + from.height - 6);
  await colleague.mouse.down();
  await colleague.mouse.move(to.x + to.width / 2, to.y + to.height - 6, { steps: 6 });
  await colleague.mouse.up();
  const leave = colleague.locator("[data-leave-form]");
  await leave.waitFor({ timeout: 15000 });
  check("in the “absence” mode a drag across days opens a request for them", (await leave.locator('[data-leave-field="from"]').inputValue()) === day1 && (await leave.locator('[data-leave-field="to"]').inputValue()) === day3);
  await leave.locator('[data-leave-field="policy"]').selectOption({ label: "Віддалена робота" });
  await leave.locator("[data-send-leave]").click();
  const mine = () => one(`select status from public.leave_requests where user_id = '${colleagueId}' and start_date = '${day1}' and end_date = '${day3}'`);
  check("…and it is made (no approval needed for remote work)", await until(() => mine() === "approved", 15000), mine());
  await colleague.locator("[data-calendar-note]").waitFor({ timeout: 15000 }).catch(() => {});

  // One's own absence is withdrawn right from the calendar.
  await colleague.goto(`${base}?view=week&date=${day1}`);
  await colleague.locator(`[data-all-day="${day1}"] [data-my-absence-chip]`).click({ timeout: 15000 });
  await colleague.locator("[data-withdraw-leave]").click({ timeout: 15000 });
  check("one's own absence is withdrawn from the calendar", await until(() => mine() === "cancelled", 15000), mine());
  check("…and leaves it", await until(async () => (await colleague.locator(`[data-all-day="${day1}"] [data-my-absence-chip]`).count()) === 0, 15000));

  // A request that still waits shows on its person's calendar, and is withdrawn the same way.
  const vacation = one(`select id from public.leave_policies where workspace_id = '${alphaId}' and kind = 'vacation'`);
  const asked = await colleagueClient.rpc("request_leave", { ws: alphaId, target_policy: vacation, first_day: at(7), last_day: at(7), part: null, deputy: null, note: "" });
  await colleague.goto(`${base}?view=week&date=${at(7)}`);
  await colleague.locator(`[data-all-day="${at(7)}"] [data-my-request="pending"]`).click({ timeout: 15000 });
  await colleague.locator("[data-withdraw-leave]").click({ timeout: 15000 });
  check("a waiting request is withdrawn from the calendar too", asked.data?.ok === true && (await until(() => one(`select status from public.leave_requests where id = '${asked.data?.id}'`) === "cancelled", 15000)), JSON.stringify(asked.data));
  await alice.goto(`${base}?view=week&date=${at(7)}`);
  await alice.locator("[data-week]").waitFor({ timeout: 15000 });
  check("…and nobody else ever saw it there", (await alice.locator("[data-my-request]").count()) === 0);
}

// Phase 3a: the person's feed for calendar apps — made on the calendar, read without a
// session by its secret address, dead after a new address or when turned off.
export async function feedChecks() {
  const read = async (url) => {
    const res = await fetch(url, { redirect: "manual" });
    return { status: res.status, type: res.headers.get("content-type") ?? "", text: res.status === 200 ? await res.text() : "" };
  };
  const issue = async () => {
    const field = alice.locator("[data-feed-address]");
    const old = (await field.count()) ? await field.inputValue() : "";
    await alice.locator("[data-feed-issue]").click();
    await alice.waitForFunction((was) => (document.querySelector("[data-feed-address]")?.value ?? was) !== was, old, { timeout: 15000 });
    return field.inputValue();
  };
  await alice.goto(`${APP}/w/${alphaShort}/calendar`);
  await alice.locator("[data-open-feed]").click();
  await alice.locator('[data-feed-state="off"]').waitFor({ timeout: 15000 });
  const first = await issue();
  check("the feed address is shown once it is made", /\/api\/calendar-feed\/[a-z0-9]{8}\/[A-Za-z0-9_-]{43}\.ics$/.test(first), first.replace(/[A-Za-z0-9_-]{43}/, "…"));
  const feed = await read(first);
  check("a calendar app reads the feed without a session", feed.status === 200 && feed.type.startsWith("text/calendar") && feed.text.startsWith("BEGIN:VCALENDAR") && feed.text.includes("BEGIN:VEVENT"), `${feed.status} ${feed.type}`);
  check("the feed carries no descriptions of events", !/^DESCRIPTION:(?!https:)/m.test(feed.text));
  const guessed = await read(first.replace(/[A-Za-z0-9_-]{43}\.ics$/, `${"A".repeat(43)}.ics`));
  check("a guessed address gives nothing", guessed.status === 404, String(guessed.status));
  check("only the hash of the secret is kept", sql(`select count(*) from public.calendar_feeds where token_hash ~ '^[0-9a-f]{64}$'`) === "1");
  const second = await issue();
  check("a new address kills the old one", second !== first && (await read(first)).status === 404 && (await read(second)).status === 200);
  await alice.locator("[data-feed-drop]").click();
  await alice.locator('[data-feed-state="off"]').waitFor({ timeout: 15000 });
  check("turned off, the address gives nothing", (await read(second)).status === 404 && sql(`select count(*) from public.calendar_feeds`) === "0");
}
