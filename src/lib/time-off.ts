// Doba, time off: shapes shared by the server actions and the screens. Dates are plain
// "YYYY-MM-DD" days; who may see and do what is decided by the database.

export const LEAVE_KINDS = ["vacation", "sick", "day_off", "remote", "other"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type LeaveHalf = "first" | "second";

export type LeavePolicyFields = {
  name: string;
  kind: LeaveKind;
  days_per_year: number;
  carry_over_max: number;
  count_days: "working" | "calendar";
  requires_approval: boolean;
  requires_deputy: boolean;
  show_kind: boolean;
  allow_negative: boolean;
  unlimited: boolean;
  active: boolean;
};
// A policy with the viewer's own numbers for the year.
export type LeavePolicy = LeavePolicyFields & { id: string; granted: number; used: number; pending: number };

export type MyLeaveRequest = {
  id: string;
  policy_id: string;
  start_date: string;
  end_date: string;
  half: LeaveHalf | null;
  days: number;
  comment: string;
  status: LeaveStatus;
  deputy: string | null;
  decided_by: string | null;
  decision_note: string;
  created_at: string;
};
export type MyLeave = { today: string; manager: boolean; policies: LeavePolicy[]; requests: MyLeaveRequest[] };

export type InboxRequest = {
  id: string;
  user_id: string;
  person: string;
  policy: string;
  unlimited: boolean;
  start_date: string;
  end_date: string;
  half: LeaveHalf | null;
  days: number;
  comment: string;
  status: LeaveStatus;
  deputy: string | null;
  decision_note: string;
  created_at: string;
  // What the person has left of this policy for that year (approved requests taken off).
  balance: number;
};

export type Absence = {
  id: string;
  user_id: string;
  person: string;
  start_date: string;
  end_date: string;
  half: LeaveHalf | null;
  remote: boolean;
  deputy: string | null;
  // The policy's name, when the viewer may know it.
  label: string | null;
};
export type UnitOverlap = { name: string; start_date: string; end_date: string; status: LeaveStatus };
export type BalanceSheet = { people: { id: string; name: string; numbers: Record<string, { granted: number; used: number; pending: number }> }[] };

export const NEW_POLICY: LeavePolicyFields = {
  name: "",
  kind: "other",
  days_per_year: 0,
  carry_over_max: 0,
  count_days: "working",
  requires_approval: true,
  requires_deputy: false,
  show_kind: false,
  allow_negative: false,
  unlimited: false,
  active: true,
};

export const parseDay = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
// 0.5 → "0,5" / "0.5", 3 → "3".
export const daysText = (n: number, locale: string) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(n));
export const left = (p: { granted: number; used: number }) => Number(p.granted) - Number(p.used);
