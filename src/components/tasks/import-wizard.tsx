"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { TASK_PRIORITIES, TASK_TYPES, personLabel } from "@/lib/tasks";
import { OUR_ROLES, parseTrackerLink, suggestPriority, suggestRole, suggestType, type OurPriority, type OurRole, type OurType } from "@/lib/tracker-convert";
import type { ImportOutline, ImportPlan, ImportPreview, ImportProgress, ImportState, ImportTarget } from "@/lib/tracker/types";
import { trackerConnect, trackerForget, trackerGaps, trackerOutline, trackerPreview, trackerRefresh, trackerRetryFiles, trackerStart, trackerState, trackerStep, type ImportGap } from "@/app/task-import-actions";
import { Button, buttonClass, inputClass } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PriorityIcon, StatusDot, TypeIcon } from "./task-icons";
import { labelTint } from "./task-pickers";

const TaskDescription = dynamic(() => import("./task-description"), { ssr: false, loading: () => <p className="text-sm text-muted">…</p> });

const m = t.tasks.importer;
const k = t.tasks;
const selectClass = "min-h-11 min-w-0 rounded-lg border border-border bg-background px-2 text-sm hover:border-border-strong md:h-9 md:min-h-0";
const errorText = (code: string) => m.errors[code.split(":")[0]] ?? t.common.unknownError;
type Step = "connect" | "plan" | "preview" | "run";

// The move from another tracker in four steps: connect, say what goes where, look at
// the first tasks, move. Coming back later continues from where it stopped.
export function ImportWizard({ shortId, initial, configured }: { shortId: string; initial: ImportState | null; configured: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState(initial);
  const [step, setStep] = useState<Step>(initial && initial.state !== "draft" ? "run" : initial ? "plan" : "connect");
  const [outline, setOutline] = useState<ImportOutline | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [moving, setMoving] = useState(false);

  // Coming back to an unfinished draft: read the tracker again.
  const importId = state?.id ?? null;
  const needOutline = step === "plan" && !outline && importId;
  useEffect(() => {
    if (!needOutline) return;
    let live = true;
    void trackerOutline(shortId, needOutline).then((result) => {
      if (!live) return;
      if (!result.ok) return setError(errorText(result.error));
      setOutline(result.outline);
      setPlan(firstPlan(result.outline));
    });
    return () => {
      live = false;
    };
  }, [needOutline, shortId]);

  // The move itself: one page after another while this screen is open.
  useEffect(() => {
    if (!moving || !importId) return;
    let live = true;
    const loop = async () => {
      while (live) {
        const result = await trackerStep(shortId, importId);
        if (!live) return;
        if (!result.ok) {
          setError(errorText(result.error));
          setState(await trackerState(shortId));
          return setMoving(false);
        }
        setState((before) => (before ? { ...before, state: result.state, progress: result.progress } : before));
        if (result.state !== "running") {
          setMoving(false);
          return router.refresh();
        }
      }
    };
    void loop();
    return () => {
      live = false;
    };
  }, [moving, importId, shortId, router]);

  if (!configured) return <p className="mt-6 rounded-xl border border-border bg-surface p-4 text-sm text-muted">{m.notConfigured}</p>;

  const steps: Step[] = ["connect", "plan", "preview", "run"];
  return (
    <div className="mt-5" data-import-wizard={step}>
      <ol className="flex flex-wrap gap-1 text-xs text-muted" aria-label={m.title}>
        {steps.map((name, index) => (
          <li key={name} aria-current={name === step ? "step" : undefined} className={`rounded-full px-3 py-1 ${name === step ? "bg-accent/15 font-medium text-accent" : "bg-hover"}`}>
            {index + 1}. {m.steps[name]}
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm" data-import-error>
          {error}
        </p>
      )}

      {step === "connect" && (
        <ConnectForm
          pending={pending}
          onSubmit={(link, project, account, token) =>
            startTransition(async () => {
              const result = await trackerConnect(shortId, link, project, account, token);
              if (!result.ok) return setError(errorText(result.error));
              setError(null);
              setOutline(null);
              setState({ id: result.importId, state: "draft", site: "", sourceProject: project, projectKey: null, progress: null, lastError: null, createdAt: new Date().toISOString() });
              setStep("plan");
            })
          }
        />
      )}

      {step === "plan" && (!outline || !plan ? (
        !error && <p className="mt-6 text-sm text-muted">{m.loading}</p>
      ) : (
        <PlanForm
          outline={outline}
          plan={plan}
          setPlan={setPlan}
          pending={pending}
          onBack={() => (setStep("connect"), setError(null))}
          onNext={() =>
            startTransition(async () => {
              const result = await trackerPreview(shortId, outline.importId, plan);
              if (!result.ok) return setError(errorText(result.error));
              setError(null);
              setPreview(result.preview);
              setStep("preview");
            })
          }
        />
      ))}

      {step === "preview" && outline && plan && preview && (
        <section className="mt-5" data-import-preview>
          <h2 className="font-semibold">{m.previewTitle}</h2>
          <p className="mt-1 text-sm text-muted">{m.previewHint}</p>
          {preview.length === 0 && <p className="mt-4 text-sm text-muted">{m.previewEmpty}</p>}
          <ul className="mt-4 space-y-3">
            {preview.map((task) => (
              <li key={task.key} className="rounded-xl border border-border p-4" data-import-preview-task={task.key}>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <TypeIcon type={task.type} />
                  <span className="font-mono">{task.key}</span>
                  <span className="rounded-full border border-border px-2 py-0.5">{task.status}</span>
                  <span className="inline-flex items-center gap-1">
                    <PriorityIcon priority={task.priority} /> {k.priorities[task.priority]}
                  </span>
                  {task.due && <span>{task.due}</span>}
                </p>
                <h3 className="mt-1 text-base font-semibold">{task.title}</h3>
                <p className="mt-1 text-xs text-muted">
                  {k.fields.assignee}: {task.assignee ?? k.unassigned} · {k.fields.reporter}: {task.reporter ?? "—"}
                </p>
                {task.labels.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1">
                    {task.labels.map((label) => (
                      <span key={label} className={`rounded-full px-2 py-0.5 text-xs font-medium ${labelTint(label)}`}>
                        {label}
                      </span>
                    ))}
                  </p>
                )}
                {task.description && (
                  <div className="-mx-3 mt-2 border-t border-border pt-2">
                    <TaskDescription shortId={shortId} taskId="" initial={task.description} editable={false} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => setStep("plan")} disabled={pending}>
              {m.back}
            </Button>
            <Button
              variant="primary"
              disabled={pending || preview.length === 0}
              data-import-start
              onClick={() => {
                if (!confirm(m.startConfirm(outline.total))) return;
                startTransition(async () => {
                  const result = await trackerStart(shortId, outline.importId, plan);
                  if (!result.ok) return setError(errorText(result.error));
                  setError(null);
                  setState(await trackerState(shortId));
                  setStep("run");
                  setMoving(true);
                });
              }}
            >
              {m.start}
            </Button>
          </div>
        </section>
      )}

      {step === "run" && state && (
        <RunView
          shortId={shortId}
          state={state}
          moving={moving}
          pending={pending}
          onResume={() => (setError(null), setMoving(true))}
          onRefresh={() =>
            startTransition(async () => {
              const result = await trackerRefresh(shortId, state.id);
              if (!result.ok) return setError(errorText(result.error));
              setError(null);
              setState(await trackerState(shortId));
              setMoving(true);
            })
          }
          onRetryFiles={() =>
            startTransition(async () => {
              const result = await trackerRetryFiles(shortId, state.id);
              if (!result.ok) return setError(errorText(result.error));
              setError(null);
              setState(await trackerState(shortId));
              setMoving(true);
            })
          }
          onAnother={() => {
            setOutline(null);
            setPlan(null);
            setPreview(null);
            setError(null);
            setStep("connect");
          }}
          onForget={() => {
            if (!confirm(m.forgetConfirm)) return;
            startTransition(async () => {
              await trackerForget(shortId, state.id);
              setState(null);
              setOutline(null);
              setPlan(null);
              setStep("connect");
              router.refresh();
            });
          }}
        />
      )}
    </div>
  );
}

// The first proposal: a new project under the tracker's key (or the choices when the
// key is busy), every status its own column, types, priorities and people by likeness.
function firstPlan(outline: ImportOutline): ImportPlan {
  const busy = outline.ours.projects.find((p) => p.key === outline.project.key);
  const shortKey = /^[A-Z][A-Z0-9]{1,9}$/.test(outline.project.key);
  const target: ImportTarget = busy
    ? { kind: "rename", projectId: busy.id, otherKey: freeKey(outline, `${outline.project.key.slice(0, 9)}0`), key: outline.project.key, name: outline.project.name.slice(0, 80) }
    : { kind: "new", key: shortKey ? outline.project.key : "", name: outline.project.name.slice(0, 80) };
  const start = outline.fields.find((f) => f.kind === "date" && /start|початок/i.test(f.name));
  return {
    target,
    statuses: Object.fromEntries(outline.statuses.map((s) => [s.id, "new"])),
    types: Object.fromEntries(outline.types.map((type) => [type.id, suggestType(type)])),
    priorities: Object.fromEntries(outline.priorities.map((name) => [name, suggestPriority(name)])),
    people: outline.ours.people,
    roles: Object.fromEntries((outline.roles ?? []).map((role) => [role.name, suggestRole(role.name)])),
    fields: outline.fields.filter((f) => f.id !== start?.id).map((f) => f.id),
    startField: start?.id ?? null,
  };
}

function freeKey(outline: ImportOutline, wanted: string) {
  const taken = new Set(outline.ours.projects.map((p) => p.key));
  let key = wanted;
  for (let i = 1; taken.has(key) && i < 10; i++) key = `${wanted.slice(0, 9)}${i}`;
  return key;
}

function ConnectForm({ pending, onSubmit }: { pending: boolean; onSubmit: (link: string, project: string, account: string, token: string) => void }) {
  const [link, setLink] = useState("");
  const [project, setProject] = useState("");
  const [account, setAccount] = useState("");
  const [token, setToken] = useState("");
  return (
    <form
      className="mt-5 max-w-xl space-y-3"
      aria-label={m.steps.connect}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(link, project, account, token);
      }}
    >
      <Labeled label={m.source}>
        <select className={`${selectClass} w-full`} defaultValue="jira_cloud" data-import-source>
          <option value="jira_cloud">{m.sources.jira_cloud}</option>
        </select>
      </Labeled>
      <Labeled label={m.link} hint={m.linkHint}>
        <input
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            // The project's key is taken from the link when it is there.
            const found = parseTrackerLink(e.target.value)?.project;
            if (found && !project) setProject(found);
          }}
          required
          inputMode="url"
          autoComplete="off"
          className={inputClass}
          data-import-link
        />
      </Labeled>
      <Labeled label={m.project}>
        <input value={project} onChange={(e) => setProject(e.target.value.toUpperCase())} required maxLength={20} autoComplete="off" className={`${inputClass} font-mono`} data-import-project />
      </Labeled>
      <Labeled label={m.account}>
        <input type="email" value={account} onChange={(e) => setAccount(e.target.value)} required autoComplete="off" className={inputClass} data-import-account />
      </Labeled>
      <Labeled label={m.token} hint={m.tokenHint}>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} required autoComplete="new-password" className={inputClass} data-import-token />
      </Labeled>
      <Button type="submit" variant="primary" disabled={pending} data-import-connect>
        {pending ? m.checking : m.connect}
      </Button>
    </form>
  );
}

function PlanForm({ outline, plan, setPlan, pending, onBack, onNext }: { outline: ImportOutline; plan: ImportPlan; setPlan: (plan: ImportPlan) => void; pending: boolean; onBack: () => void; onNext: () => void }) {
  const busy = outline.ours.projects.find((p) => p.key === outline.project.key);
  const target = plan.target;
  const setTarget = (next: ImportTarget) => setPlan({ ...plan, target: next });
  const merging = target.kind === "merge" ? outline.ours.projects.find((p) => p.id === target.projectId) : undefined;
  const matched = useMemo(() => Object.values(plan.people).filter(Boolean).length, [plan.people]);
  const name = "name" in target ? target.name : "";
  const dateFields = outline.fields.filter((f) => f.kind === "date");
  return (
    <div className="mt-5 max-w-3xl space-y-6" data-import-plan>
      <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm" data-import-found>
        <span className="font-mono text-xs text-muted">{outline.project.key}</span> {m.found(outline.project.name, outline.total)}
      </p>

      <Group title={m.target}>
        {!busy ? (
          <p className="text-sm">{m.targetNew(target.kind === "new" ? target.key || "…" : outline.project.key)}</p>
        ) : (
          <>
            <p className="text-sm text-muted">{m.keyBusy(busy.key, busy.name)}</p>
            <Choice checked={target.kind === "rename"} onPick={() => setTarget({ kind: "rename", projectId: busy.id, otherKey: freeKey(outline, `${busy.key.slice(0, 9)}0`), key: busy.key, name: name || outline.project.name.slice(0, 80) })} label={m.targetRename(busy.name)} hook="rename">
              {target.kind === "rename" && (
                <Labeled label={m.targetRenameKey}>
                  <input value={target.otherKey} onChange={(e) => setTarget({ ...target, otherKey: e.target.value.toUpperCase() })} maxLength={10} className={`${inputClass} max-w-40 font-mono`} data-import-other-key />
                </Labeled>
              )}
            </Choice>
            <Choice checked={target.kind === "merge"} onPick={() => setTarget({ kind: "merge", projectId: busy.id })} label={m.targetMerge(busy.name)} hook="merge">
              {target.kind === "merge" && <p className="text-xs text-muted">{m.targetMergeHint}</p>}
            </Choice>
            <Choice checked={target.kind === "new"} onPick={() => setTarget({ kind: "new", key: "", name: name || outline.project.name.slice(0, 80) })} label={m.targetOther} hook="other" />
          </>
        )}
        {target.kind === "new" && (busy || !/^[A-Z][A-Z0-9]{1,9}$/.test(outline.project.key)) && (
          <Labeled label={m.targetOtherKey}>
            <input value={target.key} onChange={(e) => setTarget({ ...target, key: e.target.value.toUpperCase() })} maxLength={10} className={`${inputClass} max-w-40 font-mono`} data-import-new-key />
          </Labeled>
        )}
        {target.kind !== "merge" && (
          <Labeled label={m.targetName}>
            <input value={target.name} onChange={(e) => setTarget({ ...target, name: e.target.value })} maxLength={80} className={inputClass} data-import-name />
          </Labeled>
        )}
      </Group>

      <Group title={m.statuses}>
        {!merging && <p className="text-xs text-muted">{m.statusesNew}</p>}
        <ul className="space-y-1">
          {outline.statuses.map((status) => (
            <li key={status.id} className="flex flex-wrap items-center gap-2 text-sm" data-import-status={status.name}>
              <StatusDot category={status.category} />
              <span className="min-w-32 flex-1">{status.name}</span>
              {merging && (
                <select
                  value={plan.statuses[status.id] ?? "new"}
                  onChange={(e) => setPlan({ ...plan, statuses: { ...plan.statuses, [status.id]: e.target.value } })}
                  aria-label={status.name}
                  className={`${selectClass} flex-1`}
                >
                  <option value="new">{m.newColumn(status.name)}</option>
                  {merging.columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              )}
            </li>
          ))}
        </ul>
      </Group>

      <Group title={m.types}>
        <Pairs
          items={outline.types.map((type) => ({ id: type.id, name: type.name }))}
          value={plan.types}
          options={TASK_TYPES.map((value) => ({ value, label: k.types[value] }))}
          onChange={(types) => setPlan({ ...plan, types: types as Record<string, OurType> })}
        />
      </Group>

      <Group title={m.priorities}>
        <Pairs
          items={outline.priorities.map((value) => ({ id: value, name: value }))}
          value={plan.priorities}
          options={TASK_PRIORITIES.map((value) => ({ value, label: k.priorities[value] }))}
          onChange={(priorities) => setPlan({ ...plan, priorities: priorities as Record<string, OurPriority> })}
        />
      </Group>

      <Group title={m.people}>
        <p className="text-xs text-muted" data-import-people-found>
          {m.peopleHint(matched, outline.users.length)}
        </p>
        <Pairs
          items={outline.users.map((user) => ({ id: user.id, name: user.email ? `${user.name} · ${user.email}` : user.name }))}
          value={Object.fromEntries(Object.entries(plan.people).map(([id, member]) => [id, member ?? ""]))}
          options={[{ value: "", label: m.keepName }, ...outline.ours.members.map((member) => ({ value: member.id, label: personLabel(member) }))]}
          onChange={(people) => setPlan({ ...plan, people: Object.fromEntries(Object.entries(people).map(([id, member]) => [id, member || null])) })}
        />
      </Group>

      {(outline.roles ?? []).length > 0 && (
        <Group title={m.roles}>
          <p className="text-xs text-muted">{m.rolesHint}</p>
          <div data-import-roles>
            <Pairs
              items={outline.roles.map((role) => ({ id: role.name, name: `${role.name} · ${role.users.length}` }))}
              value={Object.fromEntries(outline.roles.map((role) => [role.name, plan.roles?.[role.name] ?? ""]))}
              options={[{ value: "", label: m.noRole }, ...OUR_ROLES.map((role) => ({ value: role, label: t.tasks.roles[role] }))]}
              onChange={(roles) => setPlan({ ...plan, roles: Object.fromEntries(Object.entries(roles).map(([name, role]) => [name, (role || null) as OurRole | null])) })}
            />
          </div>
        </Group>
      )}

      <Group title={m.fields}>
        {outline.fields.length === 0 ? (
          <p className="text-sm text-muted">{m.noFields}</p>
        ) : (
          <>
            <p className="text-xs text-muted">{m.fieldsHint}</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {outline.fields
                .filter((field) => field.id !== plan.startField)
                .map((field) => (
                  <li key={field.id}>
                    <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
                      <input
                        type="checkbox"
                        checked={plan.fields.includes(field.id)}
                        onChange={(e) => setPlan({ ...plan, fields: e.target.checked ? [...plan.fields, field.id] : plan.fields.filter((id) => id !== field.id) })}
                        className="h-5 w-5 md:h-4 md:w-4"
                      />
                      {field.name} <span className="text-xs text-muted">· {k.customFields.kinds[field.kind]}</span>
                    </label>
                  </li>
                ))}
            </ul>
            {dateFields.length > 0 && (
              <Labeled label={m.startField}>
                <select value={plan.startField ?? ""} onChange={(e) => setPlan({ ...plan, startField: e.target.value || null, fields: plan.fields.filter((id) => id !== e.target.value) })} className={`${selectClass} max-w-xs`}>
                  <option value="">{m.noStartField}</option>
                  {dateFields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
                </select>
              </Labeled>
            )}
          </>
        )}
      </Group>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onBack} disabled={pending}>
          {m.back}
        </Button>
        <Button variant="primary" onClick={onNext} disabled={pending} data-import-to-preview>
          {pending ? m.loading : m.toPreview}
        </Button>
      </div>
    </div>
  );
}

const megabytes = (bytes: number) => (bytes >= 1024 * 1024 ? Math.round(bytes / (1024 * 1024)) : bytes > 0 ? 1 : 0);

// What could not come over (files too big, refused by the tracker or the Drive), with a
// way to try again while the connection to the tracker is kept.
function Gaps({ shortId, projectKey, pending, onRetry }: { shortId: string; projectKey: string; pending: boolean; onRetry: () => void }) {
  const [gaps, setGaps] = useState<ImportGap[] | null>(null);
  useEffect(() => {
    let live = true;
    void trackerGaps(shortId, projectKey).then((rows) => live && setGaps(rows));
    return () => {
      live = false;
    };
  }, [shortId, projectKey]);
  if (!gaps?.length) return null;
  return (
    <div className="mt-4 rounded-xl border border-border p-3 text-sm" data-import-gaps>
      <h3 className="font-medium">{m.gaps.title(gaps.length)}</h3>
      <p className="mt-1 text-xs text-muted">{m.gaps.hint}</p>
      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
        {gaps.map((gap) => (
          <li key={gap.id} className="flex flex-wrap gap-x-2 text-xs" data-import-gap={gap.name}>
            <span className="font-mono text-muted">{gap.task}</span>
            <span className="min-w-0 flex-1 truncate">{gap.name}</span>
            <span className="text-muted">
              {gap.bytes ? `${megabytes(gap.bytes)} ${m.gaps.mb} · ` : ""}
              {m.gaps.reasons[gap.reason] ?? gap.reason}
            </span>
          </li>
        ))}
      </ul>
      <Button className="mt-3" onClick={onRetry} disabled={pending} data-import-retry-files>
        {m.gaps.retry}
      </Button>
    </div>
  );
}

function RunView({ shortId, state, moving, pending, onResume, onRetryFiles, onRefresh, onForget, onAnother }: { shortId: string; state: ImportState; moving: boolean; pending: boolean; onResume: () => void; onRetryFiles: () => void; onRefresh: () => void; onForget: () => void; onAnother: () => void }) {
  const progress: ImportProgress | null = state.progress;
  const done = state.state === "done";
  const share = progress ? (progress.phase === "tasks" ? Math.min(1, progress.seen / Math.max(1, progress.total)) : 1) : 0;
  return (
    <section className="mt-5 max-w-2xl" data-import-run={state.state}>
      <h2 className="font-semibold">{done ? m.done : state.state === "failed" || (!moving && state.state === "running") ? m.failed : progress?.phase === "relations" ? m.linking : progress?.phase === "activity" ? m.activity : progress?.phase === "files" ? m.movingFiles : m.running}</h2>
      {progress && !done && (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.seen} aria-label={m.running}>
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${share * 100}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted" data-import-progress>
            {progress.phase === "files" ? m.filesProgress(progress.files ?? 0, megabytes(progress.fileBytes ?? 0)) : m.progress(Math.min(progress.seen, progress.total), progress.total)}
          </p>
          {moving ? <p className="mt-3 text-sm text-muted">{m.keepOpen}</p> : null}
        </>
      )}
      {state.lastError && !moving && !done && <p className="mt-2 text-sm text-danger">{errorText(state.lastError)}</p>}
      {!moving && !done && (
        <Button variant="primary" className="mt-3" onClick={onResume} disabled={pending} data-import-resume>
          {m.resume}
        </Button>
      )}
      {done && state.projectKey && <Gaps key={`${state.projectKey}:${progress?.files ?? 0}:${progress?.filesMissed ?? 0}`} shortId={shortId} projectKey={state.projectKey} pending={pending} onRetry={onRetryFiles} />}
      {progress && done && (
        <div className="mt-3 space-y-1 text-sm" data-import-report>
          <p>{m.report.created(progress.created)}</p>
          {(progress.comments ?? 0) + (progress.moves ?? 0) > 0 && <p data-import-report-activity>{m.report.activity(progress.comments ?? 0, progress.moves ?? 0)}</p>}
          {(progress.files ?? 0) + (progress.filesKept ?? 0) > 0 && <p data-import-report-files>{m.report.files((progress.files ?? 0) + (progress.filesKept ?? 0), megabytes(progress.fileBytes ?? 0))}</p>}
          {(progress.people ?? 0) > 0 && <p data-import-report-people>{m.report.people(progress.people ?? 0, progress.seated ?? 0)}</p>}
          {progress.updated > 0 && <p>{m.report.updated(progress.updated)}</p>}
          <p>{m.report.parents(progress.parents)}</p>
          <p>{m.report.links(progress.links)}</p>
          {progress.missing > 0 && <p className="text-muted">{m.report.missing(progress.missing)}</p>}
          {Object.entries(progress.notes).map(([note, count]) => (
            <p key={note} className="text-muted">
              {m.notes[note]?.(count) ?? `${note}: ${count}`}
            </p>
          ))}
          {progress.skipped.length === 0 ? (
            <p className="font-medium text-emerald-700 dark:text-emerald-400" data-import-all-moved>
              <Icon name="check" className="mr-1 inline" />
              {m.report.allMoved}
            </p>
          ) : (
            <div data-import-skipped>
              <p className="font-medium text-danger">{m.report.skipped(progress.skipped.length)}</p>
              <ul className="mt-1 max-h-48 overflow-y-auto text-xs text-muted">
                {progress.skipped.map((item) => (
                  <li key={item.key}>
                    <span className="font-mono">{item.key}</span> — {m.reasons[item.reason] ?? item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="pt-2 text-xs text-muted">{m.report.later}</p>
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {state.projectKey && (
          <Link href={workspacePath(shortId, `/tasks/${state.projectKey}`)} className={buttonClass(done ? "primary" : "subtle")} data-import-open-project>
            {m.openProject}
          </Link>
        )}
        {done && (
          <Button onClick={onAnother} disabled={pending} data-import-another>
            {m.another}
          </Button>
        )}
        {done && (
          <Button onClick={onRefresh} disabled={pending} title={m.refreshHint} data-import-refresh>
            <Icon name="refresh" />
            {m.refresh}
          </Button>
        )}
        {!moving && (
          <Button variant="danger" onClick={onForget} disabled={pending} data-import-forget>
            {m.forget}
          </Button>
        )}
      </div>
    </section>
  );
}

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-border p-4" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Choice({ checked, onPick, label, hook, children }: { checked: boolean; onPick: () => void; label: string; hook: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
        <input type="radio" name="import-target" checked={checked} onChange={onPick} className="h-5 w-5 md:h-4 md:w-4" data-import-target={hook} />
        {label}
      </label>
      {children && <div className="ml-7">{children}</div>}
    </div>
  );
}

// "This of theirs is that of ours", one line per thing.
function Pairs({ items, value, options, onChange }: { items: { id: string; name: string }[]; value: Record<string, string>; options: { value: string; label: string }[]; onChange: (next: Record<string, string>) => void }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-32 flex-1 truncate">{item.name}</span>
          <select value={value[item.id] ?? ""} onChange={(e) => onChange({ ...value, [item.id]: e.target.value })} aria-label={item.name} className={`${selectClass} flex-1`}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  );
}
