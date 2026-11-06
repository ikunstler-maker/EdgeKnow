// Task templates: ready values for a new task. owner_id null: the project's,
// shared with everyone who creates tasks there; otherwise one person's own.
export type TemplateData = {
  title?: string;
  type?: string;
  priority?: string;
  assignee_id?: string | null;
  labels?: string[];
  estimate?: number | null;
  custom?: Record<string, unknown>;
  description?: unknown;
};

export type TaskTemplate = { id: string; owner_id: string | null; name: string; data: TemplateData; is_default: boolean };

// Which template a new task starts with: one's own default first, then the project's.
export function defaultTemplate(templates: TaskTemplate[]) {
  return templates.find((x) => x.owner_id && x.is_default) ?? templates.find((x) => !x.owner_id && x.is_default) ?? null;
}

// The fields create_task takes for a title typed with this template.
// Fields deleted since the template was saved are left out (fieldIds: the project's now).
export function fromTemplate(template: TaskTemplate | null, title: string, fieldIds?: string[]): Record<string, unknown> {
  if (!template) return { title };
  const { title: prefix, custom, ...rest } = template.data;
  if (custom) Object.assign(rest, { custom: fieldIds ? Object.fromEntries(Object.entries(custom).filter(([id]) => fieldIds.includes(id))) : custom });
  const full = prefix && !title.startsWith(prefix.trim()) ? `${prefix}${title}` : title;
  return { ...rest, title: full.slice(0, 300) };
}

// What a task gives a template: its settings, not its dates, people's work or history.
export function templateOf(task: { type: string; priority: string; assignee_id: string | null; labels: string[]; estimate: number | null; custom: Record<string, unknown>; description: unknown }): TemplateData {
  const custom = Object.fromEntries(Object.entries(task.custom ?? {}).filter(([, v]) => v !== null && v !== undefined));
  return {
    type: task.type,
    priority: task.priority,
    ...(task.assignee_id ? { assignee_id: task.assignee_id } : {}),
    ...(task.labels.length ? { labels: task.labels } : {}),
    ...(task.estimate !== null ? { estimate: task.estimate } : {}),
    ...(Object.keys(custom).length ? { custom } : {}),
    ...(task.description ? { description: task.description } : {}),
  };
}
