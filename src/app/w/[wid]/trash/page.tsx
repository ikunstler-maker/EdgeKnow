import type { Metadata } from "next";
import { dateLocale, t } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { TrashList, type TrashItem } from "./trash-list";

// Read per request, so the title follows the interface language.
export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.trash.title} · ${t.app.name}` };
}

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type TrashRow = { id: string; title: string; icon: string | null; deleted_at: string; trashed_with: string };

// Only the pages the user deleted themselves; their subpages come back with them.
function toTrashItems(rows: TrashRow[], now = Date.now()): TrashItem[] {
  const dateFormat = () => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" });
  return rows
    .filter((row) => row.trashed_with === row.id)
    .map((row) => {
      const deletedAt = new Date(row.deleted_at);
      return {
        id: row.id,
        title: row.title || t.pages.untitled,
        icon: row.icon,
        deletedLabel: t.trash.deletedAt(dateFormat().format(deletedAt)),
        daysLeft: Math.ceil((deletedAt.getTime() + RETENTION_DAYS * DAY_MS - now) / DAY_MS),
      };
    });
}

export default async function TrashPage({ params }: PageProps<"/w/[wid]/trash">) {
  const workspace = await getWorkspace((await params).wid);
  if (!workspace) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("pages")
    .select("id, title, icon, deleted_at, trashed_with")
    .eq("workspace_id", workspace.id)
    .not("deleted_at", "is", null)
    // Only owners restore or delete, so the trash lists only their pages.
    .eq("my_role", "owner")
    .order("deleted_at", { ascending: false })
    .overrideTypes<TrashRow[], { merge: false }>();

  const items = toTrashItems(data ?? []);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold">🗑️ {t.trash.title}</h1>
      <p className="mt-2 text-muted">{t.trash.intro}</p>
      <TrashList items={items} workspaceShortId={workspace.shortId} />
    </main>
  );
}
