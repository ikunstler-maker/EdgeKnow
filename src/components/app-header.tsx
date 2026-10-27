import Link from "next/link";
import { t } from "@/i18n";
import type { CurrentUser } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

export function AppHeader({ user }: { user: CurrentUser }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-2">
      <Link href="/" className="font-semibold">
        {t.app.name}
      </Link>
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden truncate text-sm text-muted sm:inline">{user.email}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
