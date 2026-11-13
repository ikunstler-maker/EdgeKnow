"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { t } from "@/i18n";
import { pagePath, workspacePath } from "@/lib/paths";
import { firstPageId } from "@/lib/pages";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { SERVICE_BRANDS, SERVICE_CATEGORIES, SERVICES, serviceByKey, type ServiceKey } from "@/lib/services";
import { Popover } from "@/components/ui/popover";
import { Icon } from "@/components/ui/icon";
import { ServiceIcon } from "./service-icon";

const s = t.services;

// Which services sit in the dock is each person's own choice, kept in the browser.
const PINS_KEY = "ek-service-pins";
const DEFAULT_PINS: ServiceKey[] = ["wiki", "tasks", "calendar"];
const pinListeners = new Set<() => void>();
let pinsCache: { raw: string | null; list: ServiceKey[] } = { raw: null, list: DEFAULT_PINS };
function readPins(): ServiceKey[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PINS_KEY);
  } catch {}
  if (raw === pinsCache.raw) return pinsCache.list;
  let list = DEFAULT_PINS;
  try {
    const saved = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(saved)) list = SERVICES.map((x) => x.key).filter((key) => saved.includes(key));
  } catch {}
  pinsCache = { raw, list };
  return list;
}
function savePins(list: ServiceKey[]) {
  try {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(list));
  } catch {}
  pinListeners.forEach((notify) => notify());
}
const subscribePins = (onChange: () => void) => {
  pinListeners.add(onChange);
  return () => pinListeners.delete(onChange);
};

// The service the person is in, if any ("wiki" for pages).
export function currentService(pathname: string, shortId: string): ServiceKey | null {
  const first = pathname.slice(workspacePath(shortId).length).split("/")[1] ?? "";
  if (first === "p") return "wiki";
  return SERVICES.find((service) => service.path === `/${first}` && first !== "")?.key ?? null;
}

// The dock of pinned services with the button that opens the whole list in its
// four groups (also Ctrl/Cmd+E). Services still being built show as "Soon".
export function ServiceSwitcher({ shortId, userId, pathname, onNavigate, vertical = false }: { shortId: string; userId: string; pathname: string; onNavigate?: () => void; vertical?: boolean }) {
  const home = workspacePath(shortId);
  // Wika opens the page at the top of the tree (the home page while there is none).
  const pages = useOptionalPages()?.pages;
  const firstPage = pages ? firstPageId(pages, userId) : null;
  const wiki = firstPage ? pagePath(shortId, firstPage) : home;
  const here = currentService(pathname, shortId);
  const pins = useSyncExternalStore(subscribePins, readPins, () => DEFAULT_PINS);
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "e") return;
      // In a text being edited the keys belong to the editor (inline code there).
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      // The panel is drawn twice on a phone's drawer; only the visible one answers.
      if (!button.current || button.current.offsetParent === null) return;
      event.preventDefault();
      setAnchor((open) => (open ? null : button.current));
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const hrefOf = (key: ServiceKey) => (key === "wiki" ? wiki : workspacePath(shortId, serviceByKey(key).path ?? ""));
  const go = () => {
    setAnchor(null);
    onNavigate?.();
  };
  // The dock: the pinned ones, plus the service being used right now.
  const dock = SERVICES.filter((service) => service.ready && (pins.includes(service.key) || service.key === here));
  const cell = (on: boolean) => `flex h-11 w-11 shrink-0 items-center justify-center rounded-lg md:h-8 md:w-8 ${on ? "bg-hover" : "hover:bg-hover"}`;

  return (
    <nav aria-label={s.switcher} className={`flex gap-0.5 ${vertical ? "flex-col items-center" : "flex-wrap items-center px-1"}`} data-service-switcher>
      <Link prefetch={false} href={home} onClick={onNavigate} title={s.home} aria-label={s.home} aria-current={pathname === home ? "page" : undefined} className={cell(pathname === home)}>
        <ServiceIcon serviceId="home" size={22} />
      </Link>
      {dock.map((service) => {
        const name = s.items[service.key].name;
        const label = `${SERVICE_BRANDS[service.key].name} · ${name}`;
        return (
          <Link prefetch={false} key={service.key} href={hrefOf(service.key)} onClick={onNavigate} title={label} aria-label={name} aria-current={service.key === here ? "page" : undefined} className={cell(service.key === here)}>
            <ServiceIcon serviceId={service.key} size={22} />
          </Link>
        );
      })}
      <button
        ref={button}
        type="button"
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        aria-label={s.all}
        aria-expanded={Boolean(anchor)}
        title={`${s.all} (Ctrl+E)`}
        className={`${cell(Boolean(anchor))} text-muted hover:text-foreground ${vertical ? "" : "ml-auto"}`}
        data-service-menu-button
      >
        <Icon name="grid" size={18} />
      </button>

      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={300}>
          <div data-service-menu>
            {SERVICE_CATEGORIES.map((category) => (
              <section key={category.key} aria-label={s.categories[category.key]} className="pb-1">
                <h3 className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">{s.categories[category.key]}</h3>
                <ul>
                  {category.services.map((key) => {
                    const service = serviceByKey(key);
                    const name = s.items[key].name;
                    const pinned = pins.includes(key);
                    const row = (
                      <>
                        <ServiceIcon serviceId={key} size={26} muted={!service.ready} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium leading-tight">{SERVICE_BRANDS[key].name}</span>
                          <span className="block truncate text-xs text-muted">{name}</span>
                        </span>
                      </>
                    );
                    return (
                      <li key={key} className="flex items-center gap-0.5">
                        {service.ready ? (
                          <Link prefetch={false} href={hrefOf(key)} onClick={go} aria-label={name} aria-current={key === here ? "page" : undefined} className={`flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 ${key === here ? "bg-hover" : "hover:bg-hover"}`}>
                            {row}
                          </Link>
                        ) : (
                          <span aria-label={`${name} — ${s.soon}`} className="flex min-h-11 min-w-0 flex-1 cursor-default items-center gap-2.5 px-2.5 opacity-70">
                            {row}
                            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">{s.soon}</span>
                          </span>
                        )}
                        {service.ready && (
                          <button
                            type="button"
                            aria-pressed={pinned}
                            aria-label={pinned ? s.unpin(name) : s.pin(name)}
                            title={pinned ? s.unpin(name) : s.pin(name)}
                            onClick={() => savePins(pinned ? pins.filter((x) => x !== key) : [...pins, key])}
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-hover md:h-8 md:w-8 ${pinned ? "text-accent" : "text-muted"}`}
                          >
                            <Icon name="pin" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </Popover>
      )}
    </nav>
  );
}
