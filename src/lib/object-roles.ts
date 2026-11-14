import "server-only";

// UI-5: the person's role on each object of a list (who may rename, duplicate, share…).
// The same database function the editors ask; the database checks every action again.
export async function rolesOf(db: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }> }, ids: string[]) {
  const found = await Promise.all(ids.map(async (id) => [id, (await db.rpc("service_object_role", { target_object: id })).data] as const));
  return new Map(found.map(([id, role]) => [id, typeof role === "string" ? role : null]));
}
