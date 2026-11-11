import { t } from "@/i18n";
import { buttonClass } from "@/components/ui/button";

export function SignOutButton({ label = t.common.signOut }: { label?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className={buttonClass("subtle", "md:h-9 px-4")}>
        {label}
      </button>
    </form>
  );
}
