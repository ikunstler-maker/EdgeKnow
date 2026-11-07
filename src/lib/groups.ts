// Company structure: a unit is shown with its path ("Company › Marketing › Design"),
// in tree order, wherever a group is picked.
export type GroupRow = { id: string; name: string; parent_id?: string | null; position?: number | null };

export function withPaths<T extends GroupRow>(rows: T[]): (T & { name: string })[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pathOf = (row: T): string[] => {
    const names: string[] = [];
    for (let at: T | undefined = row, i = 0; at && i < 10; at = at.parent_id ? byId.get(at.parent_id) : undefined, i++) names.unshift(at.name);
    return names;
  };
  return rows
    .map((row) => ({ row, path: pathOf(row) }))
    .sort((a, b) => a.path.join("\u0000").localeCompare(b.path.join("\u0000")))
    .map(({ row, path }) => ({ ...row, name: path.join(" › ") }));
}
