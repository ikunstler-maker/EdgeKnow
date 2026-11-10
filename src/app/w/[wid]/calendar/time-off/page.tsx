import type { Metadata } from "next";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import type { CalendarPerson } from "@/lib/calendar";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { TimeOffScreen } from "@/components/calendar/time-off-screen";

// Read per request, so the title follows the interface language.
export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.timeOff.title} · ${t.app.name}` };
}

// Doba, time off: balances, requests, approvals, the team's absences and (for who
// manages time off) the policies. Everything is read by the screen itself.
export default async function TimeOffPage({ params, searchParams }: PageProps<"/w/[wid]/calendar/time-off">) {
  const { wid } = await params;
  const query = await searchParams;
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const guest = workspace.role === "guest";
  const [user, db] = await Promise.all([getCurrentUser(), dataClient(wid)]);
  const { data: members } = guest
    ? { data: [] }
    : await db
        .from("workspace_members")
        .select("user_id, role, profile:profiles!workspace_members_user_id_fkey(name, email)")
        .eq("workspace_id", workspace.id)
        .eq("status", "active")
        .overrideTypes<{ user_id: string; role: string; profile: { name: string | null; email: string } | null }[], { merge: false }>();
  // Deputies and balances are for members only.
  const people: CalendarPerson[] = (members ?? [])
    .filter((m) => m.role !== "guest")
    .map((m) => ({ id: m.user_id, name: m.profile?.name || m.profile?.email || "—", guest: false }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tab = typeof query.tab === "string" ? query.tab : null;

  return <TimeOffScreen shortId={workspace.shortId} workspaceId={workspace.id} me={user.id} guest={guest} people={people} initialTab={tab} />;
}
