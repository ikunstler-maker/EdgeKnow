import Link from "next/link";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-3xl font-semibold">{t.home.greeting(user.name ?? user.email)}</h1>
        <p className="mt-3 text-muted">{t.home.placeholder}</p>
        {user.isAdmin && (
          <Link
            href="/settings/access"
            className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 hover:bg-surface"
          >
            {t.home.settingsLink}
          </Link>
        )}
      </main>
    </>
  );
}
