import { Icon, type IconName } from "./icon";

// A switch between a few views of the same thing (calendar / absences, board / list).
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-lg border border-border bg-hover p-0.5">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors md:h-7 md:min-h-0 ${
              on ? "bg-background text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            {option.icon && <Icon name={option.icon} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
