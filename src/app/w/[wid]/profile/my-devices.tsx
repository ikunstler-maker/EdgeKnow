"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { t } from "@/i18n";
import { endMySessions, mySessions, type SessionItem } from "@/app/session-actions";
import { SessionRows } from "@/components/sessions/session-rows";

// Profile → My devices: where I'm signed in, and ending the sessions I don't use.
export function MyDevices() {
  const ss = t.sessions;
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const result = await mySessions();
    setError(!result.ok);
    if (result.ok) setSessions(result.sessions);
  }, []);
  useEffect(() => {
    // Loaded after the page shows, so the profile doesn't wait for it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const end = (target: string | null) =>
    startTransition(async () => {
      const result = await endMySessions(target);
      setError(!result.ok);
      await load();
    });

  const others = (sessions ?? []).filter((x) => !x.current).length;
  return (
    <section className="mt-10 rounded-2xl border border-border p-4" aria-label={ss.myHeading} data-my-devices>
      <h2 className="font-semibold">{ss.myHeading}</h2>
      <p className="mt-1 text-sm text-muted">{ss.myIntro}</p>
      <div className="mt-3">
        {sessions === null ? (
          !error && <p className="text-sm text-muted">{ss.loading}</p>
        ) : (
          <SessionRows sessions={sessions} busy={pending} onEnd={(x) => end(x.id)} />
        )}
      </div>
      {others > 1 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => window.confirm(ss.confirmEndOthers) && end(null)}
          className="mt-3 min-h-11 rounded-lg border border-border px-4 text-sm text-danger hover:bg-surface disabled:opacity-60"
        >
          {ss.endOthers}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {t.common.unknownError}
        </p>
      )}
    </section>
  );
}
