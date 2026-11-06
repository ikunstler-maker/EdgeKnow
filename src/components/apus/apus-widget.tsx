"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { saveAppearance } from "@/app/preferences-actions";
import { OWN_SOUND_MAX, playApusSound, readApusSettings, saveApusSettings, type ApusSettings, type ApusSound } from "@/lib/apus-sound";
import { inQuietHours, readDeviceSettings } from "@/lib/notifications";
import { useAppearance } from "@/components/angler/appearance";
import { ANGLER_GAME_EVENT } from "@/components/angler/angler-guide";
import { OPEN_FEEDBACK_EVENT } from "@/components/feedback/feedback-button";
import { NOTIFICATIONS_EVENT, OPEN_NOTIFICATIONS_EVENT, type NotificationNews } from "@/components/notifications/notification-bell";
import { ApusFigure, type ApusMood } from "./apus-figure";

const a = t.apus;
const SIDES = ["left", "right", "top", "bottom"] as const;
const SOUNDS: ApusSound[] = ["chime", "bubble", "own", "off"];

type Toast = { id: number; line: string; subject: string; href: string | null };

// Apus, in place of the old «!?» button: drag it anywhere (the place is kept on this
// device), minimize it to a badge or hide it. A click opens its menu: notifications,
// feedback and bugs, the helper (soon), the game and its settings. New notifications
// pop up beside it, on the side chosen, with its sound.
export function ApusWidget() {
  const { appearance, setAppearance } = useAppearance();
  const [settings, setSettings] = useState<ApusSettings | null>(null);
  const [mood, setMood] = useState<ApusMood>("idle");
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<"menu" | "settings">("menu");
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  // Where Apus stands (measured when a panel opens), so panels open inwards.
  const [where, setWhere] = useState({ low: true, rightHalf: true });
  const measure = () => {
    const box = root.current?.getBoundingClientRect();
    if (box) setWhere({ low: box.top > window.innerHeight / 2, rightHalf: box.left > window.innerWidth / 2 });
  };

  useEffect(() => {
    // The device's own settings load after the first paint (no storage on the server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(readApusSettings());
  }, []);

  // A mood for a moment, then back to calm (or to the next one given).
  const flash = useCallback((next: ApusMood, ms: number, then: ApusMood = "idle") => {
    if (moodTimer.current) clearTimeout(moodTimer.current);
    setMood(next);
    moodTimer.current = setTimeout(() => setMood(then), ms);
  }, []);

  const update = (patch: Partial<ApusSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    if (!saveApusSettings(next)) setNote(a.storageFull);
  };

  useEffect(() => {
    const onNews = (event: Event) => {
      const news = (event as CustomEvent<NotificationNews>).detail;
      setUnread(news.unread);
      if (!news.fresh.length) return;
      const stamp = Date.now();
      measure();
      setToasts((list) => [...list, ...news.fresh.slice(0, 3).map((f, i) => ({ id: stamp + i, ...f }))].slice(-3));
      flash("surprised", 500, "wave");
      setTimeout(() => setMood("idle"), 2200);
      const current = readApusSettings();
      if (!inQuietHours(readDeviceSettings())) playApusSound(current);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id < stamp)), 7000);
    };
    window.addEventListener(NOTIFICATIONS_EVENT, onNews);
    return () => window.removeEventListener(NOTIFICATIONS_EVENT, onNews);
  }, [flash]);

  if (appearance.lure === "hidden" || !settings) return null;

  const closeMenu = () => {
    setMenu(false);
    setTab("menu");
    flash("love", 1600);
  };
  const act = (action: () => void) => {
    flash("hearts", 1300);
    action();
  };

  // Dragging: pointer events on the figure; a short press without movement is a click.
  const onPointerDown = (event: React.PointerEvent) => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    drag.current = { dx: event.clientX - box.left, dy: event.clientY - box.top, moved: false };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    const el = root.current;
    if (!d || !el) return;
    const x = Math.min(Math.max(0, event.clientX - d.dx), window.innerWidth - el.offsetWidth);
    const y = Math.min(Math.max(0, event.clientY - d.dy), window.innerHeight - el.offsetHeight);
    if (!d.moved && Math.abs(event.movementX) + Math.abs(event.movementY) < 2) return;
    d.moved = true;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved && root.current) {
      // Kept as a share of the screen, so it stays on screen when the window changes.
      const box = root.current.getBoundingClientRect();
      update({ x: box.left / window.innerWidth, y: box.top / window.innerHeight });
      return;
    }
    if (menu) return closeMenu();
    measure();
    flash("kiss", 1200);
    setMenu(true);
  };

  const place =
    settings.x !== null && settings.y !== null
      ? { left: `min(${settings.x * 100}vw, calc(100vw - 4rem))`, top: `min(${settings.y * 100}vh, calc(100vh - 4rem))` }
      : undefined;
  // Panels open towards the middle of the screen, on the side chosen.
  const { low, rightHalf } = where;
  // A side that doesn't fit (Apus by that edge) turns to the other one.
  const side = settings.side === "left" && !rightHalf ? "right" : settings.side === "right" && rightHalf ? "left" : settings.side;
  const sideClass = {
    left: `right-full mr-2 ${low ? "bottom-0" : "top-0"}`,
    right: `left-full ml-2 ${low ? "bottom-0" : "top-0"}`,
    top: `bottom-full mb-2 ${rightHalf ? "right-0" : "left-0"}`,
    bottom: `top-full mt-2 ${rightHalf ? "right-0" : "left-0"}`,
  }[side];

  return (
    <div
      ref={root}
      className={`fixed z-40 select-none ${place ? "" : "bottom-4 left-4 md:bottom-6 md:left-auto md:right-6"}`}
      style={place}
      data-apus
      data-lure={appearance.lure}
      data-apus-mood={mood}
    >
      <button
        type="button"
        aria-label={a.open(unread)}
        aria-expanded={menu}
        title={a.name}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerEnter={() => !menu && flash("surprised", 350, "wave")}
        onPointerLeave={() => !menu && setMood("idle")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (menu) closeMenu();
            else {
              measure();
              flash("kiss", 1200);
              setMenu(true);
            }
          }
        }}
        className={`relative block touch-none rounded-full outline-offset-4 ${settings.minimized ? "h-11 w-11 border border-border bg-background shadow-md" : "h-16 w-16 md:h-24 md:w-24"} ${
          appearance.lure === "subtle" ? "opacity-60 hover:opacity-100" : ""
        }`}
        data-apus-button
      >
        <ApusFigure mood={mood} className="h-full w-full drop-shadow-lg" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-accent px-1.5 text-xs font-bold text-white" data-apus-unread>
            {unread}
          </span>
        )}
      </button>

      {toasts.length > 0 && !menu && (
        <ul className={`absolute ${sideClass} w-64 max-w-[calc(100vw-5rem)] space-y-2`} aria-live="polite" data-apus-toasts>
          {toasts.map((toast) => (
            <li key={toast.id} className="rounded-xl border border-border bg-background p-3 text-sm shadow-lg">
              <p className="text-xs text-muted">{toast.line}</p>
              {toast.href ? (
                <Link href={toast.href} className="block truncate hover:underline">
                  {toast.subject}
                </Link>
              ) : (
                <p className="truncate">{toast.subject}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {menu && (
        <div role="menu" aria-label={a.name} className={`absolute ${sideClass} w-72 max-w-[calc(100vw-5rem)] rounded-2xl border border-border bg-background p-2 text-sm shadow-xl`} data-apus-menu>
          {tab === "menu" ? (
            <>
              <p className="px-2 pb-1 font-semibold">{a.name}</p>
              <MenuButton onClick={() => act(() => window.dispatchEvent(new CustomEvent(OPEN_NOTIFICATIONS_EVENT, { detail: root.current })))} label={`🔔 ${t.notifications.title}${unread ? ` (${unread})` : ""}`} data="notifications" />
              <MenuButton onClick={() => act(() => window.dispatchEvent(new Event(OPEN_FEEDBACK_EVENT)))} label={`💬 ${a.feedback}`} data="feedback" />
              <MenuButton disabled label={`🤖 ${a.helper}`} hint={t.services.soon} data="helper" />
              <MenuButton onClick={() => act(() => window.dispatchEvent(new Event(ANGLER_GAME_EVENT)))} label={`🌊 ${a.game}`} data="game" />
              <MenuButton onClick={() => act(() => setTab("settings"))} label={`⚙️ ${a.settings}`} data="settings" />
              <div className="mt-1 flex gap-1 border-t border-border pt-1">
                <button type="button" onClick={() => act(() => update({ minimized: !settings.minimized }))} className="min-h-11 flex-1 rounded-lg px-2 hover:bg-surface md:min-h-9" data-apus-minimize>
                  {settings.minimized ? a.expand : a.minimize}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...appearance, lure: "hidden" as const };
                    setAppearance(next);
                    void saveAppearance({ showMascot: next.showMascot, lure: next.lure });
                  }}
                  className="min-h-11 flex-1 rounded-lg px-2 text-muted hover:bg-surface md:min-h-9"
                  data-apus-hide
                >
                  {a.hide}
                </button>
                <button type="button" onClick={closeMenu} aria-label={t.common.close} className="min-h-11 min-w-11 rounded-lg hover:bg-surface md:min-h-9">
                  ✕
                </button>
              </div>
              <p className="px-2 pt-1 text-xs text-muted">{a.hideHint}</p>
            </>
          ) : (
            <div className="space-y-3 p-1" data-apus-settings>
              <label className="flex flex-col gap-1">
                {a.side}
                <select value={settings.side} onChange={(e) => act(() => update({ side: e.target.value as ApusSettings["side"] }))} className="min-h-11 rounded-md border border-border bg-background px-2 md:min-h-9">
                  {SIDES.map((side) => (
                    <option key={side} value={side}>
                      {a.sides[side]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                {a.sound}
                <select value={settings.sound} onChange={(e) => update({ sound: e.target.value as ApusSound })} className="min-h-11 rounded-md border border-border bg-background px-2 md:min-h-9" data-apus-sound>
                  {SOUNDS.map((sound) => (
                    <option key={sound} value={sound} disabled={sound === "own" && !settings.ownSound}>
                      {a.sounds[sound]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                {a.ownSound}
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > OWN_SOUND_MAX) return setNote(a.ownTooBig);
                    const reader = new FileReader();
                    reader.onload = () => update({ ownSound: String(reader.result), sound: "own" });
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => act(() => playApusSound(settings))} className="min-h-11 flex-1 rounded-lg border border-border hover:bg-surface md:min-h-9">
                  ▶ {a.test}
                </button>
                <button type="button" onClick={() => setTab("menu")} className="min-h-11 flex-1 rounded-lg border border-border hover:bg-surface md:min-h-9">
                  ← {a.back}
                </button>
              </div>
              <p className="text-xs text-muted">{a.deviceOnly}</p>
              {note && (
                <p role="status" className="text-xs text-danger">
                  {note}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuButton({ onClick, label, hint, disabled, data }: { onClick?: () => void; label: string; hint?: string; disabled?: boolean; data: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-surface disabled:opacity-50 md:min-h-9"
      data-apus-item={data}
    >
      <span className="flex-1">{label}</span>
      {hint && <span className="rounded-full bg-accent/10 px-2 text-xs text-accent">{hint}</span>}
    </button>
  );
}
