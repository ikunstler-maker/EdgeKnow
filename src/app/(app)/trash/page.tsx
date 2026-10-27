import type { Metadata } from "next";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TrashList, type TrashItem } from "./trash-list";

export const metadata: Metadata = { title: `${t.trash.title} · ${t.app.name}` };

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type TrashRow = { id: string; title: string; icon: string | null; deleted_at: string; trashed_with: string };

// Only the pages the user deleted themselves; their subpages come back with them.
function toTrashItems(rows: TrashRow[], now = Date.now()): TrashItem[] {
  const dateFormat = new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium" });
  return rows
    .filter((row) => row.trashed_with === row.id)
    .map((row) => {
      const deletedAt = new Date(row.deleted_at);
      return {
        id: row.id,
        title: row.title || t.pages.untitled,
        icon: row.icon,
        deletedLabel: t.trash.deletedAt(dateFormat.format(deletedAt)),
        daysLeft: Math.ceil((deletedAt.getTime() + RETENTION_DAYS * DAY_MS - now) / DAY_MS),
      };
    });
}

export default async function TrashPage() {
  await getCurrentUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("pages")
    .select("id, title, icon, deleted_at, trashed_with")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .overrideTypes<TrashRow[], { merge: false }>();

  const items = toTrashItems(data ?? []);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold">🗑️ {t.trash.title}</h1>
      <p className="mt-2 text-muted">{t.trash.intro}</p>
      <TrashList items={items} />
    </main>
  );
}
