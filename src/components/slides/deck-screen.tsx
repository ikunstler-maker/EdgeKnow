"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { readDeck, type Deck } from "@/lib/slides";
import { workspacePath } from "@/lib/paths";
import type { Person } from "@/lib/tasks";
import { ObjectAccessButton, type ObjectAccess } from "@/components/access/object-access";
import { saveDeck, setDeckGroupRole, setDeckMemberRole, setDeckWorkspaceRole, trashDeck } from "@/app/slide-actions";
import { DeckEditor } from "./deck-editor";

const s = t.slides;
const buttonClass = "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9";

// One presentation: its name, the save status, access and the editor. Changes are
// saved about a second after the last one; a save that finds a newer version stops
// and asks to reload (as tables do).
export function DeckScreen({
  shortId,
  id,
  initialTitle,
  initialData,
  initialVersion,
  role,
  access,
  members,
}: {
  shortId: string;
  id: string;
  initialTitle: string;
  initialData: unknown;
  initialVersion: number;
  role: string;
  access: ObjectAccess | null;
  members: Person[];
}) {
  const router = useRouter();
  const canEdit = role === "owner" || role === "editor";
  const [title, setTitle] = useState(initialTitle);
  const [initial] = useState(() => readDeck(initialData));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "conflict" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const version = useRef(initialVersion);
  const pending = useRef<{ title: string | null; data: Deck | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  const flush = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    while (pending.current) {
      const next = pending.current;
      pending.current = null;
      setStatus("saving");
      const result = await saveDeck(shortId, id, next.title, next.data, version.current).catch(() => null);
      if (result?.ok) {
        version.current = result.version;
        setStatus("saved");
        setError(null);
        continue;
      }
      if (result && !result.ok && result.error === "conflict") {
        setStatus("conflict");
        break;
      }
      const later = pending.current as { title: string | null; data: Deck | null } | null;
      pending.current = { title: later?.title ?? next.title, data: later?.data ?? next.data };
      setStatus("error");
      setError(result && !result.ok ? (s.errors[result.error] ?? t.common.unknownError) : t.common.unknownError);
      break;
    }
    saving.current = false;
  }, [shortId, id]);

  const schedule = useCallback(
    (patch: { title?: string; data?: Deck }) => {
      if (!canEdit || status === "conflict") return;
      pending.current = { title: patch.title ?? pending.current?.title ?? null, data: patch.data ?? pending.current?.data ?? null };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 900);
    },
    [canEdit, status, flush],
  );

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (pending.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  return (
    <div className="mt-2 flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              schedule({ title: e.target.value });
            }}
            placeholder={s.titlePlaceholder}
            aria-label={s.titlePlaceholder}
            maxLength={200}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none"
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">{title || s.untitled}</h1>
        )}
        <span className="text-xs text-muted" role="status" data-save-status={status}>
          {status === "saving" ? s.saving : status === "saved" ? s.saved : ""}
        </span>
        {access && (
          <ObjectAccessButton
            label={s.access}
            title={s.accessTitle}
            intro={s.accessIntro}
            access={access}
            members={members}
            actions={{
              setWorkspaceRole: (r) => setDeckWorkspaceRole(shortId, id, r),
              setMemberRole: (member, r) => setDeckMemberRole(shortId, id, member, r),
              setGroupRole: (group, r) => setDeckGroupRole(shortId, id, group, r),
            }}
          />
        )}
        {canEdit && (
          <button
            type="button"
            onClick={async () => {
              await trashDeck(shortId, id);
              router.push(workspacePath(shortId, "/slides"));
            }}
            className={buttonClass}
          >
            🗑️ {s.toBin}
          </button>
        )}
      </div>
      {!canEdit && <p className="mt-1 text-sm text-muted">{s.readOnly}</p>}
      {status === "conflict" && (
        <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          {s.conflict}
          <button type="button" onClick={() => window.location.reload()} className="min-h-9 rounded-md border border-border bg-background px-3">
            {s.reload}
          </button>
        </p>
      )}
      {error && status === "error" && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <DeckEditor shortId={shortId} deckId={id} initial={initial} editable={canEdit && status !== "conflict"} onChange={(deck) => schedule({ data: deck })} />
    </div>
  );
}
