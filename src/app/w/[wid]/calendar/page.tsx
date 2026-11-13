import type { Metadata } from "next";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { CALENDAR_VIEWS, DEFAULT_SETTINGS, isDayKey, type CalendarPerson, type CalendarSettings, type CalendarView } from "@/lib/calendar";
import { dataClient } from "@/lib/team-db/data";
import { withPaths } from "@/lib/groups";
import { getWorkspace, isWorkspaceAdmin } from "@/lib/workspace";
import { CalendarScreen } from "@/components/calendar/calendar-screen";

// Read per request, so the title follows the interface language.
export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.calendar.title} · ${t.app.name}` };
}

// Doba: the company calendar. The page gives the people and the settings; the events
// of the shown period are read by the screen itself, in the viewer's time zone.
export default async function CalendarPage({ params, searchParams }: PageProps<"/w/[wid]/calendar">) {
  const { wid } = await params;
  const query = await searchParams;
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const [user, db] = await Promise.all([getCurrentUser(), dataClient(wid)]);
  const guest = workspace.role === "guest";
  const [{ data: settings }, { data: groups }, { data: members }] = await Promise.all([
    db.from("calendar_settings").select("work_days, time_zone, show_birthdays").eq("workspace_id", workspace.id).maybeSingle(),
    // Units, to invite a whole one to an event.
    guest ? Promise.resolve({ data: [] }) : db.from("workspace_groups").select("id, name, parent_id").eq("workspace_id", workspace.id),
    // A guest invites nobody, so needs no list of people.
    guest
      ? Promise.resolve({ data: [] })
      : db
          .from("workspace_members")
          .select("user_id, role, profile:profiles!workspace_members_user_id_fkey(name, email)")
          .eq("workspace_id", workspace.id)
          .eq("status", "active")
          .overrideTypes<{ user_id: string; role: string; profile: { name: string | null; email: string } | null }[], { merge: false }>(),
  ]);
  const people: CalendarPerson[] = (members ?? [])
    .map((m) => ({ id: m.user_id, name: m.profile?.name || m.profile?.email || "—", guest: m.role === "guest" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const view = CALENDAR_VIEWS.includes(query.view as CalendarView) ? (query.view as CalendarView) : null;

  return (
    <CalendarScreen
      shortId={workspace.shortId}
      workspaceId={workspace.id}
      me={user.id}
      guest={guest}
      admin={isWorkspaceAdmin(workspace)}
      people={people}
      units={withPaths((groups ?? []) as { id: string; name: string; parent_id: string | null }[]).map((u) => ({ id: u.id, name: u.name }))}
      settings={(settings as CalendarSettings | null) ?? DEFAULT_SETTINGS}
      initialView={view}
      initialDay={isDayKey(query.date) ? query.date : null}
      initialEvent={typeof query.event === "string" && /^[0-9a-f-]{36}$/.test(query.event) ? query.event : null}
      googleResult={!guest && typeof query.google === "string" && ["connected", "cancelled", "permissions", "error"].includes(query.google) ? query.google : null}
    />
  );
}
