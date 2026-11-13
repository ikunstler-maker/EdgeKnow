"use server";

import type { ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { liveConnection, workspaceData, writeClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";

// Real-time co-editing (phase 1: presentations and "Design"). The browser asks here, on
// opening a document and every two minutes after, whether the document is live and for a
// fresh pass; every new pass makes the channels re-check the person's rights.
// Who may join and send is decided by the database (live_channel_allowed), not here.

const LIVE_SERVICES = new Set(["slides", "boards", "nodes"]);

export type LiveSession =
  | { enabled: false }
  | {
      enabled: true;
      url: string;
      key: string;
      token: string;
      expiresAt: number;
      // The person's role on the document: owner, editor, commenter or viewer.
      role: string;
      // Whether people who only view or comment show their cursors (set per document).
      viewerCursors: boolean;
      me: { id: string; name: string; avatarUrl: string | null };
    };

const OFF: LiveSession = { enabled: false };

export async function liveSession(shortId: string, objectId: string): Promise<LiveSession> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return OFF;
  const central = await createClient();
  const { data: ws } = await central.from("workspaces").select("live_collab").eq("id", workspace.id).maybeSingle();
  if (!ws?.live_collab) return OFF;
  const data = await workspaceData(shortId);
  if (!data) return OFF;
  const [{ data: role }, { data: object }] = await Promise.all([
    data.client.rpc("service_object_role", { target_object: objectId }),
    data.client.from("service_objects").select("service, live_viewer_cursors, deleted_at").eq("id", objectId).maybeSingle(),
  ]);
  if (typeof role !== "string" || !object || object.deleted_at || !LIVE_SERVICES.has(object.service)) return OFF;
  const connection = await liveConnection(shortId);
  if (!connection) return OFF;
  const user = await getCurrentUser();
  return {
    enabled: true,
    ...connection,
    role,
    viewerCursors: object.live_viewer_cursors === true,
    me: { id: user.id, name: user.name || user.email.split("@")[0], avatarUrl: user.avatarUrl },
  };
}

// The document's owner or an editor lets viewers and commenters show their cursors.
export async function setLiveViewerCursors(shortId: string, objectId: string, enabled: boolean): Promise<ActionResult> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc("set_live_viewer_cursors", { target_object: objectId, enabled });
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult;
}
