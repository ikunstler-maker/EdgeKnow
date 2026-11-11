"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { personLabel, type Person } from "@/lib/tasks";
import { listImportPeople, seatImportPerson, type ImportPersonRow } from "@/app/task-actions";

const p = t.tasks.importPeople;
const selectClass = "min-h-11 min-w-0 max-w-full rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";

// People of the tracker the project's tasks came from. Each is a seat: tied to a member,
// the person's tasks become the member's; re-seated, they follow. Shown only when the
// project has such people (and only to its owner and workspace admins).
export function ImportPeople({ projectId, members }: { projectId: string; members: Person[] }) {
  const router = useRouter();
  const [people, setPeople] = useState<ImportPersonRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let alive = true;
    listImportPeople(projectId).then((rows) => alive && setPeople(rows));
    return () => {
      alive = false;
    };
  }, [projectId]);
  if (!people?.length) return null;
  const free = people.filter((x) => !x.user_id).length;
  const seat = (person: ImportPersonRow, member: string | null) => {
    if (member === person.user_id) return;
    const memberName = member ? personLabel(members.find((m) => m.id === member) ?? { id: member, name: null, email: "" }) : null;
    if (!confirm(memberName ? p.confirmSeat(person.name, memberName, person.assigned + person.reported) : p.confirmFree(person.name))) return;
    startTransition(async () => {
      const result = await seatImportPerson(person.id, member);
      if (!result.ok) {
        setNote(null);
        return setError(t.tasks.errors[result.error] ?? t.common.unknownError);
      }
      setError(null);
      setNote(p.moved(result.assigned + result.reported));
      setPeople(await listImportPeople(projectId));
      router.refresh();
    });
  };
  return (
    <section className="space-y-2 border-t border-border pt-4" data-import-people>
      <h3 className="text-sm font-medium">{p.title}</h3>
      <p className="text-xs text-muted" data-import-people-free>
        {p.hint(free, people.length)}
      </p>
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {people.map((person) => (
          <li key={person.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-1 py-1 text-sm" data-import-person={person.name}>
            <span className="min-w-0 flex-1 basis-40">
              <span className="block truncate font-medium">{person.name}</span>
              <span className="block truncate text-xs text-muted">
                {[person.email, p.tasks(person.assigned, person.reported), person.project_role ? t.tasks.roles[person.project_role] : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <select value={person.user_id ?? ""} disabled={pending} onChange={(e) => seat(person, e.target.value || null)} aria-label={p.seatLabel(person.name)} className={selectClass} data-import-person-seat>
              <option value="">{p.notSeated}</option>
              {members
                .filter((m) => !m.guest || m.id === person.user_id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {personLabel(m)}
                  </option>
                ))}
            </select>
          </li>
        ))}
      </ul>
      {note && (
        <p className="text-xs text-muted" role="status" data-import-people-note>
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
