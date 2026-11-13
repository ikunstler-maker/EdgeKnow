import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dateLocale, t } from "@/i18n";
import type { Birthday } from "@/lib/calendar";
import { workspacePath } from "@/lib/paths";
import { readWishlist, WISHLIST_GRADIENTS } from "@/lib/wishlist";
import { Icon } from "@/components/ui/icon";

const b = t.calendar.birthdays;
const AHEAD_DAYS = 7;

// The workspace's own today, as "YYYY-MM-DD", in its time zone.
function todayIn(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
const plus = (key: string, days: number) => new Date(Date.parse(`${key}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

// Under the greeting: today's birthdays, and those of the coming week — festive, yet quiet.
// Nothing at all when there are none (and for a guest the database gives none).
export async function BirthdaysBlock({ db, workspaceId, shortId }: { db: SupabaseClient; workspaceId: string; shortId: string }) {
  const { data: settings } = await db.from("calendar_settings").select("time_zone").eq("workspace_id", workspaceId).maybeSingle();
  const today = todayIn((settings?.time_zone as string | undefined) ?? "UTC");
  const { data } = await db.rpc("calendar_birthdays", { ws: workspaceId, first_day: today, last_day: plus(today, AHEAD_DAYS) });
  const list = (data ?? []) as Birthday[];
  if (!list.length) return null;
  const now = list.filter((x) => x.day === today);
  const soon = list.filter((x) => x.day !== today).slice(0, 6);
  const mine = now.some((x) => x.mine);
  const others = now.filter((x) => !x.mine);
  // Published wishlists for exactly these birthdays (the database shows only those one may see).
  const { data: rows } = await db
    .from("service_objects")
    .select("id, owner_id, data")
    .eq("workspace_id", workspaceId)
    .eq("service", "wishlists")
    .is("deleted_at", null)
    .in("owner_id", [...new Set(list.map((x) => x.user_id))]);
  const wishlistOf = new Map<string, { id: string; gradient: string }>();
  for (const row of (rows ?? []) as { id: string; owner_id: string; data: unknown }[]) {
    const d = readWishlist(row.data);
    if (d.published) wishlistOf.set(`${row.owner_id}|${d.birthday}`, { id: row.id, gradient: WISHLIST_GRADIENTS[d.design.gradient] });
  }
  const wishButton = (x: Birthday) => {
    const w = wishlistOf.get(`${x.user_id}|${x.day}`);
    if (!w) return null;
    return (
      <Link
        href={workspacePath(shortId, `/wishlists/${w.id}`)}
        className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 md:min-h-7"
        style={{ background: w.gradient }}
        aria-label={t.wishlists.homeButtonFor(x.mine ? b.mine : x.name)}
        data-home-wishlist
      >
        <Icon name="gift" size={12} />
        {t.wishlists.title}
      </Link>
    );
  };
  const format = new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "numeric", month: "long" });
  const join = (names: string[]) => new Intl.ListFormat(dateLocale(), { type: "conjunction" }).format(names);

  return (
    <section
      aria-labelledby="home-birthdays"
      className="mt-5 overflow-hidden rounded-xl border border-accent/25 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent"
      data-home-birthdays
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden="true">
          <Icon name="gift" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="home-birthdays" className="text-sm font-semibold">
            {now.length ? b.todayHeading : b.soonHeading}
          </h2>
          {mine && (
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm" data-home-birthday-mine>
              {b.todayMine}
              {now.filter((x) => x.mine).map((x) => <span key="mine">{wishButton(x)}</span>)}
            </p>
          )}
          {others.length > 0 && (
            <p className="mt-0.5 text-sm" data-home-birthday-today>
              {b.today(join(others.map((x) => x.name)))}
            </p>
          )}
          {others.some((x) => wishlistOf.has(`${x.user_id}|${x.day}`)) && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {others.map((x) => {
                const button = wishButton(x);
                return button ? (
                  <span key={x.user_id} className="flex items-center gap-1.5 text-sm">
                    {others.length > 1 && <span className="font-medium">{x.name}</span>}
                    {button}
                  </span>
                ) : null;
              })}
            </div>
          )}
          {soon.length > 0 && (
            <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-sm ${now.length ? "mt-2 text-muted" : "mt-1"}`}>
              {soon.map((x) => (
                <li key={`${x.user_id}-${x.day}`} className="flex items-center gap-1.5" data-home-birthday-soon={x.name}>
                  <span className="font-medium text-foreground">{x.mine ? b.mine : x.name}</span>
                  <span className="text-xs text-muted first-letter:uppercase">{format.format(new Date(`${x.day}T00:00:00`))}</span>
                  {wishButton(x)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Link href={workspacePath(shortId, `/calendar?view=list&date=${today}`)} className="hidden shrink-0 self-center text-xs text-muted hover:text-foreground sm:block">
          {b.calendarLink}
        </Link>
      </div>
    </section>
  );
}
