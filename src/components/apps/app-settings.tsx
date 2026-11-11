"use client";

import { t } from "@/i18n";
import type { AppData } from "@/lib/apps";
import type { Person } from "@/lib/tasks";
import { ObjectAccessButton, type ObjectAccess } from "@/components/access/object-access";
import { setAppGroupRole, setAppMemberRole, setAppWorkspaceRole } from "@/app/app-actions";
import { AppForm, AppTrashButton } from "./app-form";

// An app's settings for owners and admins: its fields, who sees it, the bin.
export function AppSettings({
  shortId,
  id,
  version,
  title,
  app,
  categories,
  access,
  members,
}: {
  shortId: string;
  id: string;
  version: number;
  title: string;
  app: AppData;
  categories: string[];
  access: ObjectAccess;
  members: Person[];
}) {
  const s = t.apps;
  return (
    <section aria-label={s.settings} className="mt-8 rounded-xl border border-border p-4" data-app-settings-form>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-lg font-semibold">{s.settings}</h2>
        <ObjectAccessButton
          label={s.access}
          title={s.accessTitle}
          intro={s.accessIntro}
          access={access}
          members={members}
          viewOnly
          actions={{
            setWorkspaceRole: (r) => setAppWorkspaceRole(shortId, id, r),
            setMemberRole: (member, r) => setAppMemberRole(shortId, id, member, r),
            setGroupRole: (group, r) => setAppGroupRole(shortId, id, group, r),
          }}
        />
        <AppTrashButton shortId={shortId} id={id} />
      </div>
      <AppForm key={version} shortId={shortId} saved={{ id, version }} initialTitle={title} initial={app} categories={categories} onDone={() => {}} />
    </section>
  );
}
