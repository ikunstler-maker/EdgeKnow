"use client";

import { RELEASES } from "@/lib/changelog";

// «What's new» is marked in the workspace menu until the reader opens the
// changelog after the latest release; remembered per browser.
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

export const subscribeChangelog = subscribe;
// True until the reader opens the changelog after the latest release.
export function changelogIsFresh() {
  const latest = RELEASES[0]?.id ?? "";
  return Boolean(latest) && readSeen() !== latest;
}
