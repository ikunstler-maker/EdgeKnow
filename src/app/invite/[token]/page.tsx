import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import { LoginButton } from "@/app/login/login-button";
import { SignOutButton } from "@/components/sign-out-button";

type Preview = { workspace: string; workspace_short_id: string; email: string; valid: boolean };

// Invitation link: shows who invited whom before signing in, then joins on sign-in.
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("invitation_preview", { token });
  const preview = data as Preview | null;

  const { data: claims } = await supabase.auth.getClaims();
  const currentEmail = (claims?.claims?.email as string | undefined)?.toLowerCase() ?? null;

  if (preview && currentEmail === preview.email) {
    // Already signed in with the invited email: accept and go straight in.
    await supabase.rpc("join_workspaces");
    redirect(workspacePath(preview.workspace_short_id));
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center">
        {!preview || !preview.valid ? (
          <>
            <h1 className="text-2xl font-semibold">{t.noAccess.title}</h1>
            <p className="mt-3 text-muted">{t.invite.invalid}</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">{t.invite.title(preview.workspace)}</h1>
            <p className="mt-3 text-muted">{t.invite.forEmail(preview.email)}</p>
            <div className="mt-6 flex justify-center">
              {currentEmail ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm">{t.invite.wrongAccount(currentEmail, preview.email)}</p>
                  <SignOutButton label={t.invite.switchAccount} />
                </div>
              ) : (
                <LoginButton
                  label={t.invite.signIn}
                  loginHint={preview.email}
                  nextPath={workspacePath(preview.workspace_short_id)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
