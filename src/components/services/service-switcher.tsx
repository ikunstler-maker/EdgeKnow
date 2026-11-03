"use client";

import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { SERVICES } from "@/lib/services";

const s = t.services;

// Service icons at the top of the sidebar (wrapping onto a second row when narrow): home, the wiki, tasks; the
// ones still being built are greyed out with "Soon".
export function ServiceSwitcher({ shortId, pathname, onNavigate }: { shortId: string; pathname: string; onNavigate?: () => void }) {
  const home = workspacePath(shortId);
  const inTasks = pathname.startsWith(workspacePath(shortId, "/tasks"));
  const cell = "flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg md:h-9 md:w-9";
  return (
    <nav aria-label={s.switcher} className="flex flex-wrap gap-0.5 px-1" data-service-switcher>
      <Link href={home} onClick={onNavigate} title={s.home} aria-label={s.home} aria-current={pathname === home ? "page" : undefined} className={`${cell} ${pathname === home ? "bg-surface" : "hover:bg-surface"}`}>
        🏠
      </Link>
      {SERVICES.map((service) => {
        const item = s.items[service.key];
        if (!service.ready || service.path === null) {
          return (
            <span key={service.key} title={`${item.name} — ${s.soon}`} aria-label={`${item.name} — ${s.soon}`} className={`${cell} cursor-default opacity-35 grayscale`}>
              {service.icon}
            </span>
          );
        }
        const href = service.key === "wiki" ? home : workspacePath(shortId, service.path);
        const inService = (key: string) => pathname.startsWith(workspacePath(shortId, `/${key}`));
        const here = service.key === "wiki" ? !inTasks && pathname.includes("/p/") : inService(service.path.slice(1));
        return (
          <Link key={service.key} href={href} onClick={onNavigate} title={item.name} aria-label={item.name} aria-current={here ? "page" : undefined} className={`${cell} ${here ? "bg-surface" : "hover:bg-surface"}`}>
            {service.icon}
          </Link>
        );
      })}
    </nav>
  );
}
