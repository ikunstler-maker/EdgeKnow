import { NextResponse, type NextRequest } from "next/server";
import { t } from "@/i18n";
import { driveApi, driveConfigured } from "@/lib/drive/google-drive";
import { requireOwner } from "@/lib/drive/owner";
import { encrypt, verify } from "@/lib/drive/secret-box";
import { workspacePath } from "@/lib/paths";
import { createAdminClient } from "@/lib/supabase/admin";

// Step 2: Google sends the person back with a code. The state must be ours, fresh,
// for this same person, who must still own the workspace. Then the wiki creates
// its folders on that Drive and stores the (encrypted) access.
export async function GET(request: NextRequest) {
  const fail = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin));
  const state = verify<{ ws: string; u: string; exp: number; b?: number }>(
    request.nextUrl.searchParams.get("state") ?? "",
  );
  const code = request.nextUrl.searchParams.get("code");
  if (!driveConfigured() || !state || state.exp < Date.now() || !code) return fail("/");

  const owner = await requireOwner(state.ws);
  const admin = createAdminClient();
  if (!owner || owner.userId !== state.u || !admin) return fail("/");

  const { data: workspace } = await admin.from("workspaces").select("name, short_id").eq("id", state.ws).maybeSingle();
  if (!workspace) return fail("/");
  const settings = (result: string) => fail(`${workspacePath(workspace.short_id, "/settings")}?tab=data&drive=${result}`);

  // VAULT-7: the connected Drive, now also readable in Vault. The same account only; no
  // new folders, nothing moves. Back to Vault's Drive tab.
  if (state.b) {
    const vault = (result: string) => fail(`${workspacePath(workspace.short_id, "/files")}?drive=${result}`);
    try {
      const { refreshToken, email, browse } = await driveApi().exchangeCode(code, `${request.nextUrl.origin}/api/drive/callback`);
      const { data: current } = await admin.from("drive_connections").select("id, account_email").eq("workspace_id", state.ws).eq("active", true).maybeSingle();
      if (!current) return vault("error");
      if (!browse) return vault("not_allowed");
      if (current.account_email.toLowerCase() !== email.toLowerCase()) return vault("other_account");
      const { error } = await admin
        .from("drive_connections")
        .update({ token_encrypted: encrypt(refreshToken), can_browse: true, status: "ok", last_error: null })
        .eq("id", current.id);
      if (error) return vault("error");
      await admin.from("audit_log").insert({ workspace_id: state.ws, actor_id: owner.userId, action: "drive_browse_allowed", details: { email } });
    } catch {
      return vault("error");
    }
    return vault("allowed");
  }

  try {
    const api = driveApi();
    const { refreshToken, email, browse } = await api.exchangeCode(code, `${request.nextUrl.origin}/api/drive/callback`);
    const root = await api.createFolder(refreshToken, `EdgeKnow — ${workspace.name}`);
    const files = await api.createFolder(refreshToken, t.storage.filesFolder, root);
    const backups = await api.createFolder(refreshToken, t.storage.backupsFolder, root);

    // The previous Drive stays readable until its files are moved.
    await admin.from("drive_connections").update({ active: false }).eq("workspace_id", state.ws).eq("active", true);
    const { error } = await admin.from("drive_connections").insert({
      workspace_id: state.ws,
      account_email: email || "—",
      root_folder_id: root,
      files_folder_id: files,
      backups_folder_id: backups,
      token_encrypted: encrypt(refreshToken),
      can_browse: browse,
      connected_by: owner.userId,
    });
    if (error) return settings("error");
    await admin.from("audit_log").insert({
      workspace_id: state.ws,
      actor_id: owner.userId,
      action: "drive_connected",
      details: { email },
    });
  } catch {
    return settings("error");
  }
  return settings("connected");
}
