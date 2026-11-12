"use client";

import { useState, useTransition } from "react";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { deleteRole, saveRole } from "@/app/workspace-actions";
import { Icon } from "@/components/ui/icon";

export const ROLE_PERMISSIONS = ["create_pages", "create_projects", "create_objects", "manage_collections", "manage_fields", "invite", "manage_structure", "manage_leave", "create_open_channels", "create_closed_channels"] as const;
export type RolePermission = (typeof ROLE_PERMISSIONS)[number];
export type RoleItem = {
  id: string;
  builtin: "admin" | "member" | null;
  name: string;
  permissions: Partial<Record<RolePermission, boolean>>;
  contentLevel: "viewer" | "commenter" | "editor" | null;
};

const r = t.settings.roles;
// What members could do before roles (the built-in member row starts from it).
const MEMBER_DEFAULTS: RolePermission[] = ["create_pages", "create_objects", "manage_collections", "create_open_channels", "create_closed_channels"];
const inputClass = "min-h-11 rounded-md border border-border bg-background px-3 text-base md:text-sm";
const buttonClass = "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60";
const primaryClass = "min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-white disabled:opacity-60";

// The built-in rows were seeded in Ukrainian; until renamed they read in the interface language.
export const roleName = (role: Pick<RoleItem, "builtin" | "name">) =>
  role.builtin === "admin" && role.name === "Адміністратор" ? t.workspace.roles.admin : role.builtin === "member" && role.name === "Учасник" ? t.workspace.roles.member : role.name;

const allowed = (role: RoleItem, perm: RolePermission) =>
  role.builtin === "admin" ? true : (role.permissions[perm] ?? MEMBER_DEFAULTS.includes(perm));

// Roles (workspace owner): names, rights in the workspace and the most a holder gets on
// what is open to everyone. Owners and admins keep every right; guests keep their own rules.
export function RolesPanel({ workspaceId, roles }: { workspaceId: string; roles: RoleItem[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RoleItem | null>(null);
  const run = (action: () => Promise<ActionResult>, onOk?: () => void) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : (t.settings.errors[result.error] ?? t.common.unknownError));
      if (result.ok) onOk?.();
    });
  const fresh = (): RoleItem => ({ id: "", builtin: null, name: "", permissions: Object.fromEntries(ROLE_PERMISSIONS.map((p) => [p, MEMBER_DEFAULTS.includes(p)])), contentLevel: null });

  return (
    <section>
      <h2 className="text-lg font-semibold">{r.heading}</h2>
      <p className="mt-1 text-sm text-muted">{r.intro}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="mt-4 space-y-3">
        {roles.map((role) =>
          editing?.id === role.id ? (
            <li key={role.id}>
              <RoleForm role={editing} setRole={setEditing} pending={pending} onSave={(x) => run(() => saveRole(workspaceId, x.id, x.name, x.permissions as Record<string, boolean>, x.contentLevel), () => setEditing(null))} />
            </li>
          ) : (
            <li key={role.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm" data-role={roleName(role)}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{roleName(role)}</span>
                {role.builtin && <span className="text-muted"> · {r.builtin}</span>}
                <span className="block text-xs text-muted">
                  {role.builtin === "admin"
                    ? r.adminAll
                    : ROLE_PERMISSIONS.filter((p) => allowed(role, p))
                        .map((p) => r.permissions[p])
                        .join(", ") || r.noRights}
                  {role.builtin !== "admin" && ` · ${r.levelShort(role.contentLevel ? r.levels[role.contentLevel] : r.noCeiling)}`}
                </span>
              </span>
              <button type="button" className={buttonClass} disabled={pending} onClick={() => setEditing({ ...role, name: roleName(role), permissions: Object.fromEntries(ROLE_PERMISSIONS.map((p) => [p, allowed(role, p)])) })}>
                {r.edit}
              </button>
              {!role.builtin && (
                <button
                  type="button"
                  className={`${buttonClass} text-danger`}
                  disabled={pending}
                  onClick={() => {
                    if (confirm(r.deleteConfirm(role.name))) run(() => deleteRole(workspaceId, role.id));
                  }}
                >
                  {r.delete}
                </button>
              )}
            </li>
          ),
        )}
      </ul>
      {editing?.id === "" ? (
        <div className="mt-3">
          <RoleForm role={editing} setRole={setEditing} pending={pending} onSave={(x) => run(() => saveRole(workspaceId, null, x.name, x.permissions as Record<string, boolean>, x.contentLevel), () => setEditing(null))} />
        </div>
      ) : (
        !editing && (
          <button type="button" className={`${buttonClass} mt-3`} onClick={() => setEditing(fresh())} data-role-add>
            <Icon name="plus" className="mr-1 inline" />
            {r.add}
          </button>
        )
      )}
    </section>
  );
}

function RoleForm({ role, setRole, onSave, pending }: { role: RoleItem; setRole: (role: RoleItem | null) => void; onSave: (role: RoleItem) => void; pending: boolean }) {
  const isAdmin = role.builtin === "admin";
  return (
    <form
      className="space-y-3 rounded-lg border border-accent p-3 text-sm"
      aria-label={role.id ? r.edit : r.add}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(role);
      }}
    >
      <label className="flex flex-col gap-1">
        {r.name}
        <input value={role.name} onChange={(e) => setRole({ ...role, name: e.target.value })} maxLength={60} required placeholder={r.namePlaceholder} className={inputClass} />
      </label>
      {isAdmin ? (
        <p className="text-xs text-muted">{r.adminAll}</p>
      ) : (
        <>
          <fieldset>
            <legend className="mb-1">{r.rights}</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {ROLE_PERMISSIONS.map((perm) => (
                <label key={perm} className="flex min-h-11 items-center gap-2 md:min-h-9">
                  <input type="checkbox" className="h-5 w-5" checked={!!role.permissions[perm]} onChange={(e) => setRole({ ...role, permissions: { ...role.permissions, [perm]: e.target.checked } })} />
                  {r.permissions[perm]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1">
            {r.level}
            <select value={role.contentLevel ?? ""} onChange={(e) => setRole({ ...role, contentLevel: (e.target.value || null) as RoleItem["contentLevel"] })} className={inputClass}>
              <option value="">{r.noCeiling}</option>
              <option value="editor">{r.levels.editor}</option>
              <option value="commenter">{r.levels.commenter}</option>
              <option value="viewer">{r.levels.viewer}</option>
            </select>
            <span className="text-xs text-muted">{r.levelHint}</span>
          </label>
        </>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending || !role.name.trim()} className={primaryClass}>
          {t.common.save}
        </button>
        <button type="button" onClick={() => setRole(null)} className={buttonClass}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
