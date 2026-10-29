"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";

type Health = "waking" | "unreachable" | "revoked" | "almost_full" | "full";

// The team's own database isn't fully well (path C, step 1.5b). While it wakes
// up or can't be reached, the page tries again every half a minute.
export function TeamHealthBanner({ health, isOwner, settingsHref }: { health: Health; isOwner: boolean; settingsHref: string }) {
  const router = useRouter();
  useEffect(() => {
    if (health !== "waking" && health !== "unreachable") return;
    const timer = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(timer);
  }, [health, router]);
  const text = t.workspace.teamHealth[health];
  return (
    <p role="status" className="border-b border-border bg-surface px-4 py-2 text-center text-sm">
      {text}
      {isOwner && (health === "revoked" || health === "almost_full" || health === "full") && (
        <>
          {" "}
          <Link href={settingsHref} className="underline">
            {t.workspace.teamHealthOpen}
          </Link>
        </>
      )}
    </p>
  );
}
