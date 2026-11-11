"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";
import { defaultTemplate, type TaskTemplate, type TemplateData } from "@/lib/task-templates";
import { deleteTaskTemplate, loadTaskTemplates, saveTaskTemplate } from "@/app/task-actions";
import { Popover } from "@/components/ui/popover";
import { Icon } from "@/components/ui/icon";

const m = t.tasks.templates;
const k = t.tasks;
const inputClass = "min-h-11 rounded-lg border border-border bg-background px-2 text-base hover:border-border-strong md:h-9 md:min-h-0 md:text-sm";
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";

// The templates one sees in a project (its own and the project's), and the one picked
// for new tasks: the default until the person picks another.
export function useTemplates(projectId: string, enabled = true) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const reload = useCallback(async () => setTemplates(await loadTaskTemplates(projectId).catch(() => [])), [projectId]);
  useEffect(() => {
    if (!enabled) return;
    // Loads once per project (an async read, not a cascade of renders).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [enabled, reload]);
  const chosen = picked === undefined ? defaultTemplate(templates) : (templates.find((x) => x.id === picked) ?? null);
  return { templates, reload, chosen, pick: (id: string | null) => setPicked(id) };
}

// The project's templates and one's own on separate tabs, with a search when there are many.
export function TemplatePicker({ templates, chosen, onPick }: { templates: TaskTemplate[]; chosen: TaskTemplate | null; onPick: (id: string | null) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const mine = templates.filter((x) => x.owner_id);
  const [tab, setTab] = useState<"project" | "mine">(chosen?.owner_id ? "mine" : "project");
  const [query, setQuery] = useState("");
  if (!templates.length) return null;
  const list = (tab === "mine" ? mine : templates.filter((x) => !x.owner_id)).filter((x) => x.name.toLowerCase().includes(query.trim().toLowerCase()));
  const choose = (id: string | null) => {
    onPick(id);
    setAnchor(null);
  };
  return (
    <>
      <button
        type="button"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        aria-expanded={anchor !== null}
        title={m.forNew}
        className="flex min-h-11 max-w-44 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-sm hover:bg-surface md:min-h-9"
        data-template-picker
      >
        <Icon name="template" className="text-muted" />
        <span className="truncate">{chosen ? chosen.name : m.pick}</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={300}>
          <div className="flex gap-1 border-b border-border p-1 text-sm" role="tablist">
            {(["project", "mine"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`min-h-9 flex-1 rounded px-2 ${tab === value ? "bg-surface font-medium" : "text-muted"}`}
                data-template-tab={value}
              >
                {value === "project" ? m.project : m.mine} ({value === "mine" ? mine.length : templates.length - mine.length})
              </button>
            ))}
          </div>
          <div className="p-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={m.search} aria-label={m.search} className={`${inputClass} w-full`} />
          </div>
          <ul className="max-h-72 overflow-y-auto px-1 pb-1 text-sm" role="listbox" aria-label={tab === "mine" ? m.mine : m.project}>
            <li>
              <button type="button" role="option" aria-selected={!chosen} onClick={() => choose(null)} className="min-h-11 w-full rounded px-2 text-left text-muted hover:bg-surface md:min-h-9">
                {m.none}
              </button>
            </li>
            {list.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={chosen?.id === x.id}
                  onClick={() => choose(x.id)}
                  className={`flex min-h-11 w-full items-center gap-2 rounded px-2 text-left hover:bg-surface md:min-h-9 ${chosen?.id === x.id ? "font-medium" : ""}`}
                  data-template-option={x.name}
                >
                  <span className="flex-1 truncate">{x.name}</span>
                  {x.is_default && <span className="text-xs text-muted">{m.isDefault}</span>}
                </button>
              </li>
            ))}
            {!list.length && <li className="px-2 py-2 text-muted">{query.trim() ? m.notFound : tab === "mine" ? m.emptyMine : m.emptyProject}</li>}
          </ul>
        </Popover>
      )}
    </>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-xl bg-background shadow-xl sm:rounded-xl">
        <div className="flex items-center border-b border-border px-4 py-3">
          <h2 className="flex-1 font-semibold"><Icon name="template" className="mr-1.5 inline" />{title}</h2>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="min-h-11 min-w-11">
            <Icon name="close" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// «Save as template» from a task: its settings under a name, for the project or oneself.
export function SaveTemplateDialog({ projectId, isOwner, data, onClose }: { projectId: string; isOwner: boolean; data: TemplateData; onClose: () => void }) {
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [personal, setPersonal] = useState(!isOwner);
  const [makeDefault, setMakeDefault] = useState(false);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setPending(true);
    const result = await saveTaskTemplate(projectId, null, personal, name.trim(), { ...data, ...(prefix ? { title: prefix } : {}) }, makeDefault);
    setPending(false);
    if (!result.ok) return setNote({ error: true, text: k.errors[result.error] ?? t.common.unknownError });
    setNote({ error: false, text: m.saved });
    setTimeout(onClose, 700);
  };
  return (
    <Dialog title={m.saveAs} onClose={onClose}>
      <label className="flex flex-col gap-1">
        {m.name}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus className={inputClass} data-template-name />
      </label>
      <label className="flex flex-col gap-1">
        {m.titlePrefix}
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={100} placeholder="Bug: " className={inputClass} />
      </label>
      <fieldset className="space-y-1">
        <legend>{m.scope}</legend>
        <label className="flex min-h-9 items-center gap-2">
          <input type="radio" checked={personal} onChange={() => setPersonal(true)} data-template-scope="mine" />
          {m.forMe}
        </label>
        <label className={`flex min-h-9 items-center gap-2 ${isOwner ? "" : "text-muted"}`} title={isOwner ? undefined : m.projectOnlyOwners}>
          <input type="radio" checked={!personal} disabled={!isOwner} onChange={() => setPersonal(false)} data-template-scope="project" />
          {m.forProject}
        </label>
      </fieldset>
      <label className="flex min-h-9 items-center gap-2">
        <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
        {m.makeDefault}
      </label>
      {note && (
        <p role={note.error ? "alert" : "status"} className={note.error ? "text-danger" : "text-muted"}>
          {note.text}
        </p>
      )}
      <button type="button" onClick={save} disabled={pending || !name.trim()} className="min-h-11 rounded-lg bg-accent px-4 font-medium text-white disabled:opacity-60 md:min-h-9" data-template-save>
        {m.save}
      </button>
    </Dialog>
  );
}

// The page's «Templates» button: both lists, rename, default, delete.
export function TemplatesButton({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass} data-open-templates>
        <Icon name="template" className="mr-1 inline" />
        {m.button}
      </button>
      {open && <TemplatesDialog projectId={projectId} isOwner={isOwner} onClose={() => setOpen(false)} />}
    </>
  );
}

function TemplatesDialog({ projectId, isOwner, onClose }: { projectId: string; isOwner: boolean; onClose: () => void }) {
  const { templates, reload } = useTemplates(projectId);
  const [error, setError] = useState<string | null>(null);
  const act = async (promise: Promise<{ ok: boolean; error?: string }>) => {
    const result = await promise;
    setError(result.ok ? null : (k.errors[result.error ?? ""] ?? t.common.unknownError));
    reload();
  };
  const section = (title: string, list: TaskTemplate[], canChange: boolean, empty: string, personal: boolean) => (
    <section className="space-y-2" data-templates-section={personal ? "mine" : "project"}>
      <h3 className="font-medium">{title}</h3>
      {!canChange && <p className="text-xs text-muted">{m.projectOnlyOwners}</p>}
      {!list.length && <p className="text-muted">{empty}</p>}
      <ul className="space-y-2">
        {list.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2" data-template-row={x.name}>
            <span className="min-w-0 flex-1 truncate">
              {x.name} {x.is_default && <span className="text-xs text-muted">· {m.isDefault}</span>}
            </span>
            {canChange && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const name = prompt(m.name, x.name)?.trim();
                    if (name && name !== x.name) act(saveTaskTemplate(projectId, x.id, personal, name, x.data, x.is_default));
                  }}
                  className="min-h-9 rounded px-2 text-xs hover:bg-surface"
                >
                  {m.rename}
                </button>
                <button type="button" onClick={() => act(saveTaskTemplate(projectId, x.id, personal, x.name, x.data, !x.is_default))} className="min-h-9 rounded px-2 text-xs hover:bg-surface" data-template-default>
                  {x.is_default ? m.unsetDefault : m.setDefault}
                </button>
                <button
                  type="button"
                  onClick={() => confirm(m.removeConfirm(x.name)) && act(deleteTaskTemplate(x.id))}
                  aria-label={m.remove}
                  title={m.remove}
                  className="min-h-9 min-w-9 text-danger"
                >
                  <Icon name="trash" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <Dialog title={m.title} onClose={onClose}>
      <p className="text-muted">{m.intro}</p>
      {error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
          {error}
        </p>
      )}
      {section(m.project, templates.filter((x) => !x.owner_id), isOwner, m.emptyProject, false)}
      {section(m.mine, templates.filter((x) => x.owner_id), true, m.emptyMine, true)}
    </Dialog>
  );
}
