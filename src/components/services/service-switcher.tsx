"use client";

import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { SERVICES } from "@/lib/services";
import { ServiceIcon } from "./service-icon";

const s = t.services;

// Service icons at the top of the sidebar (wrapping onto a second row when narrow): home, the wiki, tasks; the
// ones still being built are greyed out with "Soon".
export function ServiceSwitcher({ shortId, pathname, onNavigate }: { shortId: string; pathname: string; onNavigate?: () => void }) {
  const home = workspacePath(shortId);
  const inTasks = pathname.startsWith(workspacePath(shortId, "/tasks"));
  const cell = "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg md:h-9 md:w-9";
  return (
    <nav aria-label={s.switcher} className="flex flex-wrap gap-0.5 px-1" data-service-switcher>
      <Link prefetch={false} href={home} onClick={onNavigate} title={s.home} aria-label={s.home} aria-current={pathname === home ? "page" : undefined} className={`${cell} ${pathname === home ? "bg-hover" : "hover:bg-hover"}`}>
        <ServiceIcon serviceId="home" size={22} />
      </Link>
      {SERVICES.map((service) => {
        const item = s.items[service.key];
        if (!service.ready || service.path === null) {
          return (
            <span key={service.key} title={`${item.name} — ${s.soon}`} aria-label={`${item.name} — ${s.soon}`} className={`${cell} cursor-default`}>
              <ServiceIcon serviceId={service.key} size={22} muted />
            </span>
          );
        }
        const href = service.key === "wiki" ? home : workspacePath(shortId, service.path);
        const inService = (key: string) => pathname.startsWith(workspacePath(shortId, `/${key}`));
        const here = service.key === "wiki" ? !inTasks && pathname.includes("/p/") : inService(service.path.slice(1));
        return (
          <Link prefetch={false} key={service.key} href={href} onClick={onNavigate} title={item.name} aria-label={item.name} aria-current={here ? "page" : undefined} className={`${cell} ${here ? "bg-hover" : "hover:bg-hover"}`}>
            <ServiceIcon serviceId={service.key} size={22} />
          </Link>
        );
      })}
    </nav>
  );
}
