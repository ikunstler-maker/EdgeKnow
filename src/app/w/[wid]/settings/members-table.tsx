"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { dateLocale, t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import type { Workspace } from "@/lib/workspace";
import {
  removeMember,
  revokeInvitation,
  setGroupLead,
  setGroupMember,
  setGuestAccessUntil,
  setMemberCustomRole,
  setMemberRole,
} from "@/app/workspace-actions";
import type { GroupItem } from "./groups-panel";
import { RemoveMemberDialog } from "./remove-member-dialog";
import { roleName, type RoleItem } from "./roles-panel";
import type { InvitationItem, MemberItem } from "./settings-panels";

const s = t.settings;
const tm = t.settings.team;

export type TeamView = "members" | "structure";
type Chip = "all" | "admins" | "guests" | "pending" | "unassigned";

export const today = () => new Date().toLocaleDateString("sv");
export const endOfDay = (day: string) => (day ? new Date(`${day}T23:59:59`).toISOString() : null);
export const shortDay = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(new Date(iso));

const inputClass = "min-h-11 min-w-0 rounded-lg border border-border bg-background px-3 text-base sm:text-sm";
const buttonClass = "min-h-11 rounded-lg border border-border px-3 text-sm hover:bg-surface disabled:opacity-60";
const PAGE = 25;

// Members ↔ company structure, one tab (Team & structure).
export function TeamViewSwitch({
  view,
  hrefs,
  counts,
}: {
  view: TeamView;
  hrefs: Record<TeamView, string>;
  counts: { members: number; units: number };
}) {
  const item = (key: TeamView, label: string, count: string) => (
    <Link
      href={hrefs[key]}
      aria-current={view === key ? "page" : undefined}
      className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm ${
        view === key ? "bg-accent font-medium text-white" : "text-muted hover:text-foreground"
      }`}
    >
      {label}
      <span className={`rounded-md px-1.5 text-xs ${view === key ? "bg-white/20" : "bg-surface"}`}>{count}</span>
    </Link>
  );
  return (
    <nav aria-label={s.tabs.people} className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-2xl border border-border p-1" data-team-view={view}>
      {item("members", tm.viewMembers, String(counts.members))}
      {item("structure", tm.viewStructure, tm.unitsCount(counts.units))}
    </nav>
  );
}

// Units in tree order with their depth, as in the structure view.
function treeOrder(groups: GroupItem[]) {
  const known = new Set(groups.map((x) => x.id));
  const childrenOf = (id: string | null) =>
    groups
      .filter((x) => (id === null ? !x.parentId || !known.has(x.parentId) : x.parentId === id))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const ordered: { group: GroupItem; depth: number }[] = [];
  const walk = (id: string | null, depth: number) => {
    for (const child of childrenOf(id)) {
      ordered.push({ group: child, depth });
      if (depth < 10) walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  return ordered;
}

// A unit and every unit under it.
function withBranch(groups: GroupItem[], rootId: string) {
  const ids = new Set([rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of groups) {
      if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) {
        ids.add(x.id);
        grew = true;
      }
    }
  }
  return ids;
}

const initials = (m: MemberItem) =>
  (m.name ?? m.email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join("");

export function MembersTable({
  workspace,
  currentUserId,
  members,
  invitations,
  roles,
  groups,
  canSetRoles,
  onReinvite,
  pending: invitePending,
}: {
  workspace: Workspace;
  currentUserId: string;
  members: MemberItem[];
  invitations: InvitationItem[];
  roles: RoleItem[];
  groups: GroupItem[];
  canSetRoles: boolean;
  onReinvite: (email: string, role: string, guestUntil: string | null) => void;
  pending: boolean;
}) {
  const [query, setQuery] = useState("");
  const [unit, setUnit] = useState("all");
  const [chip, setChip] = useState<Chip>("all");
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const [revoking, startRevoke] = useTransition();
  const ordered = useMemo(() => treeOrder(groups), [groups]);
  const custom = roles.filter((x) => !x.builtin);

  const roleLabel = useCallback(
    (m: MemberItem) => {
      if (m.role === "owner" || m.role === "guest") return t.workspace.roles[m.role];
      if (m.role === "member" && m.customRoleId) {
        const own = custom.find((x) => x.id === m.customRoleId);
        if (own) return own.name;
      }
      const row = roles.find((x) => x.builtin === m.role);
      return row ? roleName(row) : t.workspace.roles[m.role];
    },
    [custom, roles],
  );
  const unitsOf = useCallback((userId: string) => groups.filter((x) => x.memberIds.includes(userId)), [groups]);
  const unassigned = (m: MemberItem) => m.role !== "guest" && unitsOf(m.userId).length === 0;

  const counts = {
    all: members.length,
    admins: members.filter((m) => m.role === "owner" || m.role === "admin").length,
    guests: members.filter((m) => m.role === "guest" && m.accessUntil).length,
    pending: invitations.length,
    unassigned: members.filter(unassigned).length,
  };

  const branch = unit !== "all" && unit !== "none" ? withBranch(groups, unit) : null;
  const needle = query.trim().toLowerCase();
  const shown = members.filter((m) => {
    if (chip === "admins" && m.role !== "owner" && m.role !== "admin") return false;
    if (chip === "guests" && !(m.role === "guest" && m.accessUntil)) return false;
    if (chip === "unassigned" && !unassigned(m)) return false;
    if (unit === "none" && !unassigned(m)) return false;
    if (branch && !unitsOf(m.userId).some((x) => branch.has(x.id))) return false;
    if (needle && ![m.name ?? "", m.email, roleLabel(m)].some((x) => x.toLowerCase().includes(needle))) return false;
    return true;
  });
  const shownInvites = invitations.filter((i) => !needle || i.email.toLowerCase().includes(needle));
  const open = members.find((m) => m.userId === openId) ?? null;

  const chips: [Chip, string][] = [
    ["all", tm.chips.all],
    ["admins", tm.chips.admins],
    ["guests", tm.chips.guests],
    ["pending", tm.chips.pending],
    ["unassigned", tm.chips.unassigned],
  ];

  return (
    <section className="flex flex-col gap-3" aria-label={s.members.heading}>
      <h2 className="text-lg font-semibold">{s.members.heading}</h2>
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => (setQuery(e.target.value), setLimit(PAGE))}
          placeholder={tm.search}
          aria-label={tm.search}
          className={`${inputClass} flex-1 basis-56`}
          data-member-search
        />
        <select
          value={unit}
          onChange={(e) => (setUnit(e.target.value), setLimit(PAGE))}
          aria-label={tm.unitFilter}
          className={`${inputClass} max-w-full basis-48`}
          data-unit-filter
        >
          <option value="all">{tm.allUnits}</option>
          {ordered.map(({ group, depth }) => (
            <option key={group.id} value={group.id}>
              {"— ".repeat(depth)}
              {group.name}
            </option>
          ))}
          <option value="none">{tm.noUnit}</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={tm.filters}>
        {chips.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={chip === key}
            onClick={() => (setChip(key), setLimit(PAGE))}
            className={`min-h-11 rounded-full border px-3 text-sm ${
              chip === key
                ? "border-accent bg-accent/15 font-medium text-accent"
                : key === "unassigned" && counts.unassigned > 0
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-border text-muted hover:text-foreground"
            }`}
            data-member-chip={key}
          >
            {key === "unassigned" && "⚠️ "}
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      {chip === "pending" ? (
        shownInvites.length === 0 ? (
          <p className="rounded-2xl border border-border p-4 text-sm text-muted">{tm.empty}</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {shownInvites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{i.email}</span>
                  <span className="block text-xs text-muted">
                    {t.workspace.roles[i.role]}
                    {i.role === "guest" && ` (${i.guestUntil ? s.members.guestUntil(shortDay(i.guestUntil)) : s.members.guestNoEnd})`} · {i.expiresLabel}
                  </span>
                </span>
                <button type="button" disabled={invitePending} className={buttonClass} onClick={() => onReinvite(i.email, i.role, i.guestUntil)}>
                  {s.members.newLink}
                </button>
                <button
                  type="button"
                  disabled={revoking}
                  className={`${buttonClass} text-danger`}
                  onClick={() => startRevoke(async () => void (await revokeInvitation(workspace.id, i.id)))}
                >
                  {s.members.revoke}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-border p-4 text-sm text-muted">{tm.empty}</p>
      ) : (
        <div className="rounded-2xl border border-border">
          <div className="hidden grid-cols-[minmax(0,5fr)_minmax(0,3fr)_minmax(0,4fr)] gap-3 border-b border-border px-3 py-2 text-xs uppercase tracking-wide text-muted md:grid">
            <span>{tm.columns.person}</span>
            <span>{tm.columns.role}</span>
            <span>{tm.columns.units}</span>
          </div>
          <ul className="divide-y divide-border">
            {shown.slice(0, limit).map((m) => {
              const units = unitsOf(m.userId);
              return (
                <li key={m.userId} data-member-row={m.email}>
                  <button
                    type="button"
                    onClick={() => setOpenId(m.userId)}
                    aria-label={tm.open(m.name ?? m.email)}
                    className="grid min-h-11 w-full grid-cols-1 gap-2 px-3 py-2 text-left text-sm hover:bg-surface md:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_minmax(0,4fr)] md:items-center md:gap-3"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold">
                        {initials(m)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate">
                          {m.name ?? m.email}
                          {m.userId === currentUserId && <span className="text-muted"> ({s.members.you})</span>}
                        </span>
                        <span className="block truncate text-xs text-muted">{m.email}</span>
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1 text-xs">
                      {m.role === "guest" ? (
                        <>
                          <span className="rounded bg-surface px-1.5 font-medium" data-guest-badge>
                            {t.workspace.roles.guest}
                          </span>
                          <span className="text-muted">{m.accessUntil ? s.members.guestUntil(shortDay(m.accessUntil)) : s.members.guestNoEnd}</span>
                        </>
                      ) : (
                        <span className="rounded-full border border-border px-2 py-0.5">{roleLabel(m)}</span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-1 text-xs">
                      {units.map((x) => (
                        <span key={x.id} className="rounded border border-border px-1.5 py-0.5">
                          {x.name}
                          {x.leadIds?.includes(m.userId) && <span className="text-amber-700 dark:text-amber-300"> ★ {tm.lead}</span>}
                        </span>
                      ))}
                      {unassigned(m) && (
                        <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">⚠️ {tm.addToUnit}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {shown.length > limit && (
            <div className="border-t border-border p-2">
              <button type="button" className={`${buttonClass} w-full`} onClick={() => setLimit((n) => n + PAGE)}>
                {tm.showMore(Math.min(PAGE, shown.length - limit))}
              </button>
            </div>
          )}
        </div>
      )}

      {open && (
        <MemberDrawer
          key={open.userId}
          workspace={workspace}
          member={open}
          isSelf={open.userId === currentUserId}
          roles={roles}
          canSetRoles={canSetRoles}
          ordered={ordered}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}

// The member's card: role, units and leads, guest end date, sessions.
function MemberDrawer({
  workspace,
  member: m,
  isSelf,
  roles,
  canSetRoles,
  ordered,
  onClose,
}: {
  workspace: Workspace;
  member: MemberItem;
  isSelf: boolean;
  roles: RoleItem[];
  canSetRoles: boolean;
  ordered: { group: GroupItem; depth: number }[];
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const stopRemoving = useCallback(() => setRemoving(false), []);
  const custom = roles.filter((x) => !x.builtin);
  const builtinName = (kind: "admin" | "member") => {
    const row = roles.find((x) => x.builtin === kind);
    return row ? roleName(row) : t.workspace.roles[kind];
  };
  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : (s.errors[result.error] ?? t.common.unknownError));
    });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !removing && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, removing]);

  const changeRole = (value: string) => {
    if (value.startsWith("custom:")) {
      const roleId = value.slice(7);
      return run(async () => {
        if (m.role !== "member") {
          const first = await setMemberRole(workspace.id, m.userId, "member");
          if (!first.ok) return first;
        }
        return setMemberCustomRole(workspace.id, m.userId, roleId);
      });
    }
    if (value === "member" && m.role === "member" && m.customRoleId && canSetRoles) return run(() => setMemberCustomRole(workspace.id, m.userId, null));
    run(() => setMemberRole(workspace.id, m.userId, value));
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => !pending && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tm.drawerHeading}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col bg-background shadow-xl sm:rounded-l-3xl sm:border-l sm:border-border"
        data-member-drawer={m.email}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <span className="text-sm font-medium text-muted">{tm.drawerHeading}</span>
          <button type="button" autoFocus onClick={onClose} aria-label={tm.close} className="flex size-11 items-center justify-center rounded-lg hover:bg-surface">
            ✕
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface font-semibold">
              {initials(m)}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">
                {m.name ?? m.email}
                {isSelf && <span className="font-normal text-muted"> ({s.members.you})</span>}
              </span>
              <span className="block truncate text-sm text-muted">{m.email}</span>
            </span>
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{s.members.inviteRole}</h3>
            {m.role === "owner" ? (
              <p className="text-sm text-muted">
                {t.workspace.roles.owner}. {tm.ownerFixed}
              </p>
            ) : (
              <select
                value={m.role === "member" && m.customRoleId && custom.some((x) => x.id === m.customRoleId) ? `custom:${m.customRoleId}` : m.role}
                disabled={pending}
                aria-label={s.members.inviteRole}
                onChange={(e) => changeRole(e.target.value)}
                className={inputClass}
                data-member-role
              >
                <option value="member">{builtinName("member")}</option>
                {canSetRoles &&
                  custom.map((x) => (
                    <option key={x.id} value={`custom:${x.id}`}>
                      {x.name}
                    </option>
                  ))}
                <option value="admin">{builtinName("admin")}</option>
                <option value="guest">{t.workspace.roles.guest}</option>
              </select>
            )}
            {m.role === "guest" && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  {s.members.accessUntil}
                  <input
                    type="date"
                    suppressHydrationWarning
                    value={m.accessUntil ? m.accessUntil.slice(0, 10) : ""}
                    min={today()}
                    disabled={pending}
                    onChange={(e) => e.target.value && run(() => setGuestAccessUntil(workspace.id, m.userId, endOfDay(e.target.value)))}
                    className={inputClass}
                  />
                </label>
                {m.accessUntil && (
                  <button type="button" disabled={pending} className={buttonClass} onClick={() => run(() => setGuestAccessUntil(workspace.id, m.userId, null))}>
                    {s.members.noEnd}
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{tm.unitsHeading}</h3>
            {m.role === "guest" ? (
              <p className="text-sm text-muted">{tm.guestsNoUnits}</p>
            ) : ordered.length === 0 ? (
              <p className="text-sm text-muted">{tm.noUnitsYet}</p>
            ) : (
              <>
                <p className="text-xs text-muted">{tm.unitsHint}</p>
                <ul className="flex flex-col gap-1">
                  {ordered.map(({ group, depth }) => {
                    const inUnit = group.memberIds.includes(m.userId);
                    const lead = Boolean(group.leadIds?.includes(m.userId));
                    return (
                      <li key={group.id} className="flex flex-wrap items-center gap-x-3 rounded-xl border border-border px-3" style={{ marginLeft: `${Math.min(depth, 7) * 0.75}rem` }}>
                        <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-5"
                            checked={inUnit}
                            disabled={pending}
                            onChange={(e) => run(() => setGroupMember(workspace.id, group.id, m.userId, e.target.checked))}
                            data-unit-member={group.name}
                          />
                          <span className="truncate">{group.name}</span>
                        </label>
                        {inUnit && (
                          <label className="flex min-h-11 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="size-5"
                              checked={lead}
                              disabled={pending}
                              onChange={(e) => run(() => setGroupLead(workspace.id, group.id, m.userId, e.target.checked))}
                              data-unit-lead={group.name}
                            />
                            ★ {tm.lead}
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          <section className="flex flex-col gap-1 rounded-2xl border border-dashed border-border p-3">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              {tm.sessionsHeading}
              <span className="rounded border border-border px-1.5 text-[11px] uppercase text-muted">{t.settings.security.soon}</span>
            </h3>
            <p className="text-xs text-muted">{tm.sessionsSoon}</p>
          </section>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
          {m.role !== "owner" ? (
            <button type="button" disabled={pending} className={`${buttonClass} text-danger`} onClick={() => setRemoving(true)}>
              {s.members.remove}
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={onClose} className={buttonClass}>
            {tm.close}
          </button>
        </div>
        {removing && (
          <RemoveMemberDialog workspaceId={workspace.id} member={m} onRemove={() => removeMember(workspace.id, m.userId)} onClose={stopRemoving} />
        )}
      </div>
    </div>
  );
}
