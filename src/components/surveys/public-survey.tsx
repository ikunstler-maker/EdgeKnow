"use client";

import Script from "next/script";
import { useCallback, useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import { submitPublicSurvey } from "@/app/public-survey-actions";
import type { SurveyData, SurveyState, SurveyTransport } from "@/lib/surveys";
import { SurveyForm } from "./survey-form";
import { uploadSurveyFile } from "./survey-files";

type TurnstileApi = { render: (element: HTMLElement, options: Record<string, unknown>) => string; reset: (id?: string) => void };

// The form behind the link for anyone: answers go through our server; files only
// for someone signed in; the "not a robot" check when it is set up.
export function PublicSurvey({
  shortId,
  token,
  id,
  survey,
  anonymous,
  once,
  closed,
  signedIn,
  turnstileSiteKey,
}: {
  shortId: string;
  token: string;
  id: string;
  survey: SurveyData;
  anonymous: boolean;
  once: boolean;
  closed: boolean;
  signedIn: boolean;
  turnstileSiteKey: string | null;
}) {
  const proof = useRef<string | null>(null);
  const widget = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  const draw = useCallback(() => {
    const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    if (!api || !box.current || widget.current || !turnstileSiteKey) return;
    widget.current = api.render(box.current, {
      sitekey: turnstileSiteKey,
      language: document.documentElement.lang || "uk",
      callback: (value: string) => (proof.current = value),
      "expired-callback": () => (proof.current = null),
    });
    setReady(true);
  }, [turnstileSiteKey]);

  const transport = useMemo<SurveyTransport>(
    () => ({
      submit: async (answers) => {
        if (turnstileSiteKey && !proof.current) return { ok: false, error: "robot" };
        const result = await submitPublicSurvey(shortId, token, answers, proof.current);
        // A check is good for one answer.
        proof.current = null;
        (window as unknown as { turnstile?: TurnstileApi }).turnstile?.reset(widget.current ?? undefined);
        return result;
      },
      upload: signedIn ? (file) => uploadSurveyFile(`/api/f/files?ws=${shortId}&token=${token}`, file) : null,
      signInHref: `/login?next=${encodeURIComponent(`/f/${shortId}/${token}`)}`,
    }),
    [shortId, token, signedIn, turnstileSiteKey],
  );

  const state: SurveyState = {
    anonymous,
    once,
    editable: false,
    accepting: !closed,
    closes_at: null,
    max_responses: null,
    closed,
    answered: false,
    mine: null,
    manager: false,
    count: null,
    sheet: null,
  };

  return (
    <>
      {turnstileSiteKey && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={draw} />}
      <SurveyForm
        shortId={shortId}
        id={id}
        survey={survey}
        state={state}
        transport={transport}
        footer={
          turnstileSiteKey ? (
            <div>
              <div ref={box} data-turnstile />
              {!ready && <p className="text-xs text-muted">{t.surveys.form.robot}</p>}
            </div>
          ) : null
        }
      />
    </>
  );
}
