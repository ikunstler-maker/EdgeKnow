"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import type { Person } from "@/lib/tasks";
import { AccessDialog, type ObjectAccess } from "@/components/access/object-access";
import {
  duplicateListObject,
  listObjectAccess,
  renameListObject,
  setListObjectGroupRole,
  setListObjectMemberRole,
  setListObjectWorkspaceRole,
  trashListObject,
} from "@/app/object-list-actions";
import { Icon, type IconName } from "@/components/ui/icon";
import { Popover } from "@/components/ui/popover";

// UI-5: the buttons right of a file's name in a service's list — rename, duplicate, share,
// access and to the bin. Only what the person's role allows is shown (a viewer: share);
// on a phone they sit in one "⋯" menu. The database checks every action again.

const r = t.common.rowActions;
const iconButton = "inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-foreground disabled:opacity-50 md:size-8";

const rank = (role: string | null) => ({ owner: 4, editor: 3, commenter: 2, viewer: 1 })[role ?? ""] ?? 0;

export function ObjectRowActions({ shortId, id, title, href, role }: { shortId: string; id: string; title: string; href: string; role: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(title);
  const [note, setNote] = useState<string | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [access, setAccess] = useState<{ access: ObjectAccess; members: Person[] } | null>(null);
  const canEdit = rank(role) >= 3;
  const isOwner = role === "owner";

  const say = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(null), 2500);
  };
  const run = (action: () => Promise<ActionResult<object>>, done?: (result: ActionResult<object>) => void) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) say(t.nodes.errors[result.error] ?? t.common.unknownError);
      else done?.(result);
      router.refresh();
    });

  // After a change in the access dialog, read it again so the dialog shows what is now set.
  const fresh = async (change: Promise<ActionResult>) => {
    const result = await change;
    const next = await listObjectAccess(shortId, id);
    if (next.ok) setAccess({ access: next.access, members: next.members });
    return result;
  };

  const actions: { key: string; icon: IconName; label: string; onSelect: () => void }[] = [
    ...(canEdit
      ? [
          {
            key: "rename",
            icon: "edit" as const,
            label: r.rename,
            onSelect: () => {
              setName(title);
              setRenaming(true);
            },
          },
          { key: "duplicate", icon: "copy" as const, label: r.duplicate, onSelect: () => run(() => duplicateListObject(shortId, id), () => say(r.duplicated)) },
        ]
      : []),
    {
      key: "share",
      icon: "link",
      label: r.share,
      onSelect: () => void navigator.clipboard?.writeText(`${window.location.origin}${href}`).then(() => say(r.linkCopied), () => {}),
    },
    ...(isOwner
      ? [
          {
            key: "access",
            icon: "users" as const,
            label: r.access,
            onSelect: () =>
              startTransition(async () => {
                const result = await listObjectAccess(shortId, id);
                if (result.ok) setAccess({ access: result.access, members: result.members });
                else say(t.nodes.errors[result.error] ?? t.common.unknownError);
              }),
          },
        ]
      : []),
    ...(canEdit ? [{ key: "bin", icon: "trash" as const, label: r.toBin, onSelect: () => window.confirm(r.toBinConfirm(title)) && run(() => trashListObject(shortId, id)) }] : []),
  ];

  if (renaming)
    return (
      <form
        className="flex w-full items-center gap-1 md:w-auto"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || name.trim() === title) return setRenaming(false);
          run(() => renameListObject(shortId, id, name), () => setRenaming(false));
        }}
        data-row-rename
      >
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && setRenaming(false)}
          maxLength={200}
          aria-label={r.renameField}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-base md:min-h-8 md:w-56 md:text-sm"
        />
        <button type="submit" disabled={pending} className={iconButton} aria-label={r.save} title={r.save} data-row-rename-save>
          <Icon name="check" />
        </button>
        <button type="button" onClick={() => setRenaming(false)} className={iconButton} aria-label={r.cancel} title={r.cancel}>
          <Icon name="close" />
        </button>
      </form>
    );

  return (
    <div className="flex items-center gap-0.5" data-row-actions>
      {note && (
        <span role="status" className="mr-1 text-xs text-muted">
          {note}
        </span>
      )}
      <div className="hidden items-center gap-0.5 md:flex">
        {actions.map((action) => (
          <button key={action.key} type="button" disabled={pending} onClick={action.onSelect} className={iconButton} aria-label={action.label} title={action.label} data-row-action={action.key}>
            <Icon name={action.icon} size={16} />
          </button>
        ))}
      </div>
      <button type="button" onClick={(event) => setMenu(event.currentTarget)} className={`${iconButton} md:hidden`} aria-label={r.more} aria-expanded={Boolean(menu)} data-row-more>
        <Icon name="more" />
      </button>
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={220}>
          <div role="menu" aria-label={r.more}>
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  action.onSelect();
                }}
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover"
              >
                <Icon name={action.icon} size={16} />
                {action.label}
              </button>
            ))}
          </div>
        </Popover>
      )}
      {access && (
        <AccessDialog
          title={r.accessTitle}
          intro={r.accessIntro}
          access={access.access}
          members={access.members}
          viewOnly={false}
          actions={{
            setWorkspaceRole: (value) => fresh(setListObjectWorkspaceRole(shortId, id, value)),
            setMemberRole: (member, value) => fresh(setListObjectMemberRole(shortId, id, member, value)),
            setGroupRole: (group, value) => fresh(setListObjectGroupRole(shortId, id, group, value)),
          }}
          onClose={() => setAccess(null)}
        />
      )}
    </div>
  );
}
