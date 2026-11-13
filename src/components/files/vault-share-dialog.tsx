"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { personLabel, type Person } from "@/lib/tasks";
import { canEditVault, type VaultItem, type VaultSharing } from "@/lib/vault";
import { readVaultSharing, setVaultGeneral, setVaultGroupRole, setVaultMemberRole } from "@/app/vault-actions";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

const v = t.vault;
const a = t.vault.access;
const selectClass = "min-h-11 rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
type Grant = "viewer" | "editor";
// General access as one choice: inherit, everyone views, everyone edits, only those listed.
type General = "inherit" | "viewer" | "editor" | "restricted";

// Who has access to a Vault folder or file, as on a shared drive: general access for the
// workspace (inherited from the folder above unless set here), people and units with a
// role. Those who only view see the list; those who edit change it. Guests never appear.
export function VaultShareDialog({ shortId, item, members, groups, onClose }: { shortId: string; item: VaultItem; members: Person[]; groups: { id: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [sharing, setSharing] = useState<VaultSharing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [person, setPerson] = useState("");
  const [personRole, setPersonRole] = useState<Grant>("viewer");
  const [unit, setUnit] = useState("");
  const [unitRole, setUnitRole] = useState<Grant>("viewer");

  const load = useCallback(async () => {
    const result = await readVaultSharing(shortId, item.id);
    if (result.ok) setSharing(result);
    else setError(v.errors[result.error] ?? v.errors.unknown);
  }, [shortId, item.id]);
  useEffect(() => {
    let live = true;
    void readVaultSharing(shortId, item.id).then((result) => {
      if (!live) return;
      if (result.ok) setSharing(result);
      else setError(v.errors[result.error] ?? v.errors.unknown);
    });
    return () => {
      live = false;
    };
  }, [shortId, item.id]);

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : (v.errors[result.error] ?? v.errors.unknown));
      await load();
      router.refresh();
    });

  const edit = canEditVault(sharing?.role);
  const colleagues = members.filter((m) => !m.guest);
  const personOf = new Map(colleagues.map((m) => [m.id, m]));
  const unitName = new Map(groups.map((g) => [g.id, g.name]));
  const listedPeople = new Set([...(sharing?.people ?? []).map((p) => p.user_id), sharing?.owner_id ?? ""]);
  const listedUnits = new Set((sharing?.units ?? []).map((u) => u.group_id));
  // "Restricted" stops everything from above; a role for everyone keeps the people and units given access above.
  const general: General = !sharing ? "inherit" : !sharing.inherit ? (sharing.workspace_role ?? "restricted") : (sharing.workspace_role ?? "inherit");
  const inheritedText = sharing?.inherited_workspace_role === "editor" ? a.workspaceEditor : sharing?.inherited_workspace_role === "viewer" ? a.workspaceViewer : a.inheritNone;
  const setGeneral = (value: General) =>
    run(() => setVaultGeneral(shortId, item.id, value !== "restricted", value === "viewer" || value === "editor" ? value : null));
  const grantOptions = (removable: boolean) => (
    <>
      <option value="viewer">{v.roles.viewer}</option>
      <option value="editor">{v.roles.editor}</option>
      {removable && <option value="">{a.remove}</option>}
    </>
  );

  return (
    <Dialog title={a.title(item.name)} onClose={onClose} width={520}>
      <div className="space-y-5 text-sm" data-vault-share>
        {error && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
            {error}
          </p>
        )}
        {!sharing ? (
          <p className="text-muted">…</p>
        ) : (
          <>
            {!edit && <p className="text-muted">{a.viewOnly}</p>}
            <label className="block space-y-1">
              <span className="font-medium">{a.general}</span>
              <select value={general} disabled={!edit || pending} onChange={(e) => setGeneral(e.target.value as General)} className={`${selectClass} w-full`} data-vault-general>
                <option value="inherit">{a.inherit(inheritedText)}</option>
                <option value="viewer">{a.workspaceViewer}</option>
                <option value="editor">{a.workspaceEditor}</option>
                <option value="restricted">{a.restricted}</option>
              </select>
              <span className="block text-xs text-muted">{a.guests}</span>
            </label>

            <section className="space-y-2 border-t border-border pt-4">
              <p className="font-medium">{a.people}</p>
              {edit && (
                <div className="flex flex-wrap gap-2">
                  <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label={a.people} className={`${selectClass} min-w-0 flex-1`} data-vault-person>
                    <option value="">{a.choosePerson}</option>
                    {colleagues
                      .filter((m) => !listedPeople.has(m.id))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name ? `${m.name} (${m.email})` : m.email}
                        </option>
                      ))}
                  </select>
                  <select value={personRole} onChange={(e) => setPersonRole(e.target.value as Grant)} aria-label={v.roles.editor} className={selectClass} data-vault-person-role>
                    {grantOptions(false)}
                  </select>
                  <Button
                    disabled={!person || pending}
                    onClick={() => {
                      const id = person;
                      setPerson("");
                      run(() => setVaultMemberRole(shortId, item.id, id, personRole));
                    }}
                    data-vault-person-add
                  >
                    {a.add}
                  </Button>
                </div>
              )}
              <ul className="space-y-1">
                {sharing.owner_id && (
                  <li className="flex min-h-11 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{personLabel(personOf.get(sharing.owner_id)) || "—"}</span>
                    <span className="text-muted">{a.owner}</span>
                  </li>
                )}
                {sharing.people.map((p) => (
                  <li key={p.user_id} className="flex min-h-11 items-center gap-2" data-vault-grant={personLabel(personOf.get(p.user_id))}>
                    <span className="min-w-0 flex-1 truncate">{personLabel(personOf.get(p.user_id)) || p.user_id}</span>
                    {edit ? (
                      <select value={p.role} disabled={pending} aria-label={personLabel(personOf.get(p.user_id))} onChange={(e) => run(() => setVaultMemberRole(shortId, item.id, p.user_id, (e.target.value || null) as Grant | null))} className={selectClass}>
                        {grantOptions(true)}
                      </select>
                    ) : (
                      <span className="text-muted">{v.roles[p.role]}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {(groups.length > 0 || sharing.units.length > 0) && (
              <section className="space-y-2 border-t border-border pt-4">
                <p className="font-medium">{a.units}</p>
                {edit && (
                  <div className="flex flex-wrap gap-2">
                    <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={a.units} className={`${selectClass} min-w-0 flex-1`} data-vault-unit>
                      <option value="">{a.chooseUnit}</option>
                      {groups
                        .filter((g) => !listedUnits.has(g.id))
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </select>
                    <select value={unitRole} onChange={(e) => setUnitRole(e.target.value as Grant)} aria-label={v.roles.viewer} className={selectClass}>
                      {grantOptions(false)}
                    </select>
                    <Button
                      disabled={!unit || pending}
                      onClick={() => {
                        const id = unit;
                        setUnit("");
                        run(() => setVaultGroupRole(shortId, item.id, id, unitRole));
                      }}
                    >
                      {a.add}
                    </Button>
                  </div>
                )}
                <ul className="space-y-1">
                  {sharing.units.map((u) => (
                    <li key={u.group_id} className="flex min-h-11 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        <Icon name="users" className="mr-1.5 inline" />
                        {unitName.get(u.group_id) ?? "—"}
                      </span>
                      {edit ? (
                        <select value={u.role} disabled={pending} aria-label={unitName.get(u.group_id)} onChange={(e) => run(() => setVaultGroupRole(shortId, item.id, u.group_id, (e.target.value || null) as Grant | null))} className={selectClass}>
                          {grantOptions(true)}
                        </select>
                      ) : (
                        <span className="text-muted">{v.roles[u.role]}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
