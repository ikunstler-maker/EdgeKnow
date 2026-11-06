"use client";

import { useEffect } from "react";

// A page opened right after "New page" carries ?new=1 (the server waits for the
// database to make it); once it is on screen the mark leaves the address.
export function ClearNewFlag() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("new")) return;
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);
  return null;
}
