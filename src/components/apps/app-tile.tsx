import Link from "next/link";
import { t } from "@/i18n";
import { appLogoSrc, type AppData } from "@/lib/apps";
import { AppLogo } from "./app-logo";
import { Icon } from "@/components/ui/icon";

// One app in the gallery: a rectangular tile that opens the app in a new tab (never
// with access to this page: noopener, and no address sent along: noreferrer).
// Owners and admins also get a link to the app's settings.
export function AppTile({ shortId, id, title, app, settingsHref }: { shortId: string; id: string; title: string; app: AppData; settingsHref: string | null }) {
  const name = title || t.apps.untitled;
  return (
    <li className="relative flex min-h-28 rounded-xl border border-border bg-surface transition-colors hover:border-border-strong" data-app={name} data-app-id={id}>
      <a
        href={app.url}
        target="_blank"
        rel="noopener noreferrer"
        title={t.apps.openHint(name)}
        className="flex min-w-0 flex-1 items-start gap-4 rounded-xl p-4 pr-14 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <AppLogo src={appLogoSrc(shortId, app)} name={name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold tracking-tight">{name}</span>
          {app.category && <span className="mt-1 inline-block max-w-full truncate rounded-md bg-hover px-1.5 py-0.5 text-[11px] text-muted">{app.category}</span>}
          {app.description && <span className="mt-1 line-clamp-2 block text-sm text-muted">{app.description}</span>}
        </span>
      </a>
      {settingsHref && (
        <Link
          href={settingsHref}
          aria-label={t.apps.settingsOf(name)}
          title={t.apps.settings}
          className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-foreground"
          data-app-settings
        >
          <Icon name="settings" />
        </Link>
      )}
    </li>
  );
}
