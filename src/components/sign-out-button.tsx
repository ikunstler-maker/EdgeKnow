import { t } from "@/i18n";

// `icon`: a small door icon for the sidebar's bottom row (the words show on hover).
export function SignOutButton({ label = t.common.signOut, icon = false }: { label?: string; icon?: boolean }) {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        title={icon ? label : undefined}
        aria-label={icon ? label : undefined}
        className={
          icon
            ? "flex h-11 w-11 items-center justify-center rounded-md text-lg hover:bg-surface md:h-9 md:w-9"
            : "min-h-11 rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface"
        }
      >
        {icon ? "🚪" : label}
      </button>
    </form>
  );
}
