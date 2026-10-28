import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ProfileStats = {
  name: string;
  visibility: "private" | "workspace";
  joinedAt: string;
  pagesCreated: number;
  pagesByRole: { owner: number; editor: number; commenter: number; viewer: number };
  charsWritten: number;
  charsInOwnPages: number;
  pagesEdited: number;
  comments: number;
};

type Row = {
  ok: boolean;
  name?: string;
  visibility?: "private" | "workspace";
  joined_at?: string;
  pages_created?: number;
  pages_by_role?: Partial<Record<"owner" | "editor" | "commenter" | "viewer", number>>;
  chars_written?: number;
  chars_in_own_pages?: number;
  pages_edited?: number;
  comments?: number;
};

// Null when the person isn't in the workspace or hasn't shown their statistics.
export async function loadProfileStats(workspaceId: string, person: string): Promise<ProfileStats | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("profile_stats", { ws: workspaceId, person });
  const row = data as Row | null;
  if (!row?.ok) return null;
  const roles = row.pages_by_role ?? {};
  return {
    name: row.name ?? "",
    visibility: row.visibility ?? "private",
    joinedAt: row.joined_at ?? "",
    pagesCreated: Number(row.pages_created ?? 0),
    pagesByRole: {
      owner: Number(roles.owner ?? 0),
      editor: Number(roles.editor ?? 0),
      commenter: Number(roles.commenter ?? 0),
      viewer: Number(roles.viewer ?? 0),
    },
    charsWritten: Number(row.chars_written ?? 0),
    charsInOwnPages: Number(row.chars_in_own_pages ?? 0),
    pagesEdited: Number(row.pages_edited ?? 0),
    comments: Number(row.comments ?? 0),
  };
}
