"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { t } from "@/i18n";
import { RELEASES } from "@/lib/changelog";

// The sidebar's «What's new» button. It glows (slow gradient pulse) until the
// reader opens the changelog after the latest release; remembered per browser.
const SEEN_KEY = "changelog_seen";
const listeners = new Set<() => void>();

function readSeen() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function markChangelogSeen() {
  try {
    localStorage.setItem(SEEN_KEY, RELEASES[0]?.id ?? "");
  } catch {
    // Private mode: the glow just comes back next time.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function ChangelogLink({ onNavigate, current }: { onNavigate?: () => void; current: boolean }) {
  const latest = RELEASES[0]?.id ?? "";
  // On the server and before hydration: no glow (avoids a flash).
  const fresh = useSyncExternalStore(subscribe, () => Boolean(latest) && readSeen() !== latest, () => false);
  const label = fresh ? `${t.changelog.title} · ${t.changelog.newBadge}` : t.changelog.title;
  return (
    <Link
      href="/changelog"
      onClick={onNavigate}
      title={label}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg hover:bg-surface md:h-9 md:w-9 ${
        current ? "bg-surface" : ""
      } ${fresh ? "ek-news-glow" : ""}`}
    >
      ✨
    </Link>
  );
}
