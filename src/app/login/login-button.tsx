"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { createClient } from "@/lib/supabase/client";

export function LoginButton({ domainHint }: { domainHint: string | null }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function signIn() {
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          prompt: "select_account",
          ...(domainHint ? { hd: domainHint } : {}),
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
      {pending ? t.login.redirecting : t.login.googleButton}
    </button>
  );
}
