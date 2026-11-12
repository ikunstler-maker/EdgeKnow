"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { t } from "@/i18n";
import { SERVICE_BRANDS } from "@/lib/services";
import { Icon } from "@/components/ui/icon";

const c = () => t.chat.files;
// The block matrix: columns × 5 rows; a column's height is the sound's level there.
export const VOICE_COLUMNS = 28;
const ROWS = 5;
const STEP = 10;
const BLOCK_W = 7;
const BLOCK_H = 6.5;
const ROW_STEP = 9;
const HEIGHT = ROWS * ROW_STEP;
const SPEEDS = [1, 1.5, 2] as const;
const [FROM, TO] = SERVICE_BRANDS.chat.colors;

const timeLabel = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// A steady pattern for voice messages sent before levels were kept (from the file's id).
function fallbackLevels(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: VOICE_COLUMNS }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    return 1 + ((h >>> 16) % 4) + (i % 7 === 3 ? 1 : 0);
  }).map((v) => Math.min(5, v));
}

// Levels of a recording (0..5 per column), worked out in the browser before sending.
export async function levelsOf(blob: Blob, columns = VOICE_COLUMNS): Promise<number[] | null> {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    const context = new Context();
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    void context.close();
    const data = audio.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / columns));
    const peaks = Array.from({ length: columns }, (_, col) => {
      let sum = 0;
      for (let i = col * size; i < Math.min(data.length, (col + 1) * size); i++) sum += data[i] * data[i];
      return Math.sqrt(sum / size);
    });
    const max = Math.max(...peaks, 1e-6);
    return peaks.map((p) => Math.max(1, Math.min(5, Math.round((p / max) * 5))));
  } catch {
    return null;
  }
}

// The voice message player: a gradient button, the block matrix filled as it plays
// (smoothly, frame by frame — not block by block), the time, speed; a click or the
// arrow keys on the matrix move through the recording.
export function VoicePlayer({ src, levels, durationMs, seed }: { src: string; levels: number[] | null; durationMs: number | null; seed: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const clip = useRef<SVGRectElement>(null);
  const head = useRef<SVGGElement>(null);
  const frame = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [current, setCurrent] = useState(0);
  const [failed, setFailed] = useState(false);
  // The recording's length: as saved, then as the browser reads it from the file.
  const [known, setKnown] = useState(0);
  const id = useId().replace(/:/g, "");
  const columns = useMemo(() => {
    const list = levels?.length ? levels : fallbackLevels(seed);
    return list.slice(0, 64);
  }, [levels, seed]);
  const width = columns.length * STEP - (STEP - BLOCK_W);
  const saved = durationMs ? durationMs / 1000 : 0;

  // Where the playback is, drawn straight into the picture each frame.
  const draw = (seconds: number, length: number) => {
    const ratio = length > 0 ? Math.min(1, Math.max(0, seconds / length)) : 0;
    clip.current?.setAttribute("width", String(ratio * width));
    head.current?.setAttribute("transform", `translate(${ratio * width} 0)`);
  };
  const lengthOf = () => (audio.current && Number.isFinite(audio.current.duration) && audio.current.duration > 0 ? audio.current.duration : saved);
  const total = known || saved;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const tick = () => {
      draw(el.currentTime, lengthOf());
      frame.current = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(tick);
    };
    const onStop = () => {
      setPlaying(false);
      cancelAnimationFrame(frame.current);
      draw(el.currentTime, lengthOf());
      setCurrent(el.currentTime);
    };
    const onTime = () => setCurrent(el.currentTime);
    const onLength = () => Number.isFinite(el.duration) && el.duration > 0 && setKnown(el.duration);
    const onEnded = () => {
      onStop();
      el.currentTime = 0;
      draw(0, lengthOf());
      setCurrent(0);
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onStop);
    el.addEventListener("ended", onEnded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onLength);
    el.addEventListener("durationchange", onLength);
    el.addEventListener("error", () => setFailed(true));
    return () => {
      cancelAnimationFrame(frame.current);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onStop);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onLength);
      el.removeEventListener("durationchange", onLength);
    };
    // The handlers read the element and the sizes as they are when they run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, saved]);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setFailed(true));
    else el.pause();
  };
  const seekTo = (seconds: number) => {
    const el = audio.current;
    if (!el) return;
    const length = lengthOf();
    const next = Math.min(Math.max(0, seconds), length || 0);
    el.currentTime = next;
    setCurrent(next);
    draw(next, length);
  };
  const onClick = (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const length = lengthOf();
    if (!length) {
      toggle();
      return;
    }
    seekTo(((event.clientX - box.left) / box.width) * length);
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      seekTo(current + (event.key === "ArrowRight" ? 5 : -5));
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggle();
    }
  };
  const nextSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  const blocks = (signalOnly: boolean, fill: string) =>
    columns.flatMap((level, col) =>
      Array.from({ length: ROWS }, (_, row) => {
        const fromBottom = ROWS - 1 - row;
        const signal = fromBottom < level;
        if (signalOnly && !signal) return null;
        return (
          <rect
            key={`${col}-${row}`}
            x={col * STEP}
            y={row * ROW_STEP}
            width={BLOCK_W}
            height={BLOCK_H}
            rx={1.4}
            fill={signal ? fill : "currentColor"}
            opacity={signal ? 1 : 0.18}
          />
        );
      }),
    );

  return (
    <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-border bg-surface p-3" data-chat-voice-message>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? c().pause : c().play}
        title={playing ? c().pause : c().play}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] text-white shadow-md transition-transform hover:-translate-y-px active:scale-95"
        style={{ backgroundImage: `linear-gradient(135deg, ${FROM}, ${TO})` }}
        data-chat-voice-play
      >
        <Icon name={playing ? "pause" : "play"} size={20} />
      </button>
      <div className="min-w-0 flex-1">
        <svg
          viewBox={`0 0 ${width} ${HEIGHT + 4}`}
          preserveAspectRatio="none"
          className="h-11 w-full cursor-pointer overflow-visible text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          role="slider"
          tabIndex={0}
          aria-label={c().voicePosition}
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(current)}
          aria-valuetext={`${timeLabel(current)} / ${timeLabel(total)}`}
          onClick={onClick}
          onKeyDown={onKey}
          data-chat-voice-matrix
        >
          <defs>
            <linearGradient id={`g${id}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={width} y2={HEIGHT}>
              <stop offset="0%" stopColor={FROM} />
              <stop offset="100%" stopColor={TO} />
            </linearGradient>
            <clipPath id={`c${id}`}>
              <rect ref={clip} x="0" y="0" width="0" height={HEIGHT + 4} />
            </clipPath>
          </defs>
          {/* Not played yet: the sound in grey over faint empty blocks. */}
          <g className="text-border-strong">{blocks(false, "currentColor")}</g>
          {/* Played: the same blocks in the service's colours, revealed smoothly. */}
          <g clipPath={`url(#c${id})`}>{blocks(true, `url(#g${id})`)}</g>
          <g ref={head} style={{ pointerEvents: "none" }}>
            <line x1="0" y1="0" x2="0" y2={HEIGHT - 2} stroke={TO} strokeWidth={1.5} strokeOpacity={0.8} vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
          <span className="tabular-nums" data-chat-voice-time>
            {failed ? c().voiceFailed : `${timeLabel(current)} / ${timeLabel(total)}`}
          </span>
          <button
            type="button"
            onClick={nextSpeed}
            aria-label={c().speed(speed)}
            className={`min-h-8 rounded-md border px-2 text-[11px] font-medium md:min-h-6 ${speed !== 1 ? "border-accent/50 bg-accent/10 text-foreground" : "border-border hover:bg-hover"}`}
            data-chat-voice-speed
          >
            {speed}x
          </button>
        </div>
      </div>
      <audio ref={audio} src={src} preload="metadata" className="hidden" />
    </div>
  );
}
