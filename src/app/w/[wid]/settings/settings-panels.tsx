"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import type { Workspace } from "@/lib/workspace";
import {
  addDomain,
  deleteWorkspace,
  inviteMember,
  leaveWorkspace,
  removeDomain,
  removeMember,
  renameWorkspace,
  revokeInvitation,
  setDomainActive,
  setMemberRole,
  transferOwnership,
} from "@/app/workspace-actions";

const s = t.settings;

export type MemberItem = {
  userId: string;
  name: string | null;
  email: string;
  role: "owner" | "admin" | "member";
  joinedVia: "creator" | "domain" | "invite";
};
export type DomainItem = { domain: string; isActive: boolean };
export type InvitationItem = { id: string; email: string; role: string; expiresLabel: string };

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

export function GeneralPanel({ workspace, members }: { workspace: Workspace; members: MemberItem[] }) {
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

export function MembersPanel({
  workspace,
  currentUserId,
  members,
  invitations,
}: {
  workspace: Workspace;
  currentUserId: string;
  members: MemberItem[];
  invitations: InvitationItem[];
}) {
  const { pending, run, errorLine } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);

  // The link token is shown only now; the database keeps just its hash.
  const invite = (address: string, inviteRole: string) =>
    run(async () => {
      const result = await inviteMember(workspace.id, address, inviteRole);
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
            invite(email, role);
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
            </select>
          </label>
          <button type="submit" disabled={pending} className={primaryClass}>
            {s.members.inviteButton}
          </button>
        </form>
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
                    {t.workspace.roles[i.role]} · {i.expiresLabel}
                  </span>
                </span>
                <button type="button" disabled={pending} className={buttonClass} onClick={() => invite(i.email, i.role)}>
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
                  </select>
                  <button
                    type="button"
                    disabled={pending}
                    className={`${buttonClass} text-danger`}
                    onClick={() => {
                      if (confirm(s.members.confirmRemove(m.email))) run(() => removeMember(workspace.id, m.userId));
                    }}
                  >
                    {s.members.remove}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
      {errorLine}
    </div>
  );
}

export function DomainsPanel({
  workspaceId,
  domains,
  ownDomain,
}: {
  workspaceId: string;
  domains: DomainItem[];
  ownDomain: string;
}) {
  const { pending, run, errorLine } = useAction();
  const [domain, setDomain] = useState(ownDomain);

  return (
    <section>
      <h2 className="text-lg font-semibold">{s.domains.heading}</h2>
      <p className="mt-1 text-sm text-muted">{s.domains.intro}</p>
      {domains.length === 0 ? (
        <p className="mt-3 text-muted">{s.access.empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {domains.map((d) => (
            <li key={d.domain} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-mono">{d.domain}</span>{" "}
                <span className={d.isActive ? "text-sm text-accent" : "text-sm text-muted"}>
                  · {d.isActive ? s.access.active : s.access.inactive}
                </span>
              </span>
              <button
                type="button"
                disabled={pending}
                className={buttonClass}
                onClick={() => run(() => setDomainActive(workspaceId, d.domain, !d.isActive))}
              >
                {d.isActive ? s.access.disable : s.access.enable}
              </button>
              <button
                type="button"
                disabled={pending}
                className={`${buttonClass} text-danger`}
                onClick={() => {
                  if (confirm(s.access.confirmRemove(d.domain))) run(() => removeDomain(workspaceId, d.domain));
                }}
              >
                {s.access.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => addDomain(workspaceId, domain));
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          {s.access.addLabel}
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
            spellCheck={false}
            placeholder={s.domains.addPlaceholder}
            className={`${inputClass} font-mono`}
          />
        </label>
        <button type="submit" disabled={pending} className={primaryClass}>
          {s.access.addButton}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted">{s.domains.rule(ownDomain)}</p>
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
