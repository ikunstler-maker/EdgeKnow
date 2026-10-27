"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { NEXT_PATH_COOKIE } from "@/lib/paths";
import { createClient } from "@/lib/supabase/client";

export function LoginButton({
  domainHint,
  nextPath,
  loginHint,
  label = t.login.googleButton,
}: {
  domainHint?: string | null;
  nextPath?: string | null;
  // Pre-selects this account in Google's chooser (used by invitation links).
  loginHint?: string;
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function signIn() {
    setPending(true);
    // Kept in a short-lived cookie: the callback URL must match the allow-list exactly.
    document.cookie = nextPath
      ? `${NEXT_PATH_COOKIE}=${encodeURIComponent(nextPath)}; path=/; max-age=600; samesite=lax`
      : `${NEXT_PATH_COOKIE}=; path=/; max-age=0`;

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          prompt: "select_account",
          ...(domainHint ? { hd: domainHint } : {}),
          ...(loginHint ? { login_hint: loginHint } : {}),
        },
      },
    });
    if (error) {
      setPending(false);
      router.push("/no-access?reason=signin_failed");
    }
  }

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={pending}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? t.login.redirecting : label}
    </button>
  );
}
