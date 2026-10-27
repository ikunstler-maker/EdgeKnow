import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LAST_WORKSPACE_COOKIE, workspacePath } from "@/lib/paths";
import { listMyWorkspaces } from "@/lib/workspace";

// "/" opens the last used workspace, or the first one; with none, offers to create one.
export default async function RootPage() {
  await getCurrentUser();
  const [workspaces, cookieStore] = await Promise.all([listMyWorkspaces(), cookies()]);
  const last = cookieStore.get(LAST_WORKSPACE_COOKIE)?.value;
  const target = workspaces.find((w) => w.shortId === last) ?? workspaces[0];
  redirect(target ? workspacePath(target.shortId) : "/new");
}
