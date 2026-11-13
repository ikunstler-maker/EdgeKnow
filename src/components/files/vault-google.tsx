"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import { workspacePath } from "@/lib/paths";
import { kindOf } from "@/lib/vault";
import type { BrowseState } from "@/lib/drive/vault-browse";
import { linkDriveFile, setVaultDriveBrowse } from "@/app/vault-actions";
import { Button, buttonClass, iconButtonClass } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";

const v = t.vault;
const g = v.google;
const errorText = (code: string | undefined) => v.errors[code ?? "unknown"] ?? v.errors.unknown;
const KIND_ICONS: Record<string, IconName> = { image: "image", pdf: "file-text", video: "play", audio: "mic", document: "file-text", other: "file" };
const NATIVE = "application/vnd.google-apps.";
const OPENABLE_NATIVE = ["document", "spreadsheet", "presentation", "drawing"].map((x) => `${NATIVE}${x}`);

type Entry = { id: string; name: string; mimeType: string; size: number | null; modifiedTime: string | null; folder: boolean };

// VAULT-7: the team's Google Drive inside Vault. Folders open in place; a file opens,
// downloads or becomes a link in Vault (no copy). The owner keeps the switch and, once,
// allows the Drive to be read.
export function VaultGoogle({
  shortId,
  workspaceId,
  state,
  owner,
  browseOn,
  notice,
}: {
  shortId: string;
  workspaceId: string;
  state: BrowseState;
  owner: boolean;
  browseOn: boolean;
  notice: string | null;
}) {
  return (
    <section className="mt-5 space-y-4" data-vault-google>
      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${notice === "allowed" ? "bg-accent/10" : "bg-danger/10 text-danger"}`} data-vault-google-notice={notice}>
          {g.notices[notice] ?? g.notices.error}
        </p>
      )}
      {owner && <OwnerPanel shortId={shortId} workspaceId={workspaceId} state={state} browseOn={browseOn} />}
      {state.ok ? (
        <Browser shortId={shortId} email={state.email} />
      ) : (
        !owner && <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{memberMessage(state.error)}</p>
      )}
    </section>
  );
}

const memberMessage = (error: string) =>
  error === "off" ? g.off : error === "no_drive" ? g.noDrive : error === "not_allowed" ? g.notAllowedMember : error === "drive_error" ? g.driveError : errorText(error);

function OwnerPanel({ shortId, workspaceId, state, browseOn }: { shortId: string; workspaceId: string; state: BrowseState; browseOn: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Shown at once; put back if the change was refused.
  const [checked, setChecked] = useState(browseOn);
  const toggle = (on: boolean) => {
    setChecked(on);
    start(async () => {
      setError(null);
      const result = await setVaultDriveBrowse(shortId, workspaceId, on);
      if (!result.ok) {
        setChecked(!on);
        setError(errorText(result.error));
      }
      router.refresh();
    });
  };
  return (
    <div className="space-y-3 rounded-xl border border-border p-4 text-sm" data-vault-google-owner>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input type="checkbox" className="h-5 w-5 shrink-0" checked={checked} disabled={pending} onChange={(e) => toggle(e.target.checked)} data-vault-google-switch />
        <span>
          <span className="block font-medium">{g.switchLabel}</span>
          <span className="block text-xs text-muted">{g.switchHint}</span>
        </span>
      </label>
      {checked && !state.ok && state.error === "no_drive" && (
        <p className="flex flex-wrap items-center gap-2 text-muted">
          {g.noDrive}
          <Link href={`${workspacePath(shortId, "/settings")}?tab=data`} className="text-accent hover:underline">
            {g.connectInSettings}
          </Link>
        </p>
      )}
      {browseOn && !state.ok && state.error === "not_allowed" && (
        <div className="space-y-2">
          <p>{g.notAllowed}</p>
          {/* A full page change: Google's screen, then back here. */}
          <a href={`/api/drive/connect?ws=${workspaceId}&browse=1`} className={buttonClass("primary")} data-vault-google-allow>
            {g.allow}
          </a>
          <p className="text-xs text-muted">{g.allowHint}</p>
        </div>
      )}
      {browseOn && !state.ok && state.error === "drive_error" && <p className="text-danger">{g.driveError}</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Browser({ shortId, email }: { shortId: string; email: string }) {
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const folder = path.at(-1)?.id ?? "root";

  type Page = { ok: boolean; entries?: Entry[]; next?: string | null; error?: string } | null;
  const fetchPage = useCallback(
    (page: string | null): Promise<Page> => {
      const query = new URLSearchParams({ ws: shortId, folder, ...(page ? { page } : {}) });
      return fetch(`/api/vault/drive?${query}`)
        .then((response) => response.json() as Promise<Page>)
        .catch(() => null);
    },
    [shortId, folder],
  );
  const apply = useCallback((result: Page, more: boolean) => {
    setLoading(false);
    if (!result?.ok) {
      setError(memberMessage(result?.error ?? "drive_error"));
      if (!more) setEntries([]);
      return;
    }
    setError(null);
    setEntries((had) => (more ? [...(had ?? []), ...(result.entries ?? [])] : (result.entries ?? [])));
    setNext(result.next ?? null);
  }, []);

  useEffect(() => {
    let live = true;
    void fetchPage(null).then((result) => live && apply(result, false));
    return () => {
      live = false;
    };
  }, [fetchPage, apply]);
  const loadMore = () => {
    if (!next) return;
    setLoading(true);
    void fetchPage(next).then((result) => apply(result, true));
  };
  // Another folder: its entries replace these once they arrive.
  const go = (to: { id: string; name: string }[]) => {
    setEntries(null);
    setNext(null);
    setPath(to);
  };

  const add = async (entry: Entry) => {
    setAdding(entry.id);
    setError(null);
    const result = await linkDriveFile(shortId, null, entry.id);
    setAdding(null);
    if (!result.ok) setError(errorText(result.error));
    else setAdded((had) => ({ ...had, [entry.id]: result.id }));
  };

  const when = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(new Date(value));
  const fileSrc = (id: string) => `/api/vault/drive/file?ws=${shortId}&id=${encodeURIComponent(id)}`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {g.intro} {g.account(email)}
      </p>
      <nav aria-label={g.top} className="flex flex-wrap items-center gap-1 text-sm" data-vault-google-path>
        <button type="button" className="min-h-11 rounded-md px-2 font-medium hover:bg-hover md:min-h-8" onClick={() => go([])}>
          {g.top}
        </button>
        {path.map((step, index) => (
          <span key={step.id} className="flex items-center gap-1">
            <Icon name="chevron-right" size={14} />
            <button type="button" className="min-h-11 max-w-[12rem] truncate rounded-md px-2 hover:bg-hover md:min-h-8" onClick={() => go(path.slice(0, index + 1))}>
              {step.name}
            </button>
          </span>
        ))}
      </nav>
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {entries === null ? (
        <p className="py-6 text-center text-sm text-muted">{g.loading}</p>
      ) : entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{g.empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border" data-vault-google-list>
          {entries.map((entry) => {
            const native = entry.mimeType.startsWith(NATIVE);
            const openable = !native || OPENABLE_NATIVE.includes(entry.mimeType);
            return (
              <li key={entry.id} className="flex items-center gap-3 px-3 py-2" data-vault-google-entry={entry.name}>
                <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-hover text-muted">
                  <Icon name={entry.folder ? "folder" : native ? "file-text" : KIND_ICONS[kindOf(entry.mimeType)]} size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  {entry.folder ? (
                    <button type="button" className="block max-w-full truncate text-left text-sm font-medium hover:underline" onClick={() => go([...path, { id: entry.id, name: entry.name }])} data-vault-google-folder>
                      {entry.name}
                    </button>
                  ) : openable ? (
                    <a href={`${fileSrc(entry.id)}&show`} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium hover:underline">
                      {entry.name}
                    </a>
                  ) : (
                    <span className="block truncate text-sm font-medium">{entry.name}</span>
                  )}
                  <span className="block truncate text-xs text-muted">
                    {[entry.folder ? v.folder : native ? g.document : entry.size !== null ? formatBytes(entry.size) : "", entry.modifiedTime ? when(entry.modifiedTime) : ""].filter(Boolean).join(" · ")}
                  </span>
                  {added[entry.id] && (
                    <span role="status" className="block text-xs text-accent">
                      {g.added}{" "}
                      <Link href={`${workspacePath(shortId, "/files")}?file=${added[entry.id]}`} className="underline">
                        {g.showInVault}
                      </Link>
                    </span>
                  )}
                </div>
                {!entry.folder && openable && (
                  <div className="flex shrink-0 items-center gap-1">
                    <a href={fileSrc(entry.id)} className={iconButtonClass("ghost")} aria-label={`${g.download}: ${entry.name}`} title={g.download}>
                      <Icon name="download" size={16} />
                    </a>
                    <Button variant="subtle" icon="plus" disabled={adding !== null || Boolean(added[entry.id])} onClick={() => void add(entry)} data-vault-google-add>
                      <span className="hidden sm:inline">{g.add}</span>
                      <span className="sr-only sm:hidden">{g.add}</span>
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {next && (
        <Button variant="ghost" disabled={loading} onClick={loadMore}>
          {loading ? g.loading : g.more}
        </Button>
      )}
    </div>
  );
}
