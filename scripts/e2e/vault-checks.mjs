// Browser smoke test: Vault (VAULT-1) — every file a person can see, gathered from
// the services. Rows are put straight into the database (the upload paths have their
// own tests); what matters here is who sees which file.
import { APP, alice, aliceClient, alphaId, alphaShort, check, colleague, sql, until } from "./common.mjs";

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
  const channel = sql(`insert into public.chat_channels (workspace_id, name, visibility, created_by) values ('${alphaId}', 'vault-closed', 'closed', '${aliceId}') returning id`);
  sql(`insert into public.chat_channel_members (channel_id, workspace_id, user_id, role) values ('${channel}', '${alphaId}', '${aliceId}', 'owner')`);
  const chatFile = (name, removed) => {
    const message = sql(`insert into public.chat_messages (workspace_id, channel_id, author_id, body${removed ? ", deleted_at" : ""}) values ('${alphaId}', '${channel}', '${aliceId}', 'file'${removed ? ", now()" : ""}) returning id`);
    sql(`insert into public.chat_files (workspace_id, channel_id, message_id, name, mime_type, bytes, storage_path, storage_backend, uploaded_by)
         values ('${alphaId}', '${channel}', '${message}', '${name}', 'text/plain', 512, '${alphaId}/chat/${channel}/' || gen_random_uuid(), 'supabase', '${aliceId}')`);
  };
  chatFile("vault-secret.txt", false);
  chatFile("vault-removed.txt", true);

  const names = (page) => page.locator("[data-vault-file]").evaluateAll((items) => items.map((item) => item.getAttribute("data-vault-file")).filter((n) => n.startsWith("vault-")).sort());
  await alice.goto(`${APP}/w/${alphaShort}/files`);
  await until(async () => (await names(alice)).length >= 3, 15000);
  const aliceSees = await names(alice);
  check("Vault: the owner sees the files of her tasks and her closed channel", JSON.stringify(aliceSees) === JSON.stringify(["vault-brief.pdf", "vault-private.pdf", "vault-secret.txt"]), JSON.stringify(aliceSees));

  await colleague.goto(`${APP}/w/${alphaShort}/files`);
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
}
