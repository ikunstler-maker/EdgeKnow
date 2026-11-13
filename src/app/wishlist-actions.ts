"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { OBJECT_FILE_COLUMNS, filesHome, readTaskFile, storeTaskFile, workspaceDestination, type StoredFile } from "@/lib/drive/task-files";
import { dataClient, writeClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { isWebLink, readWishlist, WISHLIST_LIMITS, type WishlistData } from "@/lib/wishlist";

// Wishlists (profile, step 2): service objects "wishlists". Every right is checked in the
// database (only the owner changes one; colleagues view a published one); these tidy the
// input and forward the call.

async function call<T extends object = object>(shortId: string, fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/w/[wid]/profile", "page");
  revalidatePath("/w/[wid]/wishlists/[id]", "page");
  return data as ActionResult<T>;
}

const UUID = /^[0-9a-f-]{36}$/;

export type WishlistCard = { id: string; title: string; birthday: string; published: boolean; count: number; design: WishlistData["design"] };

// A person's wishlists in this workspace that the viewer may see (all of one's own; a
// colleague's published ones), newest birthday first.
export async function loadWishlistsOf(shortId: string, workspaceId: string, person: string): Promise<WishlistCard[]> {
  const db = await dataClient(shortId);
  const { data } = await db
    .from("service_objects")
    .select("id, title, data")
    .eq("workspace_id", workspaceId)
    .eq("service", "wishlists")
    .eq("owner_id", person)
    .is("deleted_at", null);
  return ((data ?? []) as { id: string; title: string; data: unknown }[])
    .map((row) => {
      const d = readWishlist(row.data);
      return { id: row.id, title: row.title, birthday: d.birthday, published: d.published, count: d.items.length, design: d.design };
    })
    .sort((a, b) => b.birthday.localeCompare(a.birthday));
}

// A draft for one's next birthday; when there is one already, its id comes back too.
export async function createWishlist(shortId: string): Promise<ActionResult<{ id: string }>> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return { ok: false, error: "forbidden" };
  return call<{ id: string }>(shortId, "create_wishlist", { ws: workspace.id });
}

function clean(title: string, input: WishlistData): { title: string; data: Omit<WishlistData, "birthday" | "published"> } | null {
  const L = WISHLIST_LIMITS;
  const items = input.items.slice(0, L.items).map((i) => ({
    id: String(i.id).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || crypto.randomUUID(),
    title: String(i.title ?? "").trim().slice(0, L.title),
    note: String(i.note ?? "").slice(0, L.note),
    price: String(i.price ?? "").trim().slice(0, L.price),
    links: (i.links ?? []).map((l) => l.trim()).filter(Boolean).slice(0, L.links),
    image: i.image && UUID.test(i.image) ? i.image : null,
  }));
  if (items.some((i) => !i.title || i.links.some((l) => !isWebLink(l)))) return null;
  return { title: title.trim().slice(0, L.listTitle), data: { intro: input.intro.slice(0, L.intro), design: input.design, items } };
}

// The owner saves the title, greeting, look and wishes (the birthday and publication stay).
export async function saveWishlist(shortId: string, id: string, title: string, input: WishlistData, version: number): Promise<ActionResult<{ version: number }>> {
  if (!UUID.test(id)) return { ok: false, error: "invalid" };
  const tidy = clean(title, input);
  if (!tidy) return { ok: false, error: "invalid" };
  return call<{ version: number }>(shortId, "save_service_object", { target_object: id, new_title: tidy.title, new_data: tidy.data, base_version: version });
}

export async function setWishlistPublished(shortId: string, id: string, published: boolean) {
  if (!UUID.test(id)) return { ok: false, error: "invalid" } as ActionResult;
  return call(shortId, "set_wishlist_published", { target: id, published: Boolean(published) });
}

export async function deleteWishlist(shortId: string, id: string) {
  if (!UUID.test(id)) return { ok: false, error: "invalid" } as ActionResult;
  return call(shortId, "delete_wishlist", { target: id });
}

// A copy for the next birthday as a draft; the pictures are copied as new files of the copy.
export async function copyWishlist(shortId: string, id: string): Promise<ActionResult<{ id: string }>> {
  if (!UUID.test(id)) return { ok: false, error: "invalid" };
  const db = await writeClient(shortId);
  const admin = createAdminClient();
  if (!db || !admin) return { ok: false, error: "team_setup" };
  const { data: made, error } = await db.rpc("copy_wishlist", { source: id });
  const result = made as ActionResult<{ id: string }> | null;
  if (error || !result) return { ok: false, error: "unknown" };
  if (!result.ok) return result;
  const copyId = result.id;

  const { data: row } = await db.from("service_objects").select("title, data, version, workspace_id").eq("id", copyId).single();
  const source = readWishlist(row?.data);
  const pictures = source.items.filter((i) => i.image).map((i) => i.image!);
  if (row && pictures.length) {
    const { rows } = await filesHome(admin, row.workspace_id as string);
    const to = await workspaceDestination(admin, row.workspace_id as string);
    const { data: files } = await rows.from("object_files").select(OBJECT_FILE_COLUMNS).eq("object_id", id).in("id", pictures);
    const moved = new Map<string, string>();
    for (const file of (files ?? []) as StoredFile[]) {
      try {
        if ("error" in to) break;
        const bytes = await readTaskFile(admin, rows, file);
        const { data: reg } = await db.rpc("register_object_file", { target_object: copyId, file_name: file.name, file_type: file.mime_type, file_bytes: bytes.length });
        const r = reg as { ok: boolean; id?: string } | null;
        if (!r?.ok || !r.id) continue;
        const { data: fresh } = await rows.from("object_files").select(OBJECT_FILE_COLUMNS).eq("id", r.id).single();
        await storeTaskFile(admin, rows, fresh as StoredFile, bytes, to);
        moved.set(file.id, r.id);
      } catch {
        // A picture that can't be copied is left out of the copy.
      }
    }
    const items = source.items.map((i) => ({ ...i, image: i.image ? (moved.get(i.image) ?? null) : null }));
    await db.rpc("save_service_object", { target_object: copyId, new_title: row.title, new_data: { intro: source.intro, design: source.design, items }, base_version: row.version });
  }
  revalidatePath("/w/[wid]/profile", "page");
  return { ok: true, id: copyId };
}

export type WishlistGift = { item: string; kind: "gives" | "chips_in"; name: string; mine: boolean };

// Who gives what — for colleagues only; the owner gets nothing (the database refuses).
export async function loadWishlistGifts(shortId: string, id: string): Promise<WishlistGift[]> {
  if (!UUID.test(id)) return [];
  const db = await dataClient(shortId);
  const { data } = await db.rpc("wishlist_gifts_of", { target: id });
  const result = data as { ok: boolean; gifts?: WishlistGift[] } | null;
  return result?.ok ? (result.gifts ?? []) : [];
}

// "I'll give this" (one person) or "I'll chip in" (any number).
export async function giveWish(shortId: string, id: string, item: string, kind: "gives" | "chips_in") {
  if (!UUID.test(id) || !/^[a-z0-9-]{1,40}$/.test(item) || (kind !== "gives" && kind !== "chips_in")) return { ok: false, error: "invalid" } as ActionResult;
  return call(shortId, "wishlist_gift", { target: id, item, gift_kind: kind });
}

export async function ungiveWish(shortId: string, id: string, item: string) {
  if (!UUID.test(id) || !/^[a-z0-9-]{1,40}$/.test(item)) return { ok: false, error: "invalid" } as ActionResult;
  return call(shortId, "wishlist_ungift", { target: id, item });
}

// For the owner: which wishes somebody means to give (never who), to warn before removing.
export async function loadClaimedWishes(shortId: string, id: string): Promise<string[]> {
  if (!UUID.test(id)) return [];
  const db = await dataClient(shortId);
  const { data } = await db.rpc("wishlist_claimed_items", { target: id });
  const result = data as { ok: boolean; items?: string[] } | null;
  return result?.ok ? (result.items ?? []) : [];
}

export type WishlistEmbedView = WishlistCard & { ownerName: string };

// One wishlist for an embed (Wika, slides, tasks), read with the viewer's own access:
// null when they may not see it (hidden, a draft of someone else, deleted, a guest).
export async function wishlistEmbedView(shortId: string, id: string): Promise<WishlistEmbedView | null> {
  if (!UUID.test(id)) return null;
  const db = await dataClient(shortId);
  const { data } = await db.from("service_objects").select("id, title, data, owner_id").eq("id", id).eq("service", "wishlists").is("deleted_at", null).maybeSingle();
  if (!data) return null;
  const d = readWishlist(data.data);
  const { data: owner } = await db.from("profiles").select("name, email").eq("id", data.owner_id).maybeSingle();
  return {
    id: data.id as string,
    title: data.title as string,
    birthday: d.birthday,
    published: d.published,
    count: d.items.length,
    design: d.design,
    ownerName: ((owner?.name as string | null) || (owner?.email as string | undefined) || "") as string,
  };
}

// Published wishlists the viewer may see, to pick one for an embed (newest birthday first).
export async function wishlistsForEmbed(shortId: string): Promise<WishlistEmbedView[]> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return [];
  const db = await dataClient(shortId);
  const { data } = await db.from("service_objects").select("id, title, data, owner_id").eq("workspace_id", workspace.id).eq("service", "wishlists").is("deleted_at", null).limit(500);
  const rows = ((data ?? []) as { id: string; title: string; data: unknown; owner_id: string }[]).filter((r) => readWishlist(r.data).published);
  const ids = [...new Set(rows.map((r) => r.owner_id))];
  const { data: people } = ids.length ? await db.from("profiles").select("id, name, email").in("id", ids) : { data: [] };
  const names = new Map(((people ?? []) as { id: string; name: string | null; email: string }[]).map((p) => [p.id, p.name || p.email]));
  return rows
    .map((r) => {
      const d = readWishlist(r.data);
      return { id: r.id, title: r.title, birthday: d.birthday, published: true, count: d.items.length, design: d.design, ownerName: names.get(r.owner_id) ?? "" };
    })
    .sort((a, b) => b.birthday.localeCompare(a.birthday));
}
