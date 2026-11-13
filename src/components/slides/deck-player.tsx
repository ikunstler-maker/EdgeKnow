"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { sizeOf, type Deck, type Slide } from "@/lib/slides";
import { EASINGS, slideOffsets, smartFrame } from "@/lib/slide-motion";
import { SlideView } from "./slide-view";
import { Icon } from "@/components/ui/icon";

const p = t.slides.player;
type Anim = { from: Slide; to: Slide; start: number };

// Showing a deck (step П-3а): the slides full size, the way each one comes in, keys and
// clicks to move on. The presenter's window (notes, next slide, timer) and the show
// stay on the same slide through a channel of the browser.
export function DeckPlayer({ deck, deckId, shortId, title, presenter, startAt = 0, publicShow = false }: { deck: Deck; deckId: string; shortId: string; title: string; presenter: boolean; startAt?: number; publicShow?: boolean }) {
  const size = sizeOf(deck);
  const count = deck.slides.length;
  const [index, setIndex] = useState(Math.min(Math.max(0, startAt), count - 1));
  // KADRY-1: objects that appear on a click — how many of this slide's are out, and when the last came.
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);
  const [built, setBuilt] = useState<{ at: number; start: number } | null>(null);
  const [buildProgress, setBuildProgress] = useState(1);
  // A show through its link reads no other service: embeds stay placeholders.
  const embeds = publicShow ? ("placeholder" as const) : ("live" as const);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [progress, setProgress] = useState(1);
  const [chrome, setChrome] = useState(true);
  const channel = useRef<BroadcastChannel | null>(null);
  const indexRef = useRef(index);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Moving to a slide: with its transition when going forward by one.
  const show = useCallback(
    (next: number, tell = true) => {
      const to = Math.min(Math.max(0, next), count - 1);
      const from = indexRef.current;
      if (to === from) return;
      indexRef.current = to;
      setIndex(to);
      // Back to a slide: all its objects out; forward: none yet.
      const outNow = to < from ? buildsOf(deck.slides[to]).length : 0;
      stepRef.current = outNow;
      setStep(outNow);
      setBuilt(null);
      const tr = deck.slides[to].transition;
      if (to === from + 1 && tr && tr.kind !== "none") {
        // Its objects that appear on a click stay out of the transition.
        setAnim({ from: deck.slides[from], to: withBuilds(deck.slides[to], 0, 1), start: performance.now() });
        setProgress(0);
      } else {
        setAnim(null);
        setProgress(1);
      }
      if (tell) channel.current?.postMessage({ type: "go", index: to });
    },
    [count, deck.slides],
  );

  // A click: the next object of this slide, or the next slide when all are out.
  const forward = useCallback(() => {
    const builds = buildsOf(deck.slides[indexRef.current]);
    if (stepRef.current < builds.length) {
      stepRef.current += 1;
      setStep(stepRef.current);
      setBuilt({ at: stepRef.current - 1, start: performance.now() });
      setBuildProgress(0);
      channel.current?.postMessage({ type: "step", index: indexRef.current, step: stepRef.current });
      return;
    }
    show(indexRef.current + 1);
  }, [deck.slides, show]);
  const back = useCallback(() => {
    if (stepRef.current > 0) {
      stepRef.current -= 1;
      setStep(stepRef.current);
      setBuilt(null);
      channel.current?.postMessage({ type: "step", index: indexRef.current, step: stepRef.current });
      return;
    }
    show(indexRef.current - 1);
  }, [show]);

  // The appearing object's clock.
  useEffect(() => {
    if (!built) return;
    let frame = 0;
    const tick = (now: number) => {
      const done = Math.min(1, (now - built.start) / 450);
      setBuildProgress(done);
      if (done < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [built]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(`edgeknow-deck-${deckId}`);
    channel.current = ch;
    ch.onmessage = (event) => {
      const data = event.data as { type?: string; index?: number };
      if (data?.type === "go" && typeof data.index === "number") show(data.index, false);
      if (data?.type === "step" && typeof data.index === "number" && data.index === indexRef.current && typeof (data as { step?: number }).step === "number") {
        stepRef.current = (data as { step: number }).step;
        setStep(stepRef.current);
      }
      if (data?.type === "hello") ch.postMessage({ type: "go", index: indexRef.current });
    };
    ch.postMessage({ type: "hello" });
    return () => ch.close();
  }, [deckId, show]);

  // The transition's clock.
  useEffect(() => {
    if (!anim) return;
    const tr = anim.to.transition!;
    const duration = tr.duration ?? 500;
    let frame = 0;
    const tick = (now: number) => {
      const done = Math.min(1, (now - anim.start) / duration);
      setProgress(done);
      if (done < 1) frame = requestAnimationFrame(tick);
      else setAnim(null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [anim]);

  const toggleFull = async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await document.documentElement.requestFullscreen().catch(() => {});
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (["TEXTAREA", "INPUT", "SELECT"].includes((event.target as HTMLElement).tagName)) return;
      const key = event.key;
      if (key === "ArrowRight" || key === "PageDown" || key === " " || key === "Enter") {
        event.preventDefault();
        forward();
      } else if (key === "ArrowLeft" || key === "PageUp" || key === "Backspace") {
        event.preventDefault();
        back();
      } else if (key === "Home") show(0);
      else if (key === "End") show(count - 1);
      else if (key.toLowerCase() === "r") show(0);
      else if (key.toLowerCase() === "f") void toggleFull();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, count, forward, back]);

  const wake = () => {
    setChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), 2500);
  };

  const slide = withBuilds(deck.slides[index], step, built?.at === step - 1 ? buildProgress : 1);
  const eased = anim ? EASINGS[anim.to.transition?.easing ?? "ease"](progress) : 1;

  const stage = (
    <div className="relative h-full w-full overflow-hidden" data-player-stage>
      {anim && anim.to.transition?.kind === "smart" ? (
        <SlideView slide={{ ...anim.to, nodes: smartFrame(anim.from, anim.to, eased) }} shortId={shortId} size={size} prefix="p" className="absolute inset-0 h-full w-full" embeds={embeds} />
      ) : anim ? (
        (() => {
          const o = slideOffsets(anim.to.transition!, eased);
          return (
            <>
              <div className="absolute inset-0" style={{ transform: `translate(${o.from.x}%, ${o.from.y}%)`, opacity: o.from.opacity }}>
                <SlideView slide={anim.from} shortId={shortId} size={size} prefix="pa" className="h-full w-full" embeds={embeds} />
              </div>
              <div className="absolute inset-0" style={{ transform: `translate(${o.to.x}%, ${o.to.y}%)`, opacity: o.to.opacity }}>
                <SlideView slide={anim.to} shortId={shortId} size={size} prefix="pb" className="h-full w-full" embeds={embeds} />
              </div>
            </>
          );
        })()
      ) : (
        <SlideView slide={slide} shortId={shortId} size={size} prefix="p" className="absolute inset-0 h-full w-full" embeds={embeds} />
      )}
    </div>
  );

  if (presenter) return <PresenterView deck={deck} shortId={shortId} title={title} index={index} onGo={show} stage={stage} />;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white" onMouseMove={wake} onClick={() => forward()} data-player data-player-index={index + 1} data-player-step={step}>
      <div className="min-h-0 flex-1">{stage}</div>
      <div className={`absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-3 py-2 text-sm transition-opacity ${chrome ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate">{title || t.slides.untitled}</span>
        <button type="button" onClick={() => back()} disabled={index === 0 && step === 0} className="min-h-11 rounded px-3 hover:bg-white/10 disabled:opacity-40" aria-label={p.prev}>
          <Icon name="arrow-left" />
        </button>
        <span aria-live="polite" data-player-count>
          {index + 1} / {count}
        </span>
        <button type="button" onClick={() => forward()} disabled={index === count - 1 && step >= buildsOf(deck.slides[index]).length} className="min-h-11 rounded px-3 hover:bg-white/10 disabled:opacity-40" aria-label={p.next}>
          <Icon name="arrow-right" />
        </button>
        <button type="button" onClick={() => void toggleFull()} className="min-h-11 rounded px-3 hover:bg-white/10" aria-label={p.fullscreen} title={p.fullscreen}>
          <Icon name="maximize" />
        </button>
        {!publicShow && (
          <button type="button" onClick={() => window.close()} className="min-h-11 rounded px-3 hover:bg-white/10" aria-label={p.close} title={p.close}>
            <Icon name="close" />
          </button>
        )}
      </div>
    </div>
  );
}

// KADRY-1: the objects of a slide that appear on a click (in the slide's order of objects).
const buildsOf = (slide: Slide | undefined) => (slide?.nodes ?? []).filter((n) => n.build);
// The slide as shown: objects not out yet left out; the one coming in drawn part-way.
function withBuilds(slide: Slide, step: number, progress: number): Slide {
  const builds = buildsOf(slide);
  if (!builds.length) return slide;
  const out = new Set(builds.slice(0, step).map((n) => n.id));
  const coming = progress < 1 ? builds[step - 1]?.id : undefined;
  const e = 1 - Math.pow(1 - progress, 3);
  return {
    ...slide,
    nodes: slide.nodes
      .filter((n) => !n.build || out.has(n.id))
      .map((n) => {
        if (n.id !== coming) return n;
        const opacity = (n.opacity ?? 1) * e;
        if (n.build === "rise") return { ...n, opacity, y: n.y + (1 - e) * 60 };
        if (n.build === "zoom") {
          const k = 0.6 + 0.4 * e;
          return { ...n, opacity, x: n.x + (n.width * (1 - k)) / 2, y: n.y + (n.height * (1 - k)) / 2, width: n.width * k, height: n.height * k };
        }
        return { ...n, opacity };
      }),
  };
}

// The speaker's window: this slide, the next one, notes, a timer and the clock.
function PresenterView({ deck, shortId, title, index, onGo, stage }: { deck: Deck; shortId: string; title: string; index: number; onGo: (i: number) => void; stage: React.ReactNode }) {
  const size = sizeOf(deck);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(true);
  const [now, setNow] = useState("");
  useEffect(() => {
    const id = setInterval(() => {
      if (running) setElapsed((x) => x + 1);
      setNow(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);
  const next = deck.slides[index + 1];
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="fixed inset-0 z-[100] grid grid-rows-[auto_1fr_auto] gap-3 bg-[#090B0E] p-4 text-gray-100" data-presenter>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium">{title || t.slides.untitled}</span>
        <span className="font-mono text-2xl tabular-nums" data-presenter-timer>
          {mm}:{ss}
        </span>
        <button type="button" onClick={() => setRunning(!running)} className="min-h-11 rounded border border-white/20 px-3 hover:bg-white/10">
          {running ? p.pause : p.resume}
        </button>
        <button type="button" onClick={() => setElapsed(0)} className="min-h-11 rounded border border-white/20 px-3 hover:bg-white/10">
          {p.reset}
        </button>
        <span className="font-mono text-lg tabular-nums text-gray-400">{now}</span>
      </div>
      <div className="grid min-h-0 gap-3 md:grid-cols-[2fr_1fr]">
        <div className="min-h-0 overflow-hidden rounded-lg bg-black">{stage}</div>
        <div className="flex min-h-0 flex-col gap-3">
          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">{p.nextSlide}</p>
            {next ? <SlideView slide={next} shortId={shortId} size={size} prefix="n" className="w-full rounded bg-black" style={{ aspectRatio: `${size.w} / ${size.h}` }} /> : <p className="text-sm text-gray-400">{p.end}</p>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded bg-white/5 p-3">
            <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">{p.notes}</p>
            <p className="whitespace-pre-wrap text-lg leading-relaxed" data-presenter-notes>
              {deck.slides[index].notes || p.noNotes}
            </p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center gap-3">
        <button type="button" onClick={() => onGo(index - 1)} disabled={index === 0} className="min-h-11 rounded border border-white/20 px-4 hover:bg-white/10 disabled:opacity-40" data-presenter-prev>
          <Icon name="arrow-left" className="mr-1 inline" />
          {p.prev}
        </button>
        <span className="tabular-nums" data-presenter-count>
          {index + 1} / {deck.slides.length}
        </span>
        <button type="button" onClick={() => onGo(index + 1)} disabled={index === deck.slides.length - 1} className="min-h-11 rounded border border-white/20 px-4 hover:bg-white/10 disabled:opacity-40" data-presenter-next>
          {p.next}
          <Icon name="arrow-right" className="ml-1 inline" />
        </button>
      </div>
    </div>
  );
}
