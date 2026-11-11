import { Icon, type IconName } from "@/components/ui/icon";
import type { Person, StatusCategory, TaskPriority, TaskType } from "@/lib/tasks";

// Drawn marks for a task's type and priority, the same on the board, in lists
// and in the task itself. Colour carries the meaning; the name is in the hint.
const TYPE_ICON: Record<TaskType, { icon: IconName; color: string }> = {
  task: { icon: "task", color: "text-sky-500" },
  bug: { icon: "bug", color: "text-rose-500" },
  idea: { icon: "bulb", color: "text-amber-500" },
  epic: { icon: "epic", color: "text-violet-500" },
};
const PRIORITY_ICON: Record<TaskPriority, { icon: IconName; color: string }> = {
  highest: { icon: "priority-highest", color: "text-rose-500" },
  high: { icon: "priority-high", color: "text-orange-500" },
  medium: { icon: "priority-medium", color: "text-muted" },
  low: { icon: "priority-low", color: "text-sky-500" },
  lowest: { icon: "priority-lowest", color: "text-slate-400" },
};

export function TypeIcon({ type, size = 14, className }: { type: TaskType; size?: number; className?: string }) {
  const mark = TYPE_ICON[type];
  return <Icon name={mark.icon} size={size} className={`${mark.color} ${className ?? ""}`} data-task-type={type} />;
}

export function PriorityIcon({ priority, size = 14, className }: { priority: TaskPriority; size?: number; className?: string }) {
  const mark = PRIORITY_ICON[priority];
  return <Icon name={mark.icon} size={size} className={`${mark.color} ${className ?? ""}`} data-task-priority={priority} />;
}

const initialsOf = (person: Person) =>
  (person.name || person.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

// A person as a small round mark with initials; nobody as a dashed ring.
export function Avatar({ person, size = 22 }: { person: Person | undefined; size?: number }) {
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none ${
        person ? "bg-accent/15 text-accent" : "border border-dashed border-border-strong text-muted"
      }`}
      aria-hidden="true"
    >
      {person ? initialsOf(person) : ""}
    </span>
  );
}

// The colour of a column's kind: the dot in a column's header and next to a task in the side panel.
const STATUS_DOT: Record<StatusCategory, string> = { todo: "bg-slate-400", doing: "bg-sky-500", review: "bg-violet-500", done: "bg-emerald-500" };
// A column's own colour, when it has one, wins over the colour of its kind.
export function StatusDot({ category, title, color }: { category: StatusCategory; title?: string; color?: string | null }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color ? "" : (STATUS_DOT[category] ?? STATUS_DOT.todo)}`} style={color ? { background: color } : undefined} title={title} data-status-dot={category} />;
}
