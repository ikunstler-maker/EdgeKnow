"use client";

import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { deckShowLink, setDeckShowLink } from "@/app/slide-actions";
import { Dialog } from "@/components/ui/dialog";

// KADRY-1: the deck's owner turns its show link on and off, copies it, or makes a new one.
export function ShowLinkDialog({ shortId, deckId, onClose }: { shortId: string; deckId: string; onClose: () => void }) {
  const c = t.slides.publicShow;
  const [link, setLink] = useState<{ enabled: boolean; token: string } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    void deckShowLink(shortId, deckId).then((found) => alive && setLink(found));
    return () => {
      alive = false;
    };
  }, [shortId, deckId]);
  const change = async (on: boolean, renew = false) => {
    setError(null);
    const result = await setDeckShowLink(shortId, deckId, on, renew);
    if (result.ok) setLink({ enabled: result.enabled, token: result.token });
    else setError(t.common.unknownError);
  };
  const url = link?.token && typeof window !== "undefined" ? `${window.location.origin}/s/${shortId}/${link.token}` : "";
  const button = "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9";
  return (
    <Dialog title={c.title} onClose={onClose}>
      <p className="text-sm text-muted">{c.intro}</p>
      {link === undefined ? (
        <p className="mt-3 text-sm text-muted">…</p>
      ) : link?.enabled ? (
        <div className="mt-3 space-y-2" data-show-link="on">
          <p className="text-sm font-medium">{c.on}</p>
          <div className="flex gap-2">
            <input readOnly value={url} className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm md:min-h-9" aria-label={c.title} data-show-link-url />
            <button
              type="button"
              className={button}
              onClick={async () => {
                await navigator.clipboard.writeText(url).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? c.copied : c.copy}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => void change(false)} data-show-link-off>
              {c.turnOff}
            </button>
            <button type="button" className={button} onClick={() => void change(true, true)} data-show-link-renew>
              {c.renew}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2" data-show-link="off">
          <p className="text-sm text-muted">{c.off}</p>
          <button type="button" className={`${button} bg-accent text-white hover:bg-accent/90`} onClick={() => void change(true)} data-show-link-on>
            {c.turnOn}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Dialog>
  );
}
