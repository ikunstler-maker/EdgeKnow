"use server";

import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { CHIP_SERVICES, type ChipService } from "@/lib/chat-chips";

// Smart chips everywhere (UI-1): what the "@" menu offers besides people, pages, tasks and
// events — tables, boards, maps, slides, surveys, apps, wishlists and Vault files the person
// sees. Read with the person's own access (the database's rules), titles matched loosely.

export type ChipTarget =
  | { kind: "object"; service: ChipService; id: string; title: string; icon: string | null }
  | { kind: "file"; id: string; title: string };

export async function searchChipTargets(shortId: string, query: string): Promise<ChipTarget[]> {
  const words = query.trim().slice(0, 100);
  if (words.length < 2) return [];
  const workspace = await getWorkspace(shortId);
  if (!workspace) return [];
  const db = await dataClient(shortId);
  const like = `%${words.replace(/[%_\\,()]/g, " ")}%`;
  const [objects, files] = await Promise.all([
    db
      .from("service_objects")
      .select("id, service, title, icon")
      .eq("workspace_id", workspace.id)
      .in("service", CHIP_SERVICES as unknown as string[])
      .is("deleted_at", null)
      .ilike("title", like)
      .order("updated_at", { ascending: false })
      .limit(12),
    db
      .from("vault_items")
      .select("id, name")
      .eq("workspace_id", workspace.id)
      .eq("kind", "file")
      .is("deleted_at", null)
      .neq("storage_backend", "pending")
      .ilike("name", like)
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);
  return [
    ...((objects.data ?? []) as { id: string; service: ChipService; title: string; icon: string | null }[]).map((o) => ({ kind: "object" as const, service: o.service, id: o.id, title: o.title, icon: o.icon })),
    ...((files.data ?? []) as { id: string; name: string }[]).map((f) => ({ kind: "file" as const, id: f.id, title: f.name })),
  ];
}
