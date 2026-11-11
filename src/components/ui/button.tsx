import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

// One look for every button. A screen header has at most one "primary";
// utilities (export, templates, fields, settings, access) are "subtle" or "ghost".
// Heights: 32px on a desktop; 44px on a phone so a finger can hit it.
export type ButtonVariant = "primary" | "subtle" | "ghost" | "danger";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-50";
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:brightness-110",
  subtle: "border border-border bg-hover text-foreground hover:border-border-strong",
  ghost: "text-muted hover:bg-hover hover:text-foreground",
  danger: "border border-danger/30 text-danger hover:bg-danger/10",
};

export function buttonClass(variant: ButtonVariant = "subtle", extra = "") {
  return `${BASE} min-h-11 px-3 md:h-8 md:min-h-0 ${VARIANTS[variant]} ${extra}`;
}
export function iconButtonClass(variant: ButtonVariant = "ghost", extra = "") {
  return `${BASE} h-11 w-11 md:h-8 md:w-8 ${VARIANTS[variant]} ${extra}`;
}

// Form inputs: 36px on a desktop, 44px on a phone.
export const inputClass =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted hover:border-border-strong focus:border-accent md:h-9 md:min-h-0";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: IconName; children?: ReactNode };

export function Button({ variant = "subtle", icon, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

// An icon alone always carries its name for screen readers and as a hover hint.
export function IconButton({ icon, label, variant = "ghost", className, type = "button", ...rest }: Omit<ButtonProps, "children" | "icon"> & { icon: IconName; label: string }) {
  return (
    <button type={type} aria-label={label} title={label} className={iconButtonClass(variant, className)} {...rest}>
      <Icon name={icon} size={18} />
    </button>
  );
}
