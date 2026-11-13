// Browser smoke test: Vault (VAULT-1) — every file a person can see, gathered from
// the services. Rows are put straight into the database (the upload paths have their
// own tests); what matters here is who sees which file.
import { APP, alice, aliceClient, alphaId, alphaShort, check, clip, colleague, colleagueId, sql, until } from "./common.mjs";

export async function vaultChecks() {
  const aliceId = sql("select id from auth.users where email = 'alice@alpha.test'");
  const { data: project } = await aliceClient.rpc("create_task_project", { ws: alphaId, new_name: "Vault files", new_key: "VLT", new_icon: null, status_names: null });
  const taskId = async (fields) => {
    const { data } = await aliceClient.rpc("create_task", { target_project: project.id, fields });
    return sql(`select id from public.tasks where project_id = '${project.id}' and title = '${fields.title}'`) || data?.id;
  };
  const open = await taskId({ title: "Vault open task" });
  const hidden = await taskId({ title: "Vault private task", private: true });
  const binned = await taskId({ title: "Vault binned task" });
  sql(`update public.tasks set deleted_at = now(), deleted_by = '${aliceId}' where id = '${binned}'`);
  const taskFile = (task, name, mime, backend = "supabase") =>
    sql(`insert into public.task_files (workspace_id, task_id, name, mime_type, bytes, storage_path, storage_backend, uploaded_by)
         values ('${alphaId}', '${task}', '${name}', '${mime}', 2048, '${alphaId}/tasks/${task}/' || gen_random_uuid(), '${backend}', '${aliceId}')`);
  taskFile(open, "vault-brief.pdf", "application/pdf");
  taskFile(hidden, "vault-private.pdf", "application/pdf");
  taskFile(binned, "vault-binned.pdf", "application/pdf");
  taskFile(open, "vault-pending.pdf", "application/pdf", "pending");

  // A closed channel with Alice alone, a message and its file; and a file of a removed message.
  const channel = sql(`with made as (insert into public.chat_channels (workspace_id, name, visibility, created_by) values ('${alphaId}', 'vault-closed', 'closed', '${aliceId}') returning id) select id from made`);
  sql(`insert into public.chat_channel_members (channel_id, workspace_id, user_id, role, invited) values ('${channel}', '${alphaId}', '${aliceId}', 'owner', true)`);
  const chatFile = (name, removed) => {
    const message = sql(`with made as (insert into public.chat_messages (workspace_id, channel_id, author_id, body${removed ? ", deleted_at" : ""}) values ('${alphaId}', '${channel}', '${aliceId}', 'file'${removed ? ", now()" : ""}) returning id) select id from made`);
    sql(`insert into public.chat_files (workspace_id, channel_id, message_id, name, mime_type, bytes, storage_path, storage_backend, uploaded_by)
         values ('${alphaId}', '${channel}', '${message}', '${name}', 'text/plain', 512, '${alphaId}/chat/${channel}/' || gen_random_uuid(), 'supabase', '${aliceId}')`);
  };
  chatFile("vault-secret.txt", false);
  chatFile("vault-removed.txt", true);

  const names = (page) => page.locator("[data-vault-file]").evaluateAll((items) => items.map((item) => item.getAttribute("data-vault-file")).filter((n) => n.startsWith("vault-")).sort());
  await alice.goto(`${APP}/w/${alphaShort}/files?tab=all`);
  // (until() takes a plain condition; the browser's own waiting is used for the page)
  await alice.locator('[data-vault-file^="vault-"]').nth(2).waitFor({ timeout: 15000 });
  const aliceSees = await names(alice);
  check("Vault: the owner sees the files of her tasks and her closed channel", JSON.stringify(aliceSees) === JSON.stringify(["vault-brief.pdf", "vault-private.pdf", "vault-secret.txt"]), JSON.stringify(aliceSees));

  await colleague.goto(`${APP}/w/${alphaShort}/files?tab=all`);
  await colleague.locator("[data-vault-filters], main p").first().waitFor({ timeout: 15000 });
  const colleagueSees = await names(colleague);
  check("…a member sees neither a private task's file nor a closed channel's", !colleagueSees.includes("vault-private.pdf") && !colleagueSees.includes("vault-secret.txt"), JSON.stringify(colleagueSees));

  await alice.locator("[data-vault-service]").selectOption("chat");
  const chatOnly = await alice.locator("[data-vault-file]").evaluateAll((items) => items.every((item) => item.getAttribute("data-vault-source") === "chat"));
  await alice.locator("[data-vault-service]").selectOption("");
  await alice.locator("[data-vault-search]").fill("brief");
  const found = await names(alice);
  check("…the filter by service and the search narrow the list", chatOnly && JSON.stringify(found) === JSON.stringify(["vault-brief.pdf"]), `${chatOnly} ${JSON.stringify(found)}`);

  const where = await alice.locator('[data-vault-file="vault-brief.pdf"] [data-vault-where]').getAttribute("href");
  check("…a file links to where it is used", where === `/w/${alphaShort}/tasks/VLT/${sql(`select number from public.tasks where id = '${open}'`)}`, where);

  await alice.goto(`${APP}/w/${alphaShort}`);
  check("…and the start page offers Vault", (await alice.locator('[data-service="files"]', { hasText: "Скоро" }).count()) === 0);

  await vaultDriveChecks();
}

// VAULT-2: the team's own folders and files, shared as on a drive.
async function vaultDriveChecks() {
  const top = `${APP}/w/${alphaShort}/files`;
  await alice.goto(top);
  await alice.locator("[data-vault-new-folder]").click();
  await alice.locator("[data-vault-name]").fill("Vault e2e");
  await alice.locator("[data-vault-save-name]").click();
  await alice.locator('[data-vault-item="Vault e2e"]').waitFor({ timeout: 15000 });
  const folderId = sql("select id from public.vault_items where name = 'Vault e2e' and kind = 'folder'");
  check("Vault: a member makes a folder at the top", /^[0-9a-f-]{36}$/.test(folderId), folderId);

  await alice.goto(`${top}?folder=${folderId}`);
  await alice.locator("[data-vault-file-input]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello vault") });
  const uploaded = await alice.locator('[data-vault-item="notes.txt"]').waitFor({ timeout: 15000 }).then(() => true, () => false);
  const stored = sql("select storage_backend || ' ' || bytes || ' ' || mime_type from public.vault_items where name = 'notes.txt'");
  check("…uploads a file into it, kept in the workspace's storage", uploaded && /^(supabase|drive) 11 text\/plain$/.test(stored), stored);
  await alice.locator("[data-vault-file-input]").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf at all") });
  await alice.locator("[data-vault-uploads]").waitFor({ timeout: 10000 });
  check("…a file that is not what it claims is refused", sql("select count(*) from public.vault_items where name = 'fake.pdf'") === "0");
  const fileId = sql("select id from public.vault_items where name = 'notes.txt'");
  const fileUrl = `/api/vault/files/${fileId}?ws=${alphaShort}&download`;
  const read = (page) => page.evaluate(async (url) => { const r = await fetch(url, { cache: "no-store" }); return `${r.status} ${r.status === 200 ? await r.text() : ""}`.trim(); }, fileUrl);

  await colleague.goto(`${top}?folder=${folderId}`);
  await colleague.locator('[data-vault-item="notes.txt"]').waitFor({ timeout: 15000 });
  check("…a colleague sees it as a viewer: no upload, the file opens", (await colleague.locator("[data-vault-upload]").count()) === 0 && (await read(colleague)) === "200 hello vault");

  await alice.locator("[data-vault-folder-share]").click();
  await alice.locator("[data-vault-general]").selectOption("restricted");
  await until(() => sql(`select inherit::text from public.vault_items where id = '${folderId}'`) === "false", 10000);
  await colleague.reload();
  const hidden = (await colleague.locator('[data-vault-item="notes.txt"]').count()) === 0;
  check("…restricted, the colleague neither sees the folder nor gets its file", hidden && (await read(colleague)) === "404");

  await alice.locator("[data-vault-person]").selectOption(colleagueId);
  await alice.locator("[data-vault-person-add]").click();
  await until(() => sql(`select role from public.vault_access where item_id = '${folderId}' and user_id = '${colleagueId}'`) === "viewer", 10000);
  await colleague.reload();
  await colleague.locator('[data-vault-item="notes.txt"]').waitFor({ timeout: 15000 });
  check("…given to the colleague by name, it is back for them", (await read(colleague)) === "200 hello vault");
  await alice.keyboard.press("Escape");

  await alice.goto(top);
  await alice.locator('[data-vault-item="Vault e2e"] [data-vault-menu]').click();
  await alice.locator('[data-vault-action="trash"]').click();
  await until(() => sql(`select (deleted_at is not null)::text from public.vault_items where id = '${fileId}'`) === "true", 10000);
  await alice.goto(`${top}?tab=bin`);
  await alice.locator('[data-vault-item="Vault e2e"] [data-vault-restore]').click();
  await until(() => sql(`select count(*) from public.vault_items where workspace_id = '${alphaId}' and deleted_at is not null`) === "0", 10000);
  check("…to the bin with what is inside, and restored", sql(`select (deleted_at is null)::text from public.vault_items where id = '${fileId}'`) === "true");

  // VAULT-4: "Used" by service, for the owner only.
  await alice.goto(top);
  const used = await alice.locator("[data-vault-usage]").textContent({ timeout: 15000 }).catch(() => "");
  await colleague.goto(top);
  await colleague.locator("[data-vault-tabs]").waitFor({ timeout: 15000 });
  check("…the owner sees what the files take by service, a member does not", /Vault/.test(used ?? "") && (await colleague.locator("[data-vault-usage]").count()) === 0, used ?? "");

  await alice.goto(`${top}?tab=all`);
  await alice.locator('[data-vault-file="notes.txt"]').waitFor({ timeout: 15000 });
  check("…and \"All files\" lists it with Vault as its place", (await alice.locator('[data-vault-file="notes.txt"]').getAttribute("data-vault-source")) === "files");

  await vaultEmbedChecks(fileId);
}

// VAULT-3: a Vault file in a chat message, a task and a wiki page — a card read with the
// viewer's own access; without it, "unavailable" and never the name.
async function vaultEmbedChecks(fileId) {
  const link = `${APP}/w/${alphaShort}/files?file=${fileId}`;
  const card = '[data-vault-embed-card="notes.txt"]';
  const { data: channel } = await aliceClient.rpc("chat_create_channel", { ws: alphaId, cat: null, new_name: "vault-embeds", new_topic: "", is_closed: false, unit: null });
  await aliceClient.rpc("chat_post_message", { ch: channel.id, new_body: `See ${link}`, thread_root: null, mention_ids: null });
  const taskId = sql("select id from public.tasks where title = 'Vault open task'");
  const taskNumber = sql(`select number from public.tasks where id = '${taskId}'`);
  const added = await aliceClient.rpc("add_task_web_link", { target_task: taskId, new_title: "File from Vault", new_url: link });
  const { data: page } = await aliceClient.rpc("create_page", { ws: alphaId, parent: null, new_title: "Vault embeds" });
  const saved = await aliceClient.rpc("save_page_content", { target_page: page.id, new_content: [{ id: "v1", type: "vaultFile", props: { fileId }, children: [] }], base_version: 1 });
  // A new page is a draft only its author sees until it is published.
  const published = await aliceClient.rpc("publish_page", { target_page: page.id, with_children: false });
  // A new page is the author's own until shared: the colleague gets it to read.
  await aliceClient.rpc("set_page_workspace_role", { target_page: page.id, new_role: "viewer" });
  check("(setup) a message, a task link and a page with the Vault file", Boolean(channel?.id) && added.data?.ok === true && saved.data?.ok === true, JSON.stringify([added.data, saved.data]));

  const places = {
    chat: `${APP}/w/${alphaShort}/chat?c=${channel.id}`,
    task: `${APP}/w/${alphaShort}/tasks/VLT/${taskNumber}`,
    page: `${APP}/w/${alphaShort}/p/${page.id}`,
  };
  const shows = async (who, url) => {
    await who.goto(url);
    return who.locator(card).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  };
  const seen = [];
  for (const [name, url] of Object.entries(places)) if (await shows(alice, url)) seen.push(name);
  check("Vault: the file's card shows in a chat message, a task and a wiki page", seen.join(",") === "chat,task,page", seen.join(","));
  check("…and a colleague with access to the file sees it in the chat", await shows(colleague, places.chat));

  // The colleague loses access: the card says "unavailable", without the file's name.
  const folderId = sql(`select parent_id from public.vault_items where id = '${fileId}'`);
  await aliceClient.rpc("vault_set_member_role", { target: folderId, member: colleagueId, new_role: null });
  const hidden = [];
  const seenBy = {};
  for (const [name, url] of Object.entries(places)) {
    await colleague.goto(url);
    // In chat a link the reader can't see is the usual "no access" badge; elsewhere the card says "unavailable".
    const unavailable = await colleague.locator('[data-vault-embed-unavailable], [data-chat-chip="none"]').first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    if (unavailable && (await colleague.getByText("notes.txt").count()) === 0) hidden.push(name);
    else seenBy[name] = clip(await colleague.locator("main").first().innerText().catch(() => ""), 200);
  }
  // The colleague may not see the task at all; then nothing of the file shows there either.
  check("…without access: \"unavailable\" and never the name", hidden.includes("chat") && hidden.includes("page") && (await colleague.getByText("notes.txt").count()) === 0, `${hidden.join(",")} ${JSON.stringify(published.data)} ${JSON.stringify(seenBy)}`);

  await alice.goto(link);
  check("…\"In Vault\" opens the file's folder with the file marked", (await alice.locator('[data-vault-item="notes.txt"][aria-current="true"]').waitFor({ timeout: 15000 }).then(() => true, () => false)));
}

