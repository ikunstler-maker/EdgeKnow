"use client";

import { useTransition } from "react";
import { t } from "@/i18n";
import { setOpenRegistration } from "@/app/workspace-actions";

export function RegistrationToggle({ open }: { open: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <p className="flex-1 text-sm text-muted">{open ? t.platform.registrationOn : t.platform.registrationOff}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => void (await setOpenRegistration(!open)))}
        className="min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-surface disabled:opacity-60"
      >
        {open ? t.platform.disable : t.platform.enable}
      </button>
    </div>
  );
}
