import Link from "next/link";
import { t } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { LoginButton } from "./login-button";

export default async function LoginPage() {
  const supabase = await createClient();
  // Only returned when exactly one domain is active; then Google shows only that domain's accounts.
  const { data: domainHint } = await supabase.rpc("login_domain_hint");

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center">
        <h1 className="text-2xl font-semibold">{t.login.title}</h1>
        <p className="mt-2 text-muted">{t.login.subtitle}</p>
        <div className="mt-6">
          <LoginButton domainHint={domainHint ?? null} />
        </div>
        <Link href="/privacy" className="mt-6 inline-block text-sm text-muted underline">
          {t.privacy.linkLabel}
        </Link>
      </div>
    </main>
  );
}
