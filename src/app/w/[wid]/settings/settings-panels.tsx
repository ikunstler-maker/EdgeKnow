"use client";

import { useCallback, useState, useSyncExternalStore, useTransition } from "react";
import { dateLocale, t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import type { Workspace } from "@/lib/workspace";
import {
  addDomain,
  deleteWorkspace,
  inviteMember,
  leaveWorkspace,
  reassignMemberPages,
  removeDomain,
  removeMember,
  renameWorkspace,
  setPrivateTasksAdmin,
  revokeInvitation,
  setDomainActive,
  setGuestAccessUntil,
  setMemberRole,
  transferOwnership,
} from "@/app/workspace-actions";
import { cancelDomainRequest, requestDomain, verifyDomain } from "@/app/domain-actions";
import { RemoveMemberDialog } from "./remove-member-dialog";

const s = t.settings;

export type MemberItem = {
  userId: string;
  name: string | null;
  email: string;
  role: "owner" | "admin" | "member" | "guest";
  joinedVia: "creator" | "domain" | "invite";
  // A guest's access ends then (ISO), or never (null).
  accessUntil: string | null;
};
export type DomainItem = {
  domain: string;
  isActive: boolean;
  method: "legacy" | "email" | "dns" | "admin";
  dnsMissingSince: string | null;
};
// A domain asked for and waiting for its DNS record.
export type ClaimItem = { domain: string; token: string; checkedAt: string | null; lastError: string | null };
export type InvitationItem = { id: string; email: string; role: string; expiresLabel: string; guestUntil: string | null };
export type DepartedOwner = { userId: string; name: string | null; email: string; pages: number };

const inputClass = "min-h-11 min-w-0 rounded-lg border border-border bg-background px-3 text-base";
const buttonClass =
  "min-h-11 rounded-lg border border-border px-3 text-sm hover:bg-surface disabled:opacity-60";
const primaryClass =
  "min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60";
const dangerClass =
  "min-h-11 rounded-lg bg-danger px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60";

// One pending flag and one error line per panel.
function useAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<ActionResult>, onOk?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setError(null);
        onOk?.();
      } else {
        setError(s.errors[result.error] ?? t.common.unknownError);
      }
    });
  const errorLine = error && (
    <p role="alert" className="mt-3 text-sm text-danger">
      {error}
    </p>
  );
  return { pending, run, errorLine };
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex gap-2">
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} flex-1 font-mono text-sm`} />
      <button
        type="button"
        className={buttonClass}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            // Clipboard blocked: the field is selectable as a fallback.
          }
        }}
      >
        {copied ? s.general.copied : s.general.copy}
      </button>
    </div>
  );
}

const noop = () => () => {};
// The site address, known only in the browser (empty during server rendering).
function useOrigin() {
  return useSyncExternalStore(noop, () => window.location.origin, () => "");
}

export function GeneralPanel({ workspace, members, privateTasksAdmin = false }: { workspace: Workspace; members: MemberItem[]; privateTasksAdmin?: boolean }) {
  const { pending, run, errorLine } = useAction();
  const [name, setName] = useState(workspace.name);
  const [newOwner, setNewOwner] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const isOwner = workspace.role === "owner";
  const origin = useOrigin();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => renameWorkspace(workspace.id, name));
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            {s.general.nameLabel}
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required className={inputClass} />
          </label>
          <button type="submit" disabled={pending || name.trim() === workspace.name} className={primaryClass}>
            {t.common.save}
          </button>
        </form>
        {(workspace.role === "owner" || workspace.role === "admin") && (
          <label className="mt-4 flex min-h-11 items-start gap-2 text-sm md:min-h-9" data-private-tasks-admin>
            <input
              type="checkbox"
              defaultChecked={privateTasksAdmin}
              disabled={pending}
              onChange={(e) => run(() => setPrivateTasksAdmin(workspace.id, e.target.checked))}
              className="mt-1"
            />
            <span>
              {s.general.privateTasksAdmin}
              <span className="block text-xs text-muted">{s.general.privateTasksAdminHint}</span>
            </span>
          </label>
        )}
        <p className="mt-4 text-sm text-muted">
          {s.general.idLabel}: <span className="font-mono">{workspace.shortId}</span>
        </p>
        <p className="mt-4 text-sm">{s.general.loginLink}</p>
        <CopyField value={`${origin}/login?w=${workspace.shortId}`} />
      </section>

      {!isOwner && <p className="text-sm text-muted">{s.general.ownerOnly}</p>}

      {isOwner && (
        <section>
          <h2 className="text-lg font-semibold">{s.general.transferTitle}</h2>
          <p className="mt-1 text-sm text-muted">{s.general.transferIntro}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)} className={`${inputClass} flex-1`}>
              <option value="">{s.general.transferSelect}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name ? `${m.name} (${m.email})` : m.email}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || !newOwner}
              className={buttonClass}
              onClick={() => {
                const email = members.find((m) => m.userId === newOwner)?.email ?? "";
                if (confirm(s.general.confirmTransfer(email))) run(() => transferOwnership(workspace.id, newOwner));
              }}
            >
              {s.general.transferButton}
            </button>
          </div>
        </section>
      )}

      {isOwner && (
        <section className="rounded-lg border border-danger/40 p-4">
          <h2 className="text-lg font-semibold text-danger">{s.general.deleteTitle}</h2>
          <p className="mt-1 text-sm text-muted">{s.general.deleteIntro}</p>
          <label className="mt-3 flex flex-col gap-1 text-sm">
            {s.general.deleteConfirmLabel(workspace.name)}
            <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} className={inputClass} />
          </label>
          <button
            type="button"
            disabled={pending || confirmName.trim() !== workspace.name}
            className={`${dangerClass} mt-3`}
            onClick={() => run(() => deleteWorkspace(workspace.id, confirmName))}
          >
            {s.general.deleteButton}
          </button>
        </section>
      )}
      {errorLine}
    </div>
  );
}

// Dates of a guest's access: a picked day lasts until its end, in the admin's time zone.
const today = () => new Date().toLocaleDateString("sv");
const endOfDay = (day: string) => (day ? new Date(`${day}T23:59:59`).toISOString() : null);
const shortDay = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(new Date(iso));

export function MembersPanel({
  workspace,
  currentUserId,
  members,
  invitations,
  departed,
}: {
  workspace: Workspace;
  currentUserId: string;
  members: MemberItem[];
  invitations: InvitationItem[];
  departed: DepartedOwner[];
}) {
  const { pending, run, errorLine } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [until, setUntil] = useState("");
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [removing, setRemoving] = useState<MemberItem | null>(null);
  const stopRemoving = useCallback(() => setRemoving(null), []);

  // The link token is shown only now; the database keeps just its hash.
  const invite = (address: string, inviteRole: string, guestUntil: string | null = null) =>
    run(async () => {
      const result = await inviteMember(workspace.id, address, inviteRole, guestUntil);
      if (result.ok) {
        setLink({ email: address.trim().toLowerCase(), url: `${window.location.origin}/invite/${result.token}` });
        setEmail("");
      }
      return result;
    });

  const via = { creator: s.members.viaCreator, domain: s.members.viaDomain, invite: s.members.viaInvite };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-lg font-semibold">{s.members.inviteHeading}</h2>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            invite(email, role, role === "guest" ? endOfDay(until) : null);
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            {s.members.inviteEmail}
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {s.members.inviteRole}
            <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
              <option value="member">{t.workspace.roles.member}</option>
              <option value="admin">{t.workspace.roles.admin}</option>
              <option value="guest">{t.workspace.roles.guest}</option>
            </select>
          </label>
          {role === "guest" && (
            <label className="flex flex-col gap-1 text-sm">
              {s.members.inviteUntil}
              <input type="date" suppressHydrationWarning value={until} min={today()} onChange={(e) => setUntil(e.target.value)} className={inputClass} data-guest-until />
            </label>
          )}
          <button type="submit" disabled={pending} className={primaryClass}>
            {s.members.inviteButton}
          </button>
        </form>
        {role === "guest" && <p className="mt-2 text-sm text-muted">{s.members.guestHint}</p>}
        {link && (
          <div className="mt-3 rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm">
            {s.members.inviteCreated(link.email)}
            <CopyField value={link.url} />
          </div>
        )}
      </section>

      {invitations.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">{s.members.pendingHeading}</h2>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{i.email}</span>
                  <span className="block text-xs text-muted">
                    {t.workspace.roles[i.role]}
                    {i.role === "guest" && ` (${i.guestUntil ? s.members.guestUntil(shortDay(i.guestUntil)) : s.members.guestNoEnd})`} · {i.expiresLabel}
                  </span>
                </span>
                <button type="button" disabled={pending} className={buttonClass} onClick={() => invite(i.email, i.role, i.guestUntil)}>
                  {s.members.newLink}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className={`${buttonClass} text-danger`}
                  onClick={() => run(() => revokeInvitation(workspace.id, i.id))}
                >
                  {s.members.revoke}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold">{s.members.heading}</h2>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {m.name ?? m.email}
                  {m.userId === currentUserId && <span className="text-muted"> ({s.members.you})</span>}
                </span>
                <span className="block truncate text-xs text-muted">
                  {m.email} · {via[m.joinedVia]}
                  {m.role === "guest" && (
                    <>
                      {" · "}
                      <span className="rounded bg-surface px-1.5 font-medium text-foreground" data-guest-badge>
                        {t.workspace.roles.guest}
                      </span>{" "}
                      {m.accessUntil ? s.members.guestUntil(shortDay(m.accessUntil)) : s.members.guestNoEnd}
                    </>
                  )}
                </span>
              </span>
              {m.role === "owner" ? (
                <span className="px-3 text-sm text-muted">{t.workspace.roles.owner}</span>
              ) : (
                <>
                  <select
                    value={m.role}
                    disabled={pending}
                    aria-label={s.members.inviteRole}
                    onChange={(e) => run(() => setMemberRole(workspace.id, m.userId, e.target.value))}
                    className={inputClass}
                  >
                    <option value="member">{t.workspace.roles.member}</option>
                    <option value="admin">{t.workspace.roles.admin}</option>
                    <option value="guest">{t.workspace.roles.guest}</option>
                  </select>
                  {m.role === "guest" && (
                    <span className="flex items-center gap-1">
                      <input
                        type="date"
                        suppressHydrationWarning
                        aria-label={`${s.members.accessUntil}: ${m.name ?? m.email}`}
                        value={m.accessUntil ? m.accessUntil.slice(0, 10) : ""}
                        min={today()}
                        disabled={pending}
                        onChange={(e) => e.target.value && run(() => setGuestAccessUntil(workspace.id, m.userId, endOfDay(e.target.value)))}
                        className={inputClass}
                      />
                      {m.accessUntil && (
                        <button type="button" disabled={pending} className={buttonClass} onClick={() => run(() => setGuestAccessUntil(workspace.id, m.userId, null))}>
                          {s.members.noEnd}
                        </button>
                      )}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    className={`${buttonClass} text-danger`}
                    onClick={() => setRemoving(m)}
                  >
                    {s.members.remove}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {departed.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">{s.members.departedHeading}</h2>
          <p className="mt-1 text-sm text-muted">{s.members.departedIntro}</p>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {departed.map((d) => (
              <DepartedRow key={d.userId} workspaceId={workspace.id} owner={d} members={members} run={run} pending={pending} />
            ))}
          </ul>
        </section>
      )}
      {errorLine}
      {removing && (
        <RemoveMemberDialog workspaceId={workspace.id} member={removing} onRemove={() => removeMember(workspace.id, removing.userId)} onClose={stopRemoving} />
      )}
    </div>
  );
}

function DepartedRow({
  workspaceId,
  owner,
  members,
  run,
  pending,
}: {
  workspaceId: string;
  owner: DepartedOwner;
  members: MemberItem[];
  run: (action: () => Promise<ActionResult>) => void;
  pending: boolean;
}) {
  const [to, setTo] = useState("");
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate">{owner.name ?? owner.email}</span>
        <span className="block truncate text-xs text-muted">
          {owner.email} · {s.members.departedPages(owner.pages)}
        </span>
      </span>
      <select value={to} onChange={(e) => setTo(e.target.value)} aria-label={s.members.newOwner} className={inputClass}>
        <option value="">{s.members.chooseOwner}</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name ?? m.email}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!to || pending}
        className={buttonClass}
        onClick={() => {
          const target = members.find((m) => m.userId === to);
          if (target && confirm(s.members.confirmReassign(owner.email, target.email))) {
            run(() => reassignMemberPages(workspaceId, owner.userId, target.userId));
          }
        }}
      >
        {s.members.reassign}
      </button>
    </li>
  );
}

export function DomainsPanel({
  workspaceId,
  domains,
  claims,
  emailWay,
  ownDomain,
}: {
  workspaceId: string;
  domains: DomainItem[];
  claims: ClaimItem[];
  emailWay: boolean;
  ownDomain: string;
}) {
  const { pending, run, errorLine } = useAction();
  const [domain, setDomain] = useState(ownDomain);
  const d = s.domains;
  const normalized = domain.trim().toLowerCase();
  // The old instant way only for one's own email domain, and only while the platform allows it.
  const instant = emailWay && normalized === ownDomain;

  return (
    <section>
      <h2 className="text-lg font-semibold">{d.heading}</h2>
      <p className="mt-1 text-sm text-muted">{d.intro}</p>
      {domains.length === 0 ? (
        <p className="mt-3 text-muted">{s.access.empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {domains.map((item) => (
            <li key={item.domain} className="flex flex-wrap items-center gap-2 px-3 py-2" data-domain={item.domain}>
              <span className="min-w-0 flex-1">
                <span className="font-mono">{item.domain}</span>{" "}
                <span className={item.isActive ? "text-sm text-accent" : "text-sm text-muted"}>
                  · {item.isActive ? s.access.active : s.access.inactive}
                </span>
                <span className="block text-xs text-muted">{d.methods[item.method]}</span>
                {item.dnsMissingSince && (
                  <span role="alert" className="block text-xs text-danger">
                    {d.recordMissing(new Date(item.dnsMissingSince).toLocaleDateString())}
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={pending}
                className={buttonClass}
                onClick={() => run(() => setDomainActive(workspaceId, item.domain, !item.isActive))}
              >
                {item.isActive ? s.access.disable : s.access.enable}
              </button>
              <button
                type="button"
                disabled={pending}
                className={`${buttonClass} text-danger`}
                onClick={() => {
                  if (confirm(s.access.confirmRemove(item.domain))) run(() => removeDomain(workspaceId, item.domain));
                }}
              >
                {s.access.remove}
              </button>
            </li>
          ))}
        </ul>
      )}

      {claims.map((claim) => (
        <div key={claim.domain} className="mt-4 rounded-lg border border-border p-3 text-sm" data-domain-request={claim.domain}>
          <p className="font-medium">
            {d.waitingTitle} <span className="font-mono">{claim.domain}</span>
          </p>
          <p className="mt-1 text-muted">{d.howTo}</p>
          <dl className="mt-2 grid gap-1">
            <dt className="text-muted">{d.recordType}</dt>
            <dd className="font-mono">TXT</dd>
            <dt className="text-muted">{d.recordHost}</dt>
            <dd>
              <CopyField value={`_edgeknow.${claim.domain}`} />
              <span className="text-xs text-muted">{d.recordHostHint}</span>
            </dd>
            <dt className="text-muted">{d.recordValueLabel}</dt>
            <dd>
              <CopyField value={`edgeknow-verify=${claim.token}`} />
            </dd>
          </dl>
          <details className="mt-2">
            <summary className="cursor-pointer text-muted">{d.whereTitle}</summary>
            <ul className="mt-1 list-disc pl-5 text-muted">
              {d.where.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
          <p className="mt-2 text-xs text-muted">{d.waitHint}</p>
          {claim.lastError === "record_not_found" && claim.checkedAt && (
            <p className="mt-1 text-xs text-danger">{d.notFoundYet(new Date(claim.checkedAt).toLocaleString())}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={pending} className={primaryClass} onClick={() => run(() => verifyDomain(workspaceId, claim.domain))}>
              {d.check}
            </button>
            <button type="button" disabled={pending} className={buttonClass} onClick={() => run(() => cancelDomainRequest(workspaceId, claim.domain))}>
              {d.cancelRequest}
            </button>
          </div>
        </div>
      ))}

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => (instant ? addDomain(workspaceId, normalized) : requestDomain(workspaceId, normalized)));
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          {s.access.addLabel}
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
            spellCheck={false}
            placeholder={d.addPlaceholder}
            className={`${inputClass} font-mono`}
          />
        </label>
        <button type="submit" disabled={pending} className={primaryClass}>
          {instant ? s.access.addButton : d.requestButton}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted">{emailWay ? d.rule(ownDomain) : d.ruleDnsOnly}</p>
      {errorLine}
    </section>
  );
}

export function LeaveButton({
  workspaceId,
  workspaceName,
  userId,
}: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
}) {
  const { pending, run, errorLine } = useAction();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className={`${buttonClass} text-danger`}
        onClick={() => {
          if (confirm(s.confirmLeave(workspaceName))) run(() => leaveWorkspace(workspaceId, userId));
        }}
      >
        {s.leave}
      </button>
      {errorLine}
    </>
  );
}
