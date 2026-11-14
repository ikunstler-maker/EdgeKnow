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
import { StudioNotices, StudioShell } from "@/components/ui/studio-shell";
import { LivePresence, liveMenu } from "@/components/live/live-presence";
import { ShowLinkDialog } from "./show-link-dialog";
import { DECK_SPEC } from "@/lib/live/doc-sync";
import { useLiveDoc } from "@/lib/live/use-live-doc";

const s = t.slides;

// One presentation: its name, the save status, access and the editor. Changes are
// saved about a second after the last one; a save that finds a newer version stops
// and asks to reload (as tables do). With real-time co-editing on, the room shares every
// change and one editor (the leader) saves for everyone.
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
  const [showLink, setShowLink] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [initial] = useState(() => readDeck(initialData));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "conflict" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const version = useRef(initialVersion);
  const pending = useRef<{ title: string | null; data: Deck | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const liveRef = useRef<ReturnType<typeof useLiveDoc<Deck>> | null>(null);

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
        liveRef.current?.saved(result.version);
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

  // The show and PDF read the saved deck: save first, then open the new tab
  // (opened at once, so the browser doesn't block it).
  const open = async (path: string) => {
    const win = window.open("about:blank", "_blank");
    if (timer.current) clearTimeout(timer.current);
    await flush();
    const url = workspacePath(shortId, `/slides/${id}${path}`);
    if (win) win.location.href = url;
    else window.location.href = url;
  };

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (pending.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const live = useLiveDoc<Deck>({
    shortId,
    objectId: id,
    spec: DECK_SPEC,
    initial,
    initialTitle,
    versionRef: version,
    pageCanEdit: canEdit,
    onTitle: setTitle,
    onSave: (data, name) => schedule({ data, title: name }),
  });
  useEffect(() => {
    liveRef.current = live;
  });
  const editable = live.canEdit && status !== "conflict";
  return (
    <StudioShell
      service="slides"
      backHref={workspacePath(shortId, "/slides")}
      backLabel={s.back}
      title={title}
      onTitle={
        canEdit
          ? (value) => {
              setTitle(value);
              if (!live.changeTitle(value)) schedule({ title: value });
            }
          : undefined
      }
      titleLabel={s.titlePlaceholder}
      untitled={s.untitled}
      status={status}
      savingLabel={s.saving}
      savedLabel={s.saved}
      center={undefined}
      presence={<LivePresence live={live} />}
      files={[
        { label: s.print.button, icon: "download" as const, onSelect: () => void open("/print"), attrs: { "data-print": "" } },
        { label: s.print.withNotes, icon: "file-text" as const, onSelect: () => void open("/print?notes=1"), attrs: { "data-print-notes": "" } },
      ]}
      access={
        access && (
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
        )
      }
      primary={{ label: s.player.show, icon: "play", onSelect: () => void open("/play"), attrs: { "data-play": "" } }}
      more={[
        ...liveMenu(live),
        { label: s.player.presenter, icon: "monitor" as const, onSelect: () => void open("/play?presenter=1"), attrs: { "data-presenter-open": "" } },
        ...(role === "owner" ? [{ label: s.publicShow.menu, icon: "link" as const, onSelect: () => setShowLink(true), attrs: { "data-show-link-open": "" } }] : []),
        ...(canEdit
          ? [
              {
                label: s.toBin,
                icon: "trash" as const,
                danger: true,
                onSelect: async () => {
                  await trashDeck(shortId, id);
                  router.push(workspacePath(shortId, "/slides"));
                },
                attrs: { "data-to-bin": "" },
              },
            ]
          : []),
      ]}
      notices={<StudioNotices readOnly={canEdit ? null : s.readOnly} conflict={status === "conflict" ? s.conflict : null} reloadLabel={s.reload} error={status === "error" ? error : null} />}
    >
      {showLink && <ShowLinkDialog shortId={shortId} deckId={id} onClose={() => setShowLink(false)} />}
      <DeckEditor shortId={shortId} deckId={id} initial={initial} editable={editable} onChange={(deck) => schedule({ data: deck })} onPlay={(n) => void open(`/play?at=${n}`)} live={live} />
    </StudioShell>
  );
}
