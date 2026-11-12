import "server-only";
import { dataClient } from "@/lib/team-db/data";

export type MemberCard = {
  name: string;
  avatarUrl: string | null;
  role: "owner" | "admin" | "member" | "guest";
  jobTitle: string | null;
  departments: string[];
  teams: string[];
  // Day and month only, when the viewer may see it.
  birthday: { month: number; day: number } | null;
  canEditTitle: boolean;
  canEditBirthday: boolean;
};

type Row = {
  ok: boolean;
  name?: string;
  avatar_url?: string | null;
  role?: MemberCard["role"];
  job_title?: string | null;
  departments?: string[];
  teams?: string[];
  birthday?: { month: number; day: number } | null;
  can_edit_title?: boolean;
  can_edit_birthday?: boolean;
};

const byName = (a: string, b: string) => a.localeCompare(b);

// Who a person is in this workspace; null when the viewer may not see them.
export async function loadMemberCard(shortId: string, workspaceId: string, person: string): Promise<MemberCard | null> {
  const supabase = await dataClient(shortId);
  const { data } = await supabase.rpc("member_card", { ws: workspaceId, person });
  const row = data as Row | null;
  if (!row?.ok) return null;
  return {
    name: row.name ?? "",
    avatarUrl: row.avatar_url ?? null,
    role: row.role ?? "member",
    jobTitle: row.job_title ?? null,
    departments: [...(row.departments ?? [])].sort(byName),
    teams: [...(row.teams ?? [])].sort(byName),
    birthday: row.birthday ?? null,
    canEditTitle: Boolean(row.can_edit_title),
    canEditBirthday: Boolean(row.can_edit_birthday),
  };
}
