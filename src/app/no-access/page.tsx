import { t } from "@/i18n";
import { SignOutButton } from "@/components/sign-out-button";

export default async function NoAccessPage({ searchParams }: PageProps<"/no-access">) {
  const { reason } = await searchParams;
  const message = reason === "signin_failed" ? t.noAccess.signInFailed : t.noAccess.domainNotAllowed;

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center">
        <h1 className="text-2xl font-semibold">{t.noAccess.title}</h1>
        <p className="mt-3 text-muted">{message}</p>
        <div className="mt-6 flex justify-center">
          {/* Signs out any leftover session, then lands on /login to pick another account. */}
          <SignOutButton label={t.noAccess.tryAnotherAccount} />
        </div>
      </div>
    </main>
  );
}
