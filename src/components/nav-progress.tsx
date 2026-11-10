"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// A thin line at the top while the next page is on its way, so a click never looks
// ignored. It only watches clicks on links and the address: pages load exactly as before.
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = `${pathname}?${search}`;
  // The page a link was clicked on; the line shows until the address moves on from it.
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setFrom(`${window.location.pathname}?${window.location.search.replace(/^\?/, "")}`);
      // Never stuck: a navigation that was called off just lets the line go.
      clearTimeout(giveUp);
      giveUp = setTimeout(() => setFrom(null), 8_000);
    };
    // Before the link's own handler (which takes the click over to move without a reload).
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimeout(giveUp);
    };
  }, []);

  const busy = from !== null && from === here;
  if (!busy) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden" role="progressbar" aria-busy="true" data-nav-progress>
      <div className="ek-nav-progress h-full w-1/3 rounded-full bg-accent" />
    </div>
  );
}
