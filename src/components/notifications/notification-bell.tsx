"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { dateLocale, t } from "@/i18n";
import { pagePath, workspacePath } from "@/lib/paths";
import {
  DEVICE_SETTINGS_KEY,
  NOTIFICATION_KINDS,
  inQuietHours,
  readDeviceSettings,
  type DeviceNotificationSettings,
  type NotificationItem,
  type NotificationKind,
  type NotificationList,
} from "@/lib/notifications";
import { loadNotificationPrefs, loadNotifications, markNotificationsRead, setNotificationPrefs } from "@/app/notification-actions";
import { usePages } from "@/components/pages/pages-provider";
import { Popover } from "@/components/ui/popover";
import { Icon } from "@/components/ui/icon";

const n = t.notifications;
export const NOTIFICATIONS_EVENT = "ek-notifications";
export const OPEN_NOTIFICATIONS_EVENT = "ek-open-notifications";
export type NotificationNews = { unread: number; fresh: { line: string; subject: string; href: string | null }[] };
const POLL_MS = 30_000;

function hrefOf(shortId: string, item: NotificationItem) {
  if (item.task) return workspacePath(shortId, `/tasks/${item.task.project}/${item.task.number}`);
  if (item.page) return pagePath(shortId, item.page.id);
  if (item.event) return workspacePath(shortId, `/calendar?event=${item.event.id}`);
  if (item.leave) return workspacePath(shortId, `/calendar/time-off?tab=${item.leave.mine ? "mine" : item.leave.deputy ? "team" : "inbox"}`);
  if (item.birthday) return workspacePath(shortId, `/calendar?view=list&date=${item.birthday.day}`);
  if (item.chat)
    return workspacePath(shortId, `/chat?c=${item.chat.channel_id}${item.chat.thread_root_id ? `&t=${item.chat.thread_root_id}` : ""}&m=${item.chat.id}`);
  return null;
}

function lineOf(item: NotificationItem) {
  const who = item.actor ?? n.someone;
  return (n.line[item.kind] ?? n.line.rule)(who);
}

const leaveDay = (key: string) => new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short" }).format(new Date(`${key}T00:00:00`));
const leaveDates = (leave: { start_date: string; end_date: string }) =>
  leave.start_date === leave.end_date ? leaveDay(leave.start_date) : `${leaveDay(leave.start_date)} – ${leaveDay(leave.end_date)}`;

function subjectOf(item: NotificationItem) {
  if (item.task) return `${item.task.key} ${item.task.title}${item.kind === "rule" && item.task.status ? ` → ${item.task.status}` : ""}`;
  if (item.page) return item.page.title || t.pages.untitled;
  if (item.leave) return `${item.leave.person} · ${leaveDates(item.leave)} · ${t.timeOff.status[item.leave.status] ?? ""}`;
  if (item.birthday) return `${item.birthday.person} · ${leaveDay(item.birthday.day)}`;
  if (item.chat) return `#${item.chat.channel} · ${item.chat.excerpt}`;
  if (item.event && item.kind === "event_reminder")
    return `${item.event.title} · ${new Date(item.event.starts_at).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" })}`;
  if (item.event) return item.event.cancelled ? `${item.event.title} · ${t.calendar.details.cancelled}` : item.event.title;
  return n.hidden;
}

// The bell: unread count, the list, settings, and browser pop-ups for new items.
export function NotificationBell({ onNavigate }: { onNavigate?: () => void }) {
  const { workspace } = usePages();
  const [list, setList] = useState<NotificationList | null>(null);
  // The open panel's anchor (null: closed).
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;
  const setOpen = (value: false) => value || setAnchor(null);
  const [tab, setTab] = useState<"list" | "settings">("list");
  // Ids already known: only newer ones pop up in the browser.
  const seen = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    const next = await loadNotifications(workspace.shortId, workspace.id).catch(() => null);
    if (!next) return;
    const known = seen.current;
    seen.current = new Set(next.items.map((i) => i.id));
    setList(next);
    const fresh = known ? next.items.filter((i) => !i.read_at && !known.has(i.id)) : [];
    // Apus shows new ones beside itself (and plays its sound).
    window.dispatchEvent(new CustomEvent(NOTIFICATIONS_EVENT, { detail: { unread: next.unread, fresh: fresh.map((i) => ({ line: lineOf(i), subject: subjectOf(i), href: hrefOf(workspace.shortId, i) })) } }));
    if (!known) return;
    const device = readDeviceSettings();
    if (!fresh.length || !device.browser || inQuietHours(device)) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const item of fresh.slice(0, 3)) {
      const pop = new Notification(lineOf(item), { body: subjectOf(item), tag: item.id });
      const href = hrefOf(workspace.shortId, item);
      pop.onclick = () => {
        window.focus();
        if (href) window.location.assign(href);
      };
    }
  }, [workspace.id, workspace.shortId]);

  // Apus opens this panel next to itself.
  useEffect(() => {
    const open = (event: Event) => setAnchor((event as CustomEvent<HTMLElement>).detail);
    window.addEventListener(OPEN_NOTIFICATIONS_EVENT, open);
    return () => window.removeEventListener(OPEN_NOTIFICATIONS_EVENT, open);
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(() => document.visibilityState === "visible" || readDeviceSettings().browser ? refresh() : undefined, POLL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const unread = list?.unread ?? 0;
  const markAll = async () => {
    await markNotificationsRead(workspace.shortId, workspace.id, null);
    refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        aria-label={n.bell(unread)}
        aria-expanded={open}
        className="flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted hover:bg-hover hover:text-foreground md:min-h-8"
        data-notification-bell
      >
        <Icon name="bell" />
        <span className="flex-1 text-left">{n.title}</span>
        {unread > 0 && (
          <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-white" data-unread>
            {unread}
          </span>
        )}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={340}>
          <div className="flex items-center gap-1 border-b border-border p-1 text-sm">
            <button type="button" onClick={() => setTab("list")} className={`min-h-9 rounded px-2 ${tab === "list" ? "bg-surface font-medium" : "text-muted"}`}>
              {n.title}
            </button>
            <button type="button" onClick={() => setTab("settings")} className={`min-h-9 rounded px-2 ${tab === "settings" ? "bg-surface font-medium" : "text-muted"}`}>
              {n.settings}
            </button>
            {tab === "list" && unread > 0 && (
              <button type="button" onClick={markAll} className="ml-auto min-h-9 px-2 text-xs text-muted hover:text-foreground hover:underline">
                {n.markAll}
              </button>
            )}
          </div>
          {tab === "list" ? (
            <NotificationList items={list?.items ?? []} shortId={workspace.shortId} onOpen={async (item) => {
              setOpen(false);
              onNavigate?.();
              if (!item.read_at) {
                await markNotificationsRead(workspace.shortId, workspace.id, [item.id]);
                refresh();
              }
            }} />
          ) : (
            <NotificationSettings shortId={workspace.shortId} workspaceId={workspace.id} />
          )}
        </Popover>
      )}
    </>
  );
}

function NotificationList({ items, shortId, onOpen }: { items: NotificationItem[]; shortId: string; onOpen: (item: NotificationItem) => void }) {
  if (!items.length) return <p className="p-3 text-sm text-muted">{n.empty}</p>;
  return (
    <ul className="divide-y divide-border text-sm" data-notification-list>
      {items.map((item) => {
        const href = hrefOf(shortId, item);
        const body = (
          <>
            <span className="flex items-center gap-2 text-xs text-muted">
              {!item.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />}
              <span className="flex-1">{lineOf(item)}</span>
              <span>{new Date(item.created_at).toLocaleString(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </span>
            <span className="mt-0.5 block truncate">{subjectOf(item)}</span>
          </>
        );
        return (
          <li key={item.id} data-notification={item.kind}>
            {href ? (
              <Link prefetch={false} href={href} onClick={() => onOpen(item)} className="block rounded px-2 py-2 hover:bg-surface">
                {body}
              </Link>
            ) : (
              <div className="px-2 py-2 text-muted">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NotificationSettings({ shortId, workspaceId }: { shortId: string; workspaceId: string }) {
  const [muted, setMuted] = useState<NotificationKind[] | null>(null);
  const [device, setDevice] = useState<DeviceNotificationSettings>(() => readDeviceSettings());
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    loadNotificationPrefs(shortId, workspaceId).then(setMuted);
  }, [shortId, workspaceId]);

  const toggleKind = async (kind: NotificationKind, on: boolean) => {
    const next = on ? (muted ?? []).filter((k) => k !== kind) : [...(muted ?? []), kind];
    setMuted(next);
    const result = await setNotificationPrefs(shortId, workspaceId, next);
    setNote(result.ok ? n.saved : t.common.unknownError);
  };
  const saveDevice = (next: DeviceNotificationSettings) => {
    setDevice(next);
    try {
      window.localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: the setting lasts until the page is closed.
    }
  };
  const toggleBrowser = async (on: boolean) => {
    if (!on) return saveDevice({ ...device, browser: false });
    if (typeof Notification === "undefined") return setNote(n.browserUnsupported);
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return setNote(n.browserDenied);
    setNote(null);
    saveDevice({ ...device, browser: true });
  };

  return (
    <div className="space-y-3 p-2 text-sm" data-notification-settings>
      <p className="text-xs text-muted">{n.workspaceNote}</p>
      <ul className="space-y-1">
        {NOTIFICATION_KINDS.map((kind) => (
          <li key={kind}>
            <label className="flex min-h-9 items-center gap-2">
              <input type="checkbox" disabled={!muted} checked={!!muted && !muted.includes(kind)} onChange={(e) => toggleKind(kind, e.target.checked)} data-notify-kind={kind} />
              {n.kinds[kind]}
            </label>
          </li>
        ))}
      </ul>
      <p className="border-t border-border pt-2 text-xs text-muted">{n.deviceNote}</p>
      <label className="flex min-h-9 items-center gap-2">
        <input type="checkbox" checked={device.browser} onChange={(e) => toggleBrowser(e.target.checked)} />
        {n.browser}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span>{n.quietFrom}</span>
        <input type="time" value={device.quietFrom} onChange={(e) => saveDevice({ ...device, quietFrom: e.target.value })} className="rounded border border-border bg-background px-2 py-1" />
        <span>{n.quietTo}</span>
        <input type="time" value={device.quietTo} onChange={(e) => saveDevice({ ...device, quietTo: e.target.value })} className="rounded border border-border bg-background px-2 py-1" />
      </div>
      {note && (
        <p role="status" className="text-xs text-muted">
          {note}
        </p>
      )}
    </div>
  );
}
