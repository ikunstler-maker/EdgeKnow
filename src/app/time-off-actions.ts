"use server";

import type { ActionResult } from "@/lib/action-result";
import type { Absence, BalanceSheet, Holiday, InboxRequest, LeaveHalf, LeavePolicyFields, MyLeave, UnitOverlap } from "@/lib/time-off";
import { dataClient, writeClient } from "@/lib/team-db/data";

// Doba, time off: the database decides who sees and does what; these forward to
// wherever the workspace keeps its data. The screen reloads itself after a change.

async function call<T extends object = object>(shortId: string, fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<T>;
}

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export async function loadMyLeave(shortId: string, workspaceId: string, year: number): Promise<ActionResult<MyLeave>> {
  const db = await dataClient(shortId);
  const { data, error } = await db.rpc("my_leave", { ws: workspaceId, target_year: year });
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<MyLeave>;
}

export async function loadLeaveInbox(shortId: string, workspaceId: string): Promise<InboxRequest[]> {
  const db = await dataClient(shortId);
  const { data } = await db.rpc("leave_inbox", { ws: workspaceId });
  return (data ?? []) as InboxRequest[];
}

// Approved absences of a period, as every member may see them.
export async function loadAbsences(shortId: string, workspaceId: string, from: string, to: string): Promise<Absence[]> {
  if (!isDay(from) || !isDay(to)) return [];
  const db = await dataClient(shortId);
  const { data } = await db.rpc("team_absences", { ws: workspaceId, first_day: from, last_day: to });
  return (data ?? []) as Absence[];
}

// Who of the person's units is already off in these days (names and dates only).
export async function loadUnitOverlaps(shortId: string, workspaceId: string, person: string, from: string, to: string, except: string | null): Promise<UnitOverlap[]> {
  if (!isDay(from) || !isDay(to) || to < from) return [];
  const db = await dataClient(shortId);
  const { data } = await db.rpc("leave_unit_overlaps", { ws: workspaceId, person, first_day: from, last_day: to, except_request: except });
  return (data ?? []) as UnitOverlap[];
}

// The workspace's holidays of a period (members, not guests).
export async function loadHolidays(shortId: string, workspaceId: string, from: string, to: string): Promise<Holiday[]> {
  if (!isDay(from) || !isDay(to)) return [];
  const db = await dataClient(shortId);
  const { data } = await db.from("leave_holidays").select("day, name, created_at").eq("workspace_id", workspaceId).gte("day", from).lte("day", to).order("day").limit(500);
  return (data ?? []) as Holiday[];
}

export async function saveHoliday(shortId: string, workspaceId: string, day: string, name: string) {
  if (!isDay(day)) return { ok: false as const, error: "invalid" };
  return call(shortId, "save_leave_holiday", { ws: workspaceId, holiday: day, title: name });
}

export async function deleteHoliday(shortId: string, workspaceId: string, day: string) {
  if (!isDay(day)) return { ok: false as const, error: "invalid" };
  return call(shortId, "delete_leave_holiday", { ws: workspaceId, holiday: day });
}

// "The same as last year": same days and months; what is already there stays.
export async function copyHolidays(shortId: string, workspaceId: string, fromYear: number, toYear: number) {
  return call<{ added: number }>(shortId, "copy_leave_holidays", { ws: workspaceId, from_year: fromYear, to_year: toYear });
}

// When a person started work (null: unknown — the whole norm).
export async function setStartDate(shortId: string, workspaceId: string, person: string, day: string | null) {
  if (day !== null && !isDay(day)) return { ok: false as const, error: "invalid" };
  return call(shortId, "set_leave_start_date", { ws: workspaceId, person, started: day });
}

export async function loadBalanceSheet(shortId: string, workspaceId: string, year: number): Promise<ActionResult<BalanceSheet>> {
  const db = await dataClient(shortId);
  const { data, error } = await db.rpc("leave_balance_sheet", { ws: workspaceId, target_year: year });
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<BalanceSheet>;
}

export async function requestLeave(shortId: string, workspaceId: string, request: { policy: string; from: string; to: string; half: LeaveHalf | null; deputy: string | null; comment: string }) {
  if (!isDay(request.from) || !isDay(request.to)) return { ok: false as const, error: "invalid" };
  return call<{ id: string; status: string; days: number }>(shortId, "request_leave", {
    ws: workspaceId,
    target_policy: request.policy,
    first_day: request.from,
    last_day: request.to,
    part: request.half,
    deputy: request.deputy,
    note: request.comment,
  });
}

export async function decideLeave(shortId: string, requestId: string, approve: boolean, note: string) {
  return call(shortId, "decide_leave_request", { target: requestId, approve, note });
}

export async function cancelLeave(shortId: string, requestId: string) {
  return call(shortId, "cancel_leave_request", { target: requestId });
}

export async function seedLeavePolicies(shortId: string, workspaceId: string, names: Record<"vacation" | "sick" | "day_off" | "remote", string>) {
  return call<{ created: number }>(shortId, "seed_leave_policies", { ws: workspaceId, names });
}

export async function saveLeavePolicy(shortId: string, workspaceId: string, policyId: string | null, fields: LeavePolicyFields) {
  return call<{ id: string }>(shortId, "save_leave_policy", { ws: workspaceId, policy_id: policyId, fields });
}

export async function accrueLeaveYear(shortId: string, workspaceId: string, policyId: string, year: number) {
  return call<{ added: number }>(shortId, "accrue_leave_year", { ws: workspaceId, target_policy: policyId, target_year: year });
}

export async function adjustLeaveBalance(shortId: string, workspaceId: string, policyId: string, person: string, year: number, days: number, reason: string) {
  return call(shortId, "adjust_leave_balance", { ws: workspaceId, target_policy: policyId, person, target_year: year, delta: days, reason });
}
