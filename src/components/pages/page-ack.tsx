"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { currentLocale, t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { ACK_LABELS, ackCsv, formatAckDate, type AckLabel, type AckRevision, type PageAck } from "@/lib/page-acks";
import { ackPage, disablePageAck, pageAckDetails, pageAckEdition, setPageAck, type AckStats } from "@/app/page-ack-actions";
import { errorMessage } from "./pages-provider";
import { Icon } from "@/components/ui/icon";

const a = t.acks;
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";
const When = ({ iso }: { iso: string }) => (
  <time dateTime={iso} suppressHydrationWarning>
    {formatAckDate(iso, currentLocale())}
  </time>
);

// The quiet mark of a page people sign: a seal next to the meta line, and the state.
export function AckBadge({ ack }: { ack: PageAck }) {
  const signed = Boolean(ack.signedAt);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" data-ack-badge={ack.editing ? "editing" : signed ? "signed" : "open"}>
      {signed && !ack.editing ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-400">
          <Icon name="check" />
          {a.badgeSigned}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-medium text-accent">
          <Icon name="edit" />
          {ack.editing ? a.editingBadge : a.badge}
        </span>
      )}
      <span className="text-muted">
        {a.badgeRevision(ack.revision)} · {a.kinds[ack.label]}
      </span>
    </div>
  );
}

// At the bottom of the page: the button, or when the reader signed.
export function AckPanel({ pageId, ack }: { pageId: string; ack: PageAck }) {
  const router = useRouter();
  const [signedAt, setSignedAt] = useState(ack.signedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <section className="mt-12 rounded-xl border border-accent/30 bg-accent/5 p-4 md:p-5" aria-label={a.title} data-ack-panel>
      {ack.editing ? (
        <p className="text-sm text-muted">{a.editingNote}</p>
      ) : signedAt ? (
        <p className="flex items-center gap-2 text-sm font-medium" data-ack-signed>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" aria-hidden="true">
            <Icon name="check" />
          </span>
          <span>
            {a.signed("")}
            <When iso={signedAt} /> · {a.kinds[ack.label]} · {a.badgeRevision(ack.revision)}
          </span>
        </p>
      ) : (
        <div className="space-y-3">
          <h2 className="font-semibold">{a.askTitle}</h2>
          <p className="text-sm text-muted">{a.askHint}</p>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await ackPage(pageId);
                if (result.ok) {
                  setSignedAt(result.signed_at);
                  router.refresh();
                } else setError(errorMessage(result));
              })
            }
            className="min-h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            data-ack-sign
          >
            <Icon name="edit" className="mr-1 inline" />
            {a.labels[ack.label]}
          </button>
        </div>
      )}
    </section>
  );
}

// For the owner and admins: turn on, statistics, new revisions.
export function AckManageButton({ pageId, ack }: { pageId: string; ack: PageAck | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass} data-ack-manage>
        {a.manage}
      </button>
      {open && <AckDialog pageId={pageId} ack={ack} onClose={() => setOpen(false)} />}
    </>
  );
}

type Details = { stats: AckStats; revisions: AckRevision[]; units: { id: string; name: string }[] };

function AckDialog({ pageId, ack, onClose }: { pageId: string; ack: PageAck | null; onClose: () => void }) {
  const router = useRouter();
  const [details, setDetails] = useState<Details | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [label, setLabel] = useState<AckLabel>(ack?.label ?? "read");
  const [units, setUnits] = useState<string[]>(ack?.groups ?? []);
  const [onlyUnits, setOnlyUnits] = useState(Boolean(ack?.groups.length));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const show = useCallback((result: ActionResult<Details>) => {
    if (result.ok) setDetails(result);
    else setError(errorMessage(result));
  }, []);
  useEffect(() => {
    let live = true;
    void pageAckDetails(pageId, revision).then((r) => live && show(r));
    return () => {
      live = false;
    };
  }, [pageId, revision, show]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = (confirmText: string | null, action: () => Promise<ActionResult>, close = false) => {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      const result = await action();
      setError(errorMessage(result));
      if (!result.ok) return;
      router.refresh();
      if (close) onClose();
      else show(await pageAckDetails(pageId, revision));
    });
  };

  const stats = details?.stats;
  const current = ack?.revision ?? 0;
  const hasSignatures = Boolean(stats?.any_signed);
  const groups = onlyUnits ? units : [];
  const settingsChanged = ack && (label !== ack.label || groups.join() !== ack.groups.join());
  const name = (p: { name: string | null; email: string | null }) => p.name || (p.email ? p.email : a.deletedUser);

  const download = () => {
    if (!stats) return;
    const csv = ackCsv(stats.signed, a.deletedUser, [a.name, a.email, a.when]);
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `confirmations-${pageId.slice(0, 8)}-r${stats.revision}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const settings = (
    <div className="space-y-3">
      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-medium">{a.button}</legend>
        {ACK_LABELS.map((l) => (
          <label key={l} className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
            <input type="radio" name="ack-label" checked={label === l} onChange={() => setLabel(l)} data-ack-label={l} />
            {a.labels[l]}
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-medium">{a.audience}</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
          <input type="radio" name="ack-audience" checked={!onlyUnits} onChange={() => setOnlyUnits(false)} />
          {a.everyone}
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
          <input type="radio" name="ack-audience" checked={onlyUnits} onChange={() => setOnlyUnits(true)} disabled={!details?.units.length} />
          {a.units}
        </label>
        {onlyUnits && (
          <div className="ml-6 max-h-40 space-y-1 overflow-y-auto">
            {details?.units.map((u) => (
              <label key={u.id} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={units.includes(u.id)} onChange={(e) => setUnits(e.target.checked ? [...units, u.id] : units.filter((x) => x !== u.id))} />
                {u.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={a.title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-t-xl bg-background shadow-xl sm:rounded-xl"
        data-ack-dialog
      >
        <div className="flex items-center border-b border-border px-4 py-3">
          <h2 className="flex-1 font-semibold">{a.title}</h2>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="min-h-11 min-w-11">
            <Icon name="close" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {error && (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
              {error}
            </p>
          )}
          {!ack ? (
            <>
              <p className="text-sm text-muted">{a.turnOnHint}</p>
              {settings}
              <button
                type="button"
                disabled={pending || (onlyUnits && !units.length)}
                onClick={() => run(a.turnOnConfirm, () => setPageAck(pageId, label, groups), true)}
                className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60"
                data-ack-turn-on
              >
                {a.turnOn}
              </button>
            </>
          ) : !details ? (
            !error && <p className="text-sm text-muted">{a.loading}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={stats?.revision ?? current}
                  onChange={(e) => setRevision(Number(e.target.value))}
                  aria-label={a.revision}
                  className="min-h-11 rounded-md border border-border bg-background px-2 text-sm md:min-h-9"
                  data-ack-revision
                >
                  {details.revisions.map((r) => (
                    <option key={r.revision} value={r.revision}>
                      {a.revisionOf(r.revision, formatAckDate(r.published_at, currentLocale()))}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={download} disabled={!stats?.signed.length} className={buttonClass} data-ack-csv>
                  {a.exportCsv}
                </button>
              </div>
              {stats && (
                <>
                  <section>
                    <h3 className="mb-2 text-sm font-semibold">{a.signedTitle(stats.signed.length)}</h3>
                    {stats.signed.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm" data-ack-signed-list>
                          <thead className="text-xs text-muted">
                            <tr>
                              <th className="py-1 pr-3 font-medium">{a.name}</th>
                              <th className="py-1 pr-3 font-medium">{a.email}</th>
                              <th className="py-1 font-medium">{a.when}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stats.signed.map((p) => (
                              <tr key={p.user_id} className="border-t border-border" data-ack-person={p.email ?? p.user_id}>
                                <td className={`py-1.5 pr-3 ${p.email ? "" : "italic text-muted"}`}>{name(p)}</td>
                                <td className="break-all py-1.5 pr-3 text-muted">{p.email ?? p.user_id}</td>
                                <td className="whitespace-nowrap py-1.5">
                                  <When iso={p.signed_at} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted">{a.nobody}</p>
                    )}
                  </section>
                  {stats.revision === current && (
                    <section>
                      <h3 className="mb-2 text-sm font-semibold">{a.pendingTitle(stats.pending.length)}</h3>
                      {stats.pending.length ? (
                        <ul className="space-y-1 text-sm" data-ack-pending>
                          {stats.pending.map((p) => (
                            <li key={p.user_id}>
                              {name(p)} <span className="text-muted">{p.email && p.name ? `· ${p.email}` : ""}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted">{a.allDone}</p>
                      )}
                    </section>
                  )}
                  <p className="break-all text-xs text-muted">
                    {a.hash}: {details.revisions.find((r) => r.revision === stats.revision)?.content_hash}
                  </p>
                </>
              )}
              <details className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">{a.button} · {a.audience}</summary>
                <div className="mt-3 space-y-3">
                  {settings}
                  <button type="button" disabled={pending || !settingsChanged || (onlyUnits && !units.length)} onClick={() => run(null, () => setPageAck(pageId, label, groups))} className={buttonClass}>
                    {a.save}
                  </button>
                </div>
              </details>
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                {ack.editing ? (
                  <>
                    <button type="button" disabled={pending} onClick={() => run(a.publishConfirm, () => pageAckEdition(pageId, "publish"), true)} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60" data-ack-publish>
                      {a.publish}
                    </button>
                    <button type="button" disabled={pending} onClick={() => run(a.cancelConfirm, () => pageAckEdition(pageId, "cancel"), true)} className={buttonClass} data-ack-cancel>
                      {a.cancelEdition}
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={pending} onClick={() => run(a.newEditionConfirm, () => pageAckEdition(pageId, "start"), true)} className={buttonClass} data-ack-edition>
                    {a.newEdition}
                  </button>
                )}
                <button
                  type="button"
                  disabled={pending || hasSignatures}
                  title={hasSignatures ? a.turnOffLocked : undefined}
                  onClick={() => run(a.turnOffConfirm, () => disablePageAck(pageId), true)}
                  className={`${buttonClass} text-danger`}
                  data-ack-off
                >
                  {a.turnOff}
                </button>
              </div>
              {hasSignatures && <p className="text-xs text-muted">{a.turnOffLocked}</p>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
