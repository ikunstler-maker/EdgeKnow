// Apus's sounds, made in the browser (no files): a gentle, brief chiptune chime
// (soft square and triangle notes rising over a pentatonic step with a light echo),
// a bubble, or a short sound of the person's own kept on this device only.
export type ApusSound = "chime" | "bubble" | "own" | "off";
export const APUS_SETTINGS_KEY = "ek-apus";
export const OWN_SOUND_MAX = 300 * 1024;

export type ApusSettings = {
  side: "left" | "right" | "top" | "bottom";
  sound: ApusSound;
  ownSound: string | null;
  minimized: boolean;
  x: number | null;
  y: number | null;
};

export function readApusSettings(): ApusSettings {
  const base: ApusSettings = { side: "left", sound: "chime", ownSound: null, minimized: false, x: null, y: null };
  try {
    const raw = window.localStorage.getItem(APUS_SETTINGS_KEY);
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch {
    return base;
  }
}

export function saveApusSettings(next: ApusSettings) {
  try {
    window.localStorage.setItem(APUS_SETTINGS_KEY, JSON.stringify(next));
    return true;
  } catch {
    // Storage full or blocked (a large own sound): the rest still works this visit.
    return false;
  }
}

let context: AudioContext | null = null;
function audio() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
}

function note(ctx: AudioContext, out: AudioNode, freq: number, start: number, length: number, type: OscillatorType, volume: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

export function playApusSound(settings: Pick<ApusSettings, "sound" | "ownSound">) {
  if (settings.sound === "off") return;
  if (settings.sound === "own") {
    if (settings.ownSound) void new Audio(settings.ownSound).play().catch(() => {});
    return;
  }
  const ctx = audio();
  if (!ctx) return;
  void ctx.resume();
  const now = ctx.currentTime + 0.02;
  // A soft echo: the dry sound plus a quieter copy a moment later.
  const out = ctx.createGain();
  out.gain.value = 0.9;
  const delay = ctx.createDelay();
  delay.delayTime.value = 0.16;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.28;
  out.connect(ctx.destination);
  out.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(ctx.destination);
  if (settings.sound === "bubble") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(out);
    osc.start(now);
    osc.stop(now + 0.2);
    return;
  }
  // E6 G6 A6 D7: a rising pentatonic step, small and bright.
  [1318.5, 1568, 1760, 2349.3].forEach((freq, i) => {
    note(ctx, out, freq, now + i * 0.07, 0.22, i % 2 ? "triangle" : "square", i % 2 ? 0.05 : 0.025);
  });
}
