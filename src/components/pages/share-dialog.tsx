"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import type { GrantRole } from "@/lib/pages";
import {
  getPageSharing,
  setPageGroupRole,
  setPageInherit,
  setPageMemberRole,
  setPageWorkspaceRole,
  transferPageOwnership,
  type PageSharing,
  type SharingPerson,
} from "@/app/page-actions";
import { errorMessage, useOptionalPages } from "./pages-provider";
import { Icon } from "@/components/ui/icon";

const GRANT_ROLES: GrantRole[] = ["editor", "commenter", "viewer"];

const personLabel = (person: SharingPerson) => `${person.name || person.email}${person.guest ? ` · ${t.workspace.roles.guest}` : ""}`;

const selectClass =
  "min-h-11 rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
const buttonClass =
  "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";

// "Поділитися": who has access, and for the owner the controls to change it.
export function ShareButton({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
        {t.share.button}
      </button>
      {open && <ShareDialog pageId={pageId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const [sharing, setSharing] = useState<PageSharing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [newMember, setNewMember] = useState("");
  const [newRole, setNewRole] = useState<GrantRole>("viewer");
  const [newOwner, setNewOwner] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [newGroupRole, setNewGroupRole] = useState<GrantRole>("viewer");
  // An invitation to a draft opens only that page: offer the same to the pages inside it.
  const tree = useOptionalPages()?.pages ?? [];
  const isDraft = Boolean(tree.find((p) => p.id === pageId)?.draft);
  const inside = (() => {
    const found: string[] = [];
    let frontier = [pageId];
    while (frontier.length) {
      const next = tree.filter((p) => p.parentId && frontier.includes(p.parentId) && !found.includes(p.id)).map((p) => p.id);
      found.push(...next);
      frontier = next;
    }
    return found;
  })();
  const [offer, setOffer] = useState<{ member: string; role: GrantRole } | null>(null);
  const [offerResult, setOfferResult] = useState<string | null>(null);

  const show = useCallback((result: ActionResult<PageSharing>) => {
    if (result.ok) setSharing(result);
    else setError(errorMessage(result));
  }, []);
  const load = async () => show(await getPageSharing(pageId));

  useEffect(() => {
    let active = true;
    void getPageSharing(pageId).then((result) => active && show(result));
    return () => {
      active = false;
    };
  }, [pageId, show]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await action();
      setError(errorMessage(result));
      await load();
    });

  const isOwner = sharing?.my_role === "owner";
  const listed = new Set(sharing?.entries.filter((e) => e.own).map((e) => e.user_id));
  const addable = sharing?.members.filter((m) => !listed.has(m.user_id)) ?? [];
  const groupsListed = new Set(sharing?.groups.filter((g) => g.own).map((g) => g.group_id));
  const addableGroups = sharing?.all_groups.filter((g) => !groupsListed.has(g.group_id)) ?? [];
  // Only once the workspace has groups: small teams see the dialog as before.
  const showGroups = Boolean(sharing && (sharing.groups.length || sharing.all_groups.length));

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.share.title}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-xl bg-background shadow-xl sm:rounded-xl"
      >
        <div className="flex items-center border-b border-border px-4 py-3">
          <h2 className="flex-1 font-semibold">{t.share.title}</h2>
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
          {!sharing ? (
            !error && <p className="text-sm text-muted">{t.share.loading}</p>
          ) : (
            <>
              {isOwner && (
                <div className="flex flex-wrap gap-2">
                  <select
                    value={newMember}
                    onChange={(event) => setNewMember(event.target.value)}
                    aria-label={t.share.person}
                    className={`${selectClass} min-w-0 flex-1`}
                  >
                    <option value="">{addable.length ? t.share.choosePerson : t.share.nobodyToAdd}</option>
                    {addable.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name ? `${m.name} (${m.email})` : m.email}
                        {m.guest ? ` · ${t.workspace.roles.guest}` : ""}
                      </option>
                    ))}
                  </select>
                  <select
                    value={newRole}
                    onChange={(event) => setNewRole(event.target.value as GrantRole)}
                    aria-label={t.share.role}
                    className={selectClass}
                  >
                    {GRANT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {t.share.roles[role]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!newMember || pending}
                    onClick={() => {
                      const member = newMember;
                      const role = newRole;
                      setNewMember("");
                      setOfferResult(null);
                      run(async () => {
                        const result = await setPageMemberRole(pageId, member, role);
                        if (result.ok && isDraft && inside.length > 0) setOffer({ member, role });
                        return result;
                      });
                    }}
                    className={buttonClass}
                  >
                    {t.share.add}
                  </button>
                </div>
              )}

              {offer && (
                <div className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm" data-share-inside-offer>
                  <p>{t.share.insideOffer(inside.length)}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        const { member, role } = offer;
                        setOffer(null);
                        startTransition(async () => {
                          let done = 0;
                          for (const id of inside) if ((await setPageMemberRole(id, member, role)).ok) done += 1;
                          setOfferResult(t.share.insideDone(done, inside.length));
                          await load();
                        });
                      }}
                      className={buttonClass}
                      data-share-inside-accept
                    >
                      {t.share.insideAccept}
                    </button>
                    <button type="button" onClick={() => setOffer(null)} className={buttonClass}>
                      {t.share.insideDecline}
                    </button>
                  </div>
                </div>
              )}
              {offerResult && (
                <p role="status" className="text-sm text-muted">
                  {offerResult}
                </p>
              )}

              <ul className="space-y-1" aria-label={t.share.people}>
                <li className="flex min-h-11 items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate" title={sharing.owner.email}>
                    {personLabel(sharing.owner)}
                  </span>
                  <span className="text-muted">{t.share.roles.owner}</span>
                </li>
                {sharing.entries.map((entry) => (
                  <li key={entry.user_id} className="flex min-h-11 flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1" title={entry.email}>
                      <span className="block truncate">{personLabel(entry)}</span>
                      {entry.inherited_from && (
                        <span className="block truncate text-xs text-muted">
                          {entry.inherited_title !== null
                            ? t.share.inheritedFrom(entry.inherited_title || t.pages.untitled)
                            : t.share.inheritedFromParent}
                          {" · "}
                          {t.share.roles[entry.role]}
                        </span>
                      )}
                    </span>
                    {isOwner && entry.own ? (
                      <select
                        value={entry.own_role ?? entry.role}
                        disabled={pending}
                        aria-label={t.share.roleOf(personLabel(entry))}
                        onChange={(event) => {
                          const value = event.target.value;
                          run(() =>
                            setPageMemberRole(pageId, entry.user_id, value === "" ? null : (value as GrantRole)),
                          );
                        }}
                        className={selectClass}
                      >
                        {GRANT_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {t.share.roles[role]}
                          </option>
                        ))}
                        <option value="">{t.share.remove}</option>
                      </select>
                    ) : (
                      !entry.inherited_from && <span className="text-muted">{t.share.roles[entry.role]}</span>
                    )}
                  </li>
                ))}
              </ul>

              {showGroups && (
                <div className="space-y-2 border-t border-border pt-4 text-sm">
                  <p className="font-medium">{t.share.groups}</p>
                  <p className="text-xs text-muted">{t.share.groupsReach}</p>
                  {isOwner && (
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={newGroup}
                        onChange={(event) => setNewGroup(event.target.value)}
                        aria-label={t.share.group}
                        className={`${selectClass} min-w-0 flex-1`}
                      >
                        <option value="">{addableGroups.length ? t.share.chooseGroup : t.share.noGroupToAdd}</option>
                        {addableGroups.map((g) => (
                          <option key={g.group_id} value={g.group_id}>
                            {t.share.groupLabel(g.name, g.members)}
                          </option>
                        ))}
                      </select>
                      <select
                        value={newGroupRole}
                        onChange={(event) => setNewGroupRole(event.target.value as GrantRole)}
                        aria-label={t.share.groupRole}
                        className={selectClass}
                      >
                        {GRANT_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {t.share.roles[role]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!newGroup || pending}
                        onClick={() => {
                          const group = newGroup;
                          setNewGroup("");
                          run(() => setPageGroupRole(pageId, group, newGroupRole));
                        }}
                        className={buttonClass}
                      >
                        {t.share.add}
                      </button>
                    </div>
                  )}
                  <ul className="space-y-1" aria-label={t.share.groups}>
                    {sharing.groups.map((group) => (
                      <li key={group.group_id} className="flex min-h-11 flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate"><Icon name="users" className="mr-1.5 inline" />{t.share.groupLabel(group.name, group.members)}</span>
                          {group.inherited_from && (
                            <span className="block truncate text-xs text-muted">
                              {group.inherited_title !== null
                                ? t.share.inheritedFrom(group.inherited_title || t.pages.untitled)
                                : t.share.inheritedFromParent}
                              {" · "}
                              {t.share.roles[group.role]}
                            </span>
                          )}
                        </span>
                        {isOwner && group.own ? (
                          <select
                            value={group.own_role ?? group.role}
                            disabled={pending}
                            aria-label={t.share.roleOf(group.name)}
                            onChange={(event) => {
                              const value = event.target.value;
                              run(() => setPageGroupRole(pageId, group.group_id, value === "" ? null : (value as GrantRole)));
                            }}
                            className={selectClass}
                          >
                            {GRANT_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {t.share.roles[role]}
                              </option>
                            ))}
                            <option value="">{t.share.remove}</option>
                          </select>
                        ) : (
                          !group.inherited_from && <span className="text-muted">{t.share.roles[group.role]}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block">{t.share.workspace}</span>
                  {sharing.inherited_workspace_role && (
                    <span className="block text-xs text-muted">
                      {t.share.inheritedWorkspace(t.share.roles[sharing.inherited_workspace_role])}
                    </span>
                  )}
                </span>
                {isOwner ? (
                  <select
                    value={sharing.workspace_role ?? ""}
                    disabled={pending}
                    aria-label={t.share.workspace}
                    onChange={(event) => {
                      const value = event.target.value;
                      run(() => setPageWorkspaceRole(pageId, value === "" ? null : (value as GrantRole)));
                    }}
                    className={selectClass}
                  >
                    <option value="">{t.share.noAccess}</option>
                    {GRANT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {t.share.roles[role]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-muted">
                    {sharing.workspace_role ? t.share.roles[sharing.workspace_role] : t.share.noAccess}
                  </span>
                )}
              </div>

              {sharing.has_parent && (
                <div className="space-y-2 border-t border-border pt-4 text-sm">
                  <p className="text-muted">{sharing.inherit ? t.share.inherits : t.share.restricted}</p>
                  {isOwner && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => setPageInherit(pageId, !sharing.inherit))}
                      className={buttonClass}
                    >
                      {sharing.inherit ? t.share.restrict : t.share.restoreInherit}
                    </button>
                  )}
                </div>
              )}

              {isOwner && sharing.members.length > 0 && (
                <div className="space-y-2 border-t border-border pt-4 text-sm">
                  <p>{t.share.transferTitle}</p>
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={newOwner}
                      onChange={(event) => setNewOwner(event.target.value)}
                      aria-label={t.share.newOwner}
                      className={`${selectClass} min-w-0 flex-1`}
                    >
                      <option value="">{t.share.choosePerson}</option>
                      {/* A page is never handed to a guest. */}
                      {sharing.members
                        .filter((m) => !m.guest)
                        .map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.name ? `${m.name} (${m.email})` : m.email}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={!newOwner || pending}
                      onClick={() => {
                        const person = sharing.members.find((m) => m.user_id === newOwner);
                        if (!person || !confirm(t.share.transferConfirm(personLabel(person)))) return;
                        setNewOwner("");
                        run(() => transferPageOwnership(pageId, person.user_id));
                      }}
                      className={buttonClass}
                    >
                      {t.share.transfer}
                    </button>
                  </div>
                </div>
              )}

              {!isOwner && <p className="text-sm text-muted">{t.share.onlyOwner}</p>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
