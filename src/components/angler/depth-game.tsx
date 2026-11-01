"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";

// "Depth": a calm little game hidden behind the angler fish. You lead its lure
// with the mouse, a finger or the arrow keys; glowing plankton and jellyfish
// drift by, and each one you touch makes the light a little bigger and takes you
// deeper. Nothing can go wrong; the deepest dive is remembered in this browser.

type Mote = { x: number; y: number; r: number; hue: number; speed: number; phase: number; value: number; jelly: boolean };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; hue: number };
type Note = { x: number; y: number; life: number; text: string };

const BEST_KEY = "ek-depth-best";
const METERS_PER_POINT = 3;
// Soft pastels: mint, sky, lavender, pink, peach, gold.
const HUES = [160, 195, 260, 320, 20, 45];

function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function DepthGame({ onClose }: { onClose: () => void }) {
  const g = t.angler.game;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [depth, setDepth] = useState(0);
  const [best, setBest] = useState(readBest);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let width = 0;
    let height = 0;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      width = el.clientWidth;
      height = el.clientHeight;
      el.width = width * scale;
      el.height = height * scale;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const lure = { x: width * 0.35, y: height * 0.5, r: 10 };
    const aim = { x: lure.x, y: lure.y };
    const keys = new Set<string>();
    let motes: Mote[] = [];
    let sparks: Spark[] = [];
    let notes: Note[] = [];
    let score = 0;
    let shownDepth = 0;
    let lastSpawn = 0;
    const dust = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), s: 0.3 + Math.random() * 1.2 }));

    const point = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      aim.x = event.clientX - box.left;
      aim.y = event.clientY - box.top;
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key.startsWith("Arrow")) {
        keys.add(event.key);
        event.preventDefault();
      }
    };
    const keyUp = (event: KeyboardEvent) => keys.delete(event.key);
    el.addEventListener("pointermove", point);
    el.addEventListener("pointerdown", point);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    const spawn = (now: number) => {
      const jelly = Math.random() < 0.08;
      motes.push({
        x: width + 30,
        y: 40 + Math.random() * (height - 80),
        r: jelly ? 14 : 3 + Math.random() * 3,
        hue: HUES[Math.floor(Math.random() * HUES.length)],
        speed: (jelly ? 0.5 : 0.7) + Math.random() * 0.9,
        phase: Math.random() * Math.PI * 2,
        value: jelly ? 5 : 1,
        jelly,
      });
      lastSpawn = now;
    };

    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 16.7, 3);
      previous = now;
      if (now - lastSpawn > 420) spawn(now);

      // Keys move the aim; the light follows it softly.
      const step = 6 * dt;
      if (keys.has("ArrowLeft")) aim.x -= step;
      if (keys.has("ArrowRight")) aim.x += step;
      if (keys.has("ArrowUp")) aim.y -= step;
      if (keys.has("ArrowDown")) aim.y += step;
      aim.x = Math.max(0, Math.min(width, aim.x));
      aim.y = Math.max(0, Math.min(height, aim.y));
      lure.x += (aim.x - lure.x) * 0.08 * dt;
      lure.y += (aim.y - lure.y) * 0.08 * dt;

      // Deeper water is a little darker and bluer.
      const deep = Math.min(score / 300, 1);
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, `hsl(${205 + deep * 25} 60% ${28 - deep * 12}%)`);
      sky.addColorStop(1, `hsl(${250 + deep * 15} 55% ${14 - deep * 7}%)`);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      for (const d of dust) {
        d.x -= 0.0004 * d.s * dt;
        if (d.x < 0) d.x += 1;
        ctx.fillStyle = `rgba(200, 230, 255, ${0.08 + d.s * 0.08})`;
        ctx.beginPath();
        ctx.arc(d.x * width, d.y * height, d.s, 0, Math.PI * 2);
        ctx.fill();
      }

      // The light around the lure.
      const halo = ctx.createRadialGradient(lure.x, lure.y, 0, lure.x, lure.y, lure.r * 7);
      halo.addColorStop(0, "rgba(255, 224, 150, 0.35)");
      halo.addColorStop(1, "rgba(255, 224, 150, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(lure.x, lure.y, lure.r * 7, 0, Math.PI * 2);
      ctx.fill();

      motes = motes.filter((m) => {
        m.x -= m.speed * dt;
        m.phase += 0.03 * dt;
        const y = m.y + Math.sin(m.phase) * (m.jelly ? 10 : 6);
        if (Math.hypot(m.x - lure.x, y - lure.y) < m.r + lure.r + 4) {
          score += m.value;
          lure.r = Math.min(10 + score * 0.04, 26);
          for (let i = 0; i < (m.jelly ? 18 : 8); i++) {
            const angle = Math.random() * Math.PI * 2;
            sparks.push({ x: m.x, y, vx: Math.cos(angle) * 1.6, vy: Math.sin(angle) * 1.6, life: 1, hue: m.hue });
          }
          notes.push({ x: m.x, y, life: 1, text: `+${m.value * METERS_PER_POINT} ${g.meters}` });
          return false;
        }
        if (m.x < -40) return false;
        ctx.save();
        ctx.shadowColor = `hsl(${m.hue} 90% 70%)`;
        ctx.shadowBlur = m.jelly ? 22 : 12;
        ctx.fillStyle = `hsla(${m.hue} 85% 75% / 0.9)`;
        ctx.beginPath();
        if (m.jelly) {
          // A little jellyfish: a dome and three wavy strings.
          ctx.arc(m.x, y, m.r, Math.PI, 0);
          ctx.fill();
          ctx.strokeStyle = `hsla(${m.hue} 85% 80% / 0.7)`;
          ctx.lineWidth = 1.5;
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(m.x + i * 6, y);
            ctx.quadraticCurveTo(m.x + i * 6 + Math.sin(m.phase * 2 + i) * 4, y + 10, m.x + i * 6, y + 18);
            ctx.stroke();
          }
        } else {
          ctx.arc(m.x, y, m.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        return true;
      });

      sparks = sparks.filter((s) => {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= 0.03 * dt;
        ctx.fillStyle = `hsla(${s.hue} 90% 80% / ${Math.max(s.life, 0)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
        ctx.fill();
        return s.life > 0;
      });

      // The fish swims behind its light, looking at it.
      const fx = lure.x - 46;
      const fy = lure.y + 20 + Math.sin(now / 500) * 2;
      ctx.save();
      ctx.fillStyle = "#6f6ae8";
      ctx.beginPath();
      ctx.moveTo(fx - 18, fy);
      ctx.quadraticCurveTo(fx - 30, fy - 12 + Math.sin(now / 180) * 3, fx - 32, fy - 9);
      ctx.quadraticCurveTo(fx - 28, fy, fx - 32, fy + 9);
      ctx.quadraticCurveTo(fx - 30, fy + 12 + Math.sin(now / 180) * 3, fx - 18, fy);
      ctx.fill();
      const body = ctx.createLinearGradient(fx - 20, fy - 18, fx + 20, fy + 18);
      body.addColorStop(0, "#8b7cf6");
      body.addColorStop(1, "#3aa0e8");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(fx, fy, 22, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(191, 238, 255, 0.55)";
      ctx.beginPath();
      ctx.ellipse(fx + 4, fy + 8, 13, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(fx + 8, fy - 5, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1f1b3a";
      ctx.beginPath();
      ctx.arc(fx + 10, fy - 4, 3.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#5b4fd0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fx, fy - 17);
      ctx.quadraticCurveTo(fx + 10, (fy - 17 + lure.y) / 2 - 20, lure.x, lure.y);
      ctx.stroke();
      ctx.restore();

      const orb = ctx.createRadialGradient(lure.x - lure.r * 0.3, lure.y - lure.r * 0.3, 0, lure.x, lure.y, lure.r);
      orb.addColorStop(0, "#fffdf0");
      orb.addColorStop(0.4, "#ffe08a");
      orb.addColorStop(1, "#ff8fb1");
      ctx.save();
      ctx.shadowColor = "rgba(255, 200, 120, 0.9)";
      ctx.shadowBlur = 24;
      ctx.fillStyle = orb;
      ctx.beginPath();
      ctx.arc(lure.x, lure.y, lure.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      notes = notes.filter((n) => {
        n.y -= 0.6 * dt;
        n.life -= 0.02 * dt;
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(n.life, 0)})`;
        ctx.font = "600 13px system-ui, sans-serif";
        ctx.fillText(n.text, n.x, n.y);
        return n.life > 0;
      });

      const meters = score * METERS_PER_POINT;
      if (meters !== shownDepth) {
        shownDepth = meters;
        setDepth(meters);
        setBest((before) => {
          if (meters <= before) return before;
          try {
            localStorage.setItem(BEST_KEY, String(meters));
          } catch {
            // Not remembered in this browser; the game goes on.
          }
          return meters;
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      el.removeEventListener("pointermove", point);
      el.removeEventListener("pointerdown", point);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [g.meters]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={g.title} className="fixed inset-0 z-50 bg-[#0d1b3a]" data-depth-game>
      <canvas ref={canvas} className="h-full w-full touch-none" />
      <div className="pointer-events-none absolute left-4 top-4 text-white">
        <p className="text-lg font-semibold" data-depth>
          {g.depth(depth)}
        </p>
        <p className="text-sm text-white/70">{g.best(best)}</p>
      </div>
      <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-center text-sm text-white/70">{g.hint}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label={t.common.close}
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        ✕
      </button>
    </div>,
    document.body,
  );
}
