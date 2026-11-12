import type { Metadata } from "next";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dataClient, workspaceData } from "@/lib/team-db/data";
import { withPaths } from "@/lib/groups";
import { getWorkspace, isWorkspaceAdmin } from "@/lib/workspace";
import type { ChatPerson } from "@/lib/chat";
import { loadChat } from "@/app/chat-actions";
import { ChatScreen } from "@/components/chat/chat-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.chat.title} · ${t.app.name}` };
}

// Toker: the team chat. The page gives the channels, people and units; messages are
// read by the screen itself and kept live (decision 2026-11-12 "Toker, етап 1").
export default async function ChatPage({ params, searchParams }: PageProps<"/w/[wid]/chat">) {
  const { wid } = await params;
  const query = await searchParams;
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const guest = workspace.role === "guest";
  const central = await createClient();
  const [user, db, data, chat] = await Promise.all([getCurrentUser(), dataClient(wid), workspaceData(wid), loadChat(wid, workspace.id)]);
  const [{ data: members }, { data: groups }, { data: mayOpen }, { data: mayClosed }] = await Promise.all([
    // Whom this person sees (a guest: only the people of their own channels).
    db
      .from("workspace_members")
      .select("user_id, role, profile:profiles!workspace_members_user_id_fkey(name, email, avatar_url)")
      .eq("workspace_id", workspace.id)
      .eq("status", "active")
      .overrideTypes<{ user_id: string; role: string; profile: { name: string | null; email: string; avatar_url: string | null } | null }[], { merge: false }>(),
    guest ? Promise.resolve({ data: [] }) : db.from("workspace_groups").select("id, name, parent_id").eq("workspace_id", workspace.id),
    guest ? Promise.resolve({ data: false }) : central.rpc("role_allows", { ws: workspace.id, perm: "create_open_channels" }),
    guest ? Promise.resolve({ data: false }) : central.rpc("role_allows", { ws: workspace.id, perm: "create_closed_channels" }),
  ]);
  const people: ChatPerson[] = (members ?? [])
    .map((m) => ({ id: m.user_id, name: m.profile?.name || m.profile?.email || "—", avatarUrl: m.profile?.avatar_url ?? null, guest: m.role === "guest" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const channel = typeof query.c === "string" && /^[0-9a-f-]{36}$/.test(query.c) ? query.c : null;

  return (
    <ChatScreen
      shortId={workspace.shortId}
      workspaceId={workspace.id}
      me={user.id}
      guest={guest}
      admin={isWorkspaceAdmin(workspace)}
      canCreateOpen={mayOpen === true}
      canCreateClosed={mayClosed === true}
      live={data?.location === "central" || !data ? "realtime" : "poll"}
      people={people}
      units={withPaths((groups ?? []) as { id: string; name: string; parent_id: string | null }[]).map((u) => ({ id: u.id, name: u.name }))}
      initialChannels={chat?.channels ?? []}
      initialCategories={chat?.categories ?? []}
      initialChannel={channel}
      failed={!chat}
    />
  );
}
