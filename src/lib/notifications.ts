// Notifications (package 8) and project rules (package 7): shapes shared by the
// server actions and the screens.

export const NOTIFICATION_KINDS = ["mention", "assigned", "comment", "rule", "due", "event_invite", "event_request", "event_answer", "event_change", "event_reminder", "leave_request", "leave_decision", "leave_deputy", "leave_info", "birthday", "chat_mention", "chat_reply"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  created_at: string;
  read_at: string | null;
  actor: string | null;
  // Present only while the person may still see it.
  task: { id: string; key: string; project: string; number: number; title: string; status: string | null } | null;
  page: { id: string; title: string } | null;
  event?: { id: string; title: string; starts_at: string; all_day: boolean; cancelled: boolean } | null;
  // Time off: who and when (never the kind); whether it is mine or I am the deputy.
  leave?: { id: string; person: string; start_date: string; end_date: string; status: string; mine: boolean; deputy: boolean } | null;
  // A colleague's birthday: whose and which day (while it may still be seen).
  birthday?: { person: string; day: string } | null;
  // A chat message: its channel and the start of its text (while it may still be seen).
  chat?: { id: string; channel_id: string; channel: string; thread_root_id: string | null; excerpt: string } | null;
};
export type NotificationList = { unread: number; items: NotificationItem[] };

export const RULE_EVENTS = ["enter_category", "enter_status", "leave_status", "change_in_status", "assigned", "comment", "due_changed"] as const;
// Events that are about one column.
export const COLUMN_EVENTS: readonly string[] = ["enter_status", "leave_status", "change_in_status"];
export type RuleEvent = (typeof RULE_EVENTS)[number];
export const RULE_ROLES = ["assignee", "reporter", "owner"] as const;
export type RuleRole = (typeof RULE_ROLES)[number];

export type TaskRule = {
  id: string;
  event: RuleEvent;
  category: string | null;
  status_id: string | null;
  notify_roles: RuleRole[];
  notify_users: string[];
  notify_groups: string[];
  move_to_status?: string | null;
};
export type TaskRuleInput = {
  event: RuleEvent;
  category?: string;
  status_id?: string;
  roles: RuleRole[];
  users: string[];
  groups: string[];
  move_to_status?: string;
};

// Quiet hours and browser pop-ups are kept on this device only.
export type DeviceNotificationSettings = { browser: boolean; quietFrom: string; quietTo: string };
export const DEVICE_SETTINGS_KEY = "ek-notify-device";

export function readDeviceSettings(): DeviceNotificationSettings {
  try {
    const raw = window.localStorage.getItem(DEVICE_SETTINGS_KEY);
    if (raw) return { browser: false, quietFrom: "", quietTo: "", ...JSON.parse(raw) };
  } catch {
    // Storage blocked: defaults.
  }
  return { browser: false, quietFrom: "", quietTo: "" };
}

export function inQuietHours(settings: DeviceNotificationSettings, now = new Date()) {
  if (!settings.quietFrom || !settings.quietTo) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = settings.quietFrom.split(":").map(Number);
  const [th, tm] = settings.quietTo.split(":").map(Number);
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}
