"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import type { MemberCard } from "@/lib/member-card";
import { removeMyAvatar, saveJobTitle, saveMemberBirthdayDate, saveMyName } from "@/app/profile-actions";
import { Icon } from "@/components/ui/icon";
import { buttonClass, iconButtonClass } from "@/components/ui/button";
import { AvatarDialog } from "./avatar-dialog";

const c = t.profile.card;
const fieldClass = "min-h-11 rounded-lg border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
const monthName = (m: number) => new Intl.DateTimeFormat(dateLocale(), { month: "long" }).format(new Date(2000, m - 1, 1));
const birthdayText = (b: { month: number; day: number }) =>
  new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "long" }).format(new Date(2000, b.month - 1, b.day));

export function Avatar({ name, url, size = 64 }: { name: string; url: string | null; size?: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- a small picture from our own route or the sign-in provider
    return <img src={url} alt="" width={size} height={size} referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-accent/15 font-semibold text-accent" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

// One line that turns into a small form; Escape or "Cancel" leaves it as it was.
function InlineText({ value, label, hint, maxLength, onSave, children }: {
  value: string;
  label: string;
  hint?: string;
  maxLength: number;
  onSave: (value: string) => Promise<{ ok: boolean; error?: string }>;
  children: (edit: () => void) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!editing) return <>{children(() => { setDraft(value); setError(null); setEditing(true); })}</>;
  const save = () =>
    startTransition(async () => {
      const result = await onSave(draft);
      if (!result.ok) return setError(c.errors[result.error ?? ""] ?? c.errors.unknown);
      setEditing(false);
    });
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <input
        autoFocus
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        className={`${fieldClass} min-w-0 flex-1`}
      />
      <button type="submit" disabled={pending} className={buttonClass("primary")}>{t.common.save}</button>
      <button type="button" onClick={() => setEditing(false)} className={buttonClass("ghost")}>{t.common.cancel}</button>
      {hint && <p className="w-full text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    </form>
  );
}

// Who manages time off sets a colleague's birthday here: day and month, no year.
function BirthdayEditor({ value, onSave, onDone }: {
  value: { month: number; day: number } | null;
  onSave: (month: number | null, day: number | null) => Promise<{ ok: boolean; error?: string }>;
  onDone: () => void;
}) {
  const [month, setMonth] = useState(value ? String(value.month) : "");
  const [day, setDay] = useState(value ? String(value.day) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const save = (clear = false) =>
    startTransition(async () => {
      const result = clear || !month ? await onSave(null, null) : await onSave(Number(month), Number(day));
      if (!result.ok) return setError(c.errors[result.error ?? ""] ?? c.errors.unknown);
      onDone();
    });
  return (
    <div className="mt-1 space-y-2" data-member-birthday-editor>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-muted">
          {c.day}
          <input type="number" inputMode="numeric" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} className={`${fieldClass} w-20`} />
        </label>
        <label className="flex flex-col text-xs text-muted">
          {c.month}
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={fieldClass}>
            <option value="">—</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{monthName(m)}</option>
            ))}
          </select>
        </label>
        <button type="button" disabled={pending || !!month !== !!day} onClick={() => save()} className={buttonClass("primary")}>{t.common.save}</button>
        {value && <button type="button" disabled={pending} onClick={() => save(true)} className={buttonClass("ghost")}>{c.clear}</button>}
        <button type="button" onClick={onDone} className={buttonClass("ghost")}>{t.common.cancel}</button>
      </div>
      <p className="text-xs text-muted">{c.birthdayOwnerHint}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function Fact({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-3" : ""}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

// Who a person is in this workspace: photo, name, role, job title, units, birthday.
// One's own card edits the name and photo; the job title and a colleague's birthday
// follow what the database allows the viewer.
export function ProfileCard({ card, person, self, shortId, workspaceId, workspaceName, roleLabel, actions }: {
  card: MemberCard;
  person: string;
  self: boolean;
  shortId: string;
  workspaceId: string;
  workspaceName: string;
  roleLabel: string;
  actions?: ReactNode;
}) {
  const router = useRouter();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const refreshAfter = async <T extends { ok: boolean }>(promise: Promise<T>) => {
    const result = await promise;
    if (result.ok) router.refresh();
    return result;
  };
  const ownPhoto = card.avatarUrl?.startsWith("/api/avatar/") ?? false;

  return (
    <header className="rounded-2xl border border-border bg-surface p-5" data-profile-header>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-col items-center gap-1">
          <Avatar name={card.name} url={card.avatarUrl} />
          {self && (
            <div className="flex">
              <button type="button" onClick={() => setPhotoOpen(true)} className={iconButtonClass("ghost")} aria-label={c.changePhoto} title={c.changePhoto} data-avatar-change>
                <Icon name="image" size={14} />
              </button>
              {ownPhoto && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(async () => void (await refreshAfter(removeMyAvatar(workspaceId))))}
                  className={iconButtonClass("ghost")}
                  aria-label={c.removePhoto}
                  title={c.removePhoto}
                  data-avatar-remove
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {self ? (
            <InlineText value={card.name} label={c.nameLabel} hint={c.nameHint} maxLength={80} onSave={(v) => refreshAfter(saveMyName(workspaceId, v))}>
              {(edit) => (
                <h1 className="flex items-center gap-1 text-xl font-semibold tracking-tight">
                  <span className="truncate">{card.name}</span>
                  <button type="button" onClick={edit} className={iconButtonClass("ghost")} aria-label={c.editName} title={c.editName} data-name-edit>
                    <Icon name="edit" size={14} />
                  </button>
                </h1>
              )}
            </InlineText>
          ) : (
            <h1 className="truncate text-xl font-semibold tracking-tight">{card.name}</h1>
          )}
          <div className="mt-0.5">
            {card.canEditTitle ? (
              <InlineText value={card.jobTitle ?? ""} label={c.jobTitle} maxLength={80} onSave={(v) => refreshAfter(saveJobTitle(shortId, workspaceId, person, v))}>
                {(edit) => (
                  <p className="flex items-center gap-1 text-sm">
                    <span className={card.jobTitle ? "min-w-0 break-words" : "text-muted"}>{card.jobTitle ?? c.noJobTitle}</span>
                    <button type="button" onClick={edit} className={iconButtonClass("ghost")} aria-label={card.jobTitle ? c.editJobTitle : c.addJobTitle} title={card.jobTitle ? c.editJobTitle : c.addJobTitle} data-title-edit>
                      <Icon name="edit" size={14} />
                    </button>
                  </p>
                )}
              </InlineText>
            ) : (
              <p className={`text-sm ${card.jobTitle ? "" : "text-muted"}`}>{card.jobTitle ?? c.noJobTitle}</p>
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent">{roleLabel}</span>
            <span className="truncate">{workspaceName}</span>
          </p>
        </div>
        {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-3" data-profile-facts>
        <Fact label={c.departments}>{card.departments.length ? card.departments.join(", ") : <span className="text-muted">{c.noUnits}</span>}</Fact>
        <Fact label={c.teams}>{card.teams.length ? card.teams.join(", ") : <span className="text-muted">—</span>}</Fact>
        {!self && (
          <Fact label={c.birthday} wide={birthdayOpen}>
            {birthdayOpen ? (
              <BirthdayEditor
                value={card.birthday}
                onSave={(m, d) => refreshAfter(saveMemberBirthdayDate(shortId, workspaceId, person, m, d))}
                onDone={() => setBirthdayOpen(false)}
              />
            ) : (
              <span className="flex items-center gap-1">
                {card.birthday ? birthdayText(card.birthday) : <span className="text-muted">{c.noBirthday}</span>}
                {card.canEditBirthday && (
                  <button type="button" onClick={() => setBirthdayOpen(true)} className={iconButtonClass("ghost")} aria-label={c.editBirthday} title={c.editBirthday} data-member-birthday-edit>
                    <Icon name="edit" size={14} />
                  </button>
                )}
              </span>
            )}
          </Fact>
        )}
      </dl>
      {photoOpen && (
        <AvatarDialog
          workspaceId={workspaceId}
          onClose={() => {
            setPhotoOpen(false);
            router.refresh();
          }}
        />
      )}
    </header>
  );
}
