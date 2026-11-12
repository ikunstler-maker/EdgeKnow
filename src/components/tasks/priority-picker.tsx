"use client";

import { useState } from "react";
import { t } from "@/i18n";
import { TASK_PRIORITIES, type TaskPriority } from "@/lib/tasks";
import { Icon } from "@/components/ui/icon";
import { Popover } from "@/components/ui/popover";
import { PriorityIcon } from "./task-icons";

// The priority as a list with each priority's own mark (a system list can't show marks).
export function PriorityPicker({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (priority: TaskPriority) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const k = t.tasks;
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={Boolean(anchor)}
        aria-label={`${k.fields.priority}: ${k.priorities[value] ?? value}`}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover disabled:opacity-60 md:min-h-8"
        data-task-priority-field={value}
      >
        <PriorityIcon priority={value as TaskPriority} size={16} />
        <span className="min-w-0 flex-1 truncate">{k.priorities[value] ?? value}</span>
        <Icon name="chevron-down" className="text-muted" />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={208}>
          <ul role="listbox" aria-label={k.fields.priority} className="py-1">
            {TASK_PRIORITIES.map((priority) => (
              <li key={priority} role="option" aria-selected={priority === value}>
                <button
                  type="button"
                  onClick={() => {
                    setAnchor(null);
                    if (priority !== value) onChange(priority);
                  }}
                  className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-hover md:min-h-9"
                  data-task-priority-option={priority}
                >
                  <PriorityIcon priority={priority} size={16} />
                  <span className="flex-1">{k.priorities[priority]}</span>
                  {priority === value && <Icon name="check" className="text-accent" />}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </>
  );
}
