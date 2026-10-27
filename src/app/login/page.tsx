import Link from "next/link";
import { t } from "@/i18n";
import { safeNextPath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import { LoginButton } from "./login-button";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { w, next } = await searchParams;
  const workspaceId = typeof w === "string" ? w : null;
  const nextPath = safeNextPath(typeof next === "string" ? next : null);

  // A "sign in to <workspace>" link with exactly one domain lets Google show only that domain's accounts.
  let domainHint: string | null = null;
  if (workspaceId) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("workspace_login_hint", { ws_short_id: workspaceId });
    domainHint = data ?? null;
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center">
        <h1 className="text-2xl font-semibold">{t.login.title}</h1>
        <p className="mt-2 text-muted">{t.login.subtitle}</p>
        <div className="mt-6">
          <LoginButton domainHint={domainHint} nextPath={nextPath} />
        </div>
        <Link href="/privacy" className="mt-6 inline-block text-sm text-muted underline">
          {t.privacy.linkLabel}
        </Link>
      </div>
    </main>
  );
}
