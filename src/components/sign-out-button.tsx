import { t } from "@/i18n";

export function SignOutButton({ label = t.common.signOut }: { label?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface"
      >
        {label}
      </button>
    </form>
  );
}
