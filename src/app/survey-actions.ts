"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { dataClient, writeClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { emptySurvey, newQuestion, type Answers, type SurveyResponse, type SurveyState } from "@/lib/surveys";
import { emptyWorkbook } from "@/lib/sheets";
import { t } from "@/i18n";

// Surveys (steps О1, О2, О4): objects of the service "surveys" in the shared
// objects table; answers through their own database functions. Every check is in
// the database; these forward the call to wherever the workspace keeps its data.

async function call<T extends object = object>(shortId: string, fn: string, args: Record<string, unknown>, refresh = true): Promise<ActionResult<T>> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  if (refresh) revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

const validId = (id: string | null | undefined) => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);

export async function createSurvey(shortId: string, title?: string) {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return { ok: false, error: "forbidden" } as ActionResult<{ id: string }>;
  return call<{ id: string }>(shortId, "create_service_object", {
    ws: workspace.id,
    target_service: "surveys",
    new_kind: "survey",
    new_title: (title ?? "").slice(0, 200),
    new_data: emptySurvey(newQuestion("single", t.surveys.builder.optionN)),
  });
}

// Saved often while editing the form: no page refresh.
export async function saveSurvey(shortId: string, id: string, title: string | null, data: unknown, version: number) {
  return call<{ version: number }>(shortId, "save_service_object", { target_object: id, new_title: title, new_data: data, base_version: version }, false);
}

export async function trashSurvey(shortId: string, id: string, restore = false) {
  return call(shortId, "trash_service_object", { target_object: id, restore });
}

export async function deleteSurveyForever(shortId: string, id: string) {
  return call(shortId, "delete_service_object_forever", { target_object: id });
}

export async function setSurveyWorkspaceRole(shortId: string, id: string, role: string | null) {
  return call(shortId, "set_service_object_workspace_role", { target_object: id, new_role: role });
}

export async function setSurveyMemberRole(shortId: string, id: string, member: string, role: string | null) {
  return call(shortId, "set_service_object_member_role", { target_object: id, member, new_role: role });
}

export async function setSurveyGroupRole(shortId: string, id: string, group: string, role: string | null) {
  return call(shortId, "set_service_object_group_role", { target_object: id, target_group: group, new_role: role });
}

export async function surveyState(shortId: string, id: string): Promise<SurveyState | null> {
  if (!validId(id)) return null;
  const db = await dataClient(shortId);
  const { data } = await db.rpc("survey_state", { target_object: id });
  return data?.ok ? (data as SurveyState) : null;
}

export type SurveySettingsPatch = Partial<{ anonymous: boolean; once: boolean; editable: boolean; accepting: boolean; closes_at: string | null; max_responses: number | null }>;

export async function setSurveySettings(shortId: string, id: string, patch: SurveySettingsPatch) {
  return call(shortId, "set_survey_settings", { target_object: id, new_settings: patch }, false);
}

export async function submitSurveyResponse(shortId: string, id: string, answers: Answers) {
  return call<{ edited: boolean }>(shortId, "submit_survey_response", { target_object: id, answers }, false);
}

export async function surveyAnswers(shortId: string, id: string): Promise<SurveyResponse[] | null> {
  if (!validId(id)) return null;
  const db = await dataClient(shortId);
  const { data } = await db.rpc("survey_answers", { target_object: id });
  return data?.ok ? ((data.responses ?? []) as SurveyResponse[]) : null;
}

export async function deleteSurveyResponse(shortId: string, id: string, response: string) {
  return call(shortId, "delete_survey_response", { target_object: id, target_response: response }, false);
}

const sheetLabels = () => ({ time: t.surveys.sheet.time, person: t.surveys.sheet.person, anonymous: t.surveys.sheet.anonymous });

// Connecting a table: an existing one, a new one (`sheet` null, named after the
// survey), or none (`disconnect`).
export async function linkSurveySheet(shortId: string, id: string, sheet: string | null, surveyTitle: string, disconnect = false) {
  if (disconnect) return call<{ sheet?: string }>(shortId, "link_survey_sheet", { target_object: id, target_sheet: null, tab: null, labels: null });
  let target = sheet;
  if (!target) {
    const workspace = await getWorkspace(shortId);
    if (!workspace) return { ok: false, error: "forbidden" } as ActionResult<{ sheet?: string }>;
    const made = await call<{ id: string }>(shortId, "create_service_object", {
      ws: workspace.id,
      target_service: "sheets",
      new_kind: "sheet",
      new_title: t.surveys.sheet.newTitle(surveyTitle || t.surveys.untitled).slice(0, 200),
      new_data: emptyWorkbook(t.surveys.sheet.tab),
    });
    if (!made.ok) return made;
    target = made.id;
  }
  const linked = await call(shortId, "link_survey_sheet", { target_object: id, target_sheet: target, tab: t.surveys.sheet.tab, labels: sheetLabels() });
  return linked.ok ? ({ ok: true, sheet: target } as ActionResult<{ sheet?: string }>) : (linked as ActionResult<{ sheet?: string }>);
}

// Tables the person may connect (they must be able to edit it; the database checks again).
export async function sheetsToConnect(shortId: string): Promise<{ id: string; title: string }[]> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return [];
  const db = await dataClient(shortId);
  const { data } = await db
    .from("service_objects")
    .select("id, title")
    .eq("workspace_id", workspace.id)
    .eq("service", "sheets")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  return (data ?? []) as { id: string; title: string }[];
}

// Step О4: surveys inside wiki pages (the form, or the results for those who may
// see them), read live with the reader's own access, and in search.

export type SurveySummary = { id: string; title: string };
export type SurveyView = { id: string; title: string; data: unknown; state: SurveyState };

export async function surveysForEmbed(shortId: string): Promise<SurveySummary[]> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return [];
  const db = await dataClient(shortId);
  const { data } = await db
    .from("service_objects")
    .select("id, title")
    .eq("workspace_id", workspace.id)
    .eq("service", "surveys")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  return (data ?? []) as SurveySummary[];
}

export async function surveyView(shortId: string, id: string): Promise<SurveyView | null> {
  if (!validId(id)) return null;
  const db = await dataClient(shortId);
  const [{ data }, { data: state }] = await Promise.all([
    db.from("service_objects").select("id, title, data, deleted_at").eq("id", id).eq("service", "surveys").maybeSingle(),
    db.rpc("survey_state", { target_object: id }),
  ]);
  if (!data || data.deleted_at || !state?.ok) return null;
  return { id: data.id, title: data.title, data: data.data, state: state as SurveyState };
}

export type SurveyHit = { id: string; title: string; snippet: string };

// Surveys whose name, sections, questions or choices have the words (search "Опитування").
export async function searchSurveys(shortId: string, query: string): Promise<SurveyHit[]> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return [];
  const db = await dataClient(shortId);
  const words = query.trim().slice(0, 200);
  let request = db.from("service_objects").select("id, title, search_text").eq("workspace_id", workspace.id).eq("service", "surveys").is("deleted_at", null);
  if (words) {
    const like = `%${words.replace(/[%_\\,()]/g, " ")}%`;
    request = request.or(`title.ilike.${like},search_text.ilike.${like}`);
  }
  const { data } = await request.order("updated_at", { ascending: false }).limit(20);
  return ((data ?? []) as { id: string; title: string; search_text: string }[]).map((row) => {
    const at = words ? row.search_text.toLowerCase().indexOf(words.toLowerCase()) : -1;
    return { id: row.id, title: row.title, snippet: at >= 0 ? row.search_text.slice(Math.max(0, at - 30), at + words.length + 50) : row.search_text.slice(0, 80) };
  });
}
