import type { ReactNode, SVGProps } from "react";

// The platform's own line icons: one 24-unit grid, a 1.75 stroke, round joins.
// They take the text colour, so they follow the theme and the state of their control.
const p = (d: string) => <path d={d} />;

const ICONS = {
  // Navigation and layout
  home: p("M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      {p("m16 16 4 4")}
    </>
  ),
  bell: p("M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2.2 2.2 0 0 0 4 0"),
  menu: p("M4 7h16M4 12h16M4 17h16"),
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      {p("M9.5 4.5v15")}
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  "chevron-down": p("m6 9 6 6 6-6"),
  "chevron-up": p("m6 15 6-6 6 6"),
  "chevron-left": p("m15 6-6 6 6 6"),
  "chevron-right": p("m9 6 6 6-6 6"),
  "chevrons-up-down": p("m8 9.5 4-4 4 4M8 14.5l4 4 4-4"),
  "arrow-left": p("M19 12H5m6-6-6 6 6 6"),
  "arrow-right": p("M5 12h14m-6-6 6 6-6 6"),
  "arrow-up": p("M12 19V5m-6 6 6-6 6 6"),
  "arrow-down": p("M12 5v14m-6-6 6 6 6-6"),
  "arrow-up-right": p("M7 17 17 7M9 7h8v8"),
  external: p("M13.5 5H19v5.5M19 5l-8 8M10 6H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3"),

  // Actions
  plus: p("M12 5v14M5 12h14"),
  minus: p("M5 12h14"),
  close: p("m6 6 12 12M18 6 6 18"),
  check: p("m5 12.5 4.5 4.5L19 7.5"),
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      {p("m8.5 12.3 2.4 2.4 4.6-5")}
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="18.5" cy="12" r="1" />
    </>
  ),
  edit: p("M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"),
  trash: p("M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 11.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7M10 11v5M14 11v5"),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      {p("M5 15.5a1.5 1.5 0 0 1-.5-1.1V6.5a2 2 0 0 1 2-2h7.9a1.5 1.5 0 0 1 1.1.5")}
    </>
  ),
  download: p("M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14"),
  upload: p("M12 15V4m-4.5 4.5L12 4l4.5 4.5M5 19.5h14"),
  share: p("M12 14.5V4m-4 4 4-4 4 4M7 11H6a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18 11h-1"),
  link: p("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"),
  filter: p("M4 6h16M7 12h10M10 18h4"),
  sort: p("M7 5v14m-3-3 3 3 3-3M17 19V5m-3 3 3-3 3 3"),
  sliders: (
    <>
      {p("M4 7h9M17 7h3M4 17h3M11 17h9")}
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  settings: (
    <>
      {p("M10.07 5.37 L10.56 2.91 L13.44 2.91 L13.93 5.37 L15.32 5.95 L17.41 4.56 L19.44 6.59 L18.05 8.68 L18.63 10.07 L21.09 10.56 L21.09 13.44 L18.63 13.93 L18.05 15.32 L19.44 17.41 L17.41 19.44 L15.32 18.05 L13.93 18.63 L13.44 21.09 L10.56 21.09 L10.07 18.63 L8.68 18.05 L6.59 19.44 L4.56 17.41 L5.95 15.32 L5.37 13.93 L2.91 13.44 L2.91 10.56 L5.37 10.07 L5.95 8.68 L4.56 6.59 L6.59 4.56 L8.68 5.95z")}
      <circle cx="12" cy="12" r="2.9" />
    </>
  ),
  refresh: p("M19.5 12a7.5 7.5 0 0 1-13.2 4.9M4.5 12a7.5 7.5 0 0 1 13.2-4.9M17.5 3.5v3.8h-3.8M6.5 20.5v-3.8h3.8"),
  undo: p("M8 5 4 9l4 4M4 9h10a5.5 5.5 0 0 1 0 11H9"),
  redo: p("m16 5 4 4-4 4M20 9H10a5.5 5.5 0 0 0 0 11h5"),
  history: (
    <>
      {p("M4.5 12a7.5 7.5 0 1 0 2.3-5.4M4 4v3.6h3.6M12 8v4.2l2.7 1.6")}
    </>
  ),
  play: p("M8 5.5v13a.6.6 0 0 0 .9.5l10.5-6.5a.6.6 0 0 0 0-1L8.9 5a.6.6 0 0 0-.9.5z"),
  pause: p("M8.5 5.5v13M15.5 5.5v13"),
  maximize: p("M9 4.5H5.5A1 1 0 0 0 4.5 5.5V9M15 4.5h3.5a1 1 0 0 1 1 1V9M9 19.5H5.5a1 1 0 0 1-1-1V15M15 19.5h3.5a1 1 0 0 0 1-1V15"),
  "zoom-in": (
    <>
      <circle cx="11" cy="11" r="6.5" />
      {p("m16 16 4 4M8.5 11h5M11 8.5v5")}
    </>
  ),
  "zoom-out": (
    <>
      <circle cx="11" cy="11" r="6.5" />
      {p("m16 16 4 4M8.5 11h5")}
    </>
  ),
  drag: (
    <>
      <circle cx="9" cy="6" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="18" r="1" />
    </>
  ),
  pin: p("M9 4.5h6l-.8 5.5 3.3 3v1.5h-11V13l3.3-3zM12 14.5V20"),
  star: p("m12 4 2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.8 5.4-.7z"),
  send: p("M20 4 3.5 10.5l6.5 2.5m10-9-7.5 16-2.5-7m10-9-10 9"),

  // State, access, people
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
      {p("M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5")}
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
      {p("M8.5 10.5V8a3.5 3.5 0 0 1 6.7-1.4")}
    </>
  ),
  eye: (
    <>
      {p("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z")}
      <circle cx="12" cy="12" r="2.75" />
    </>
  ),
  "eye-off": p("M4 4l16 16M9.9 6A8.7 8.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15 15 0 0 1-2.6 3.4M6.3 7.7A15 15 0 0 0 2.5 12S6 18.5 12 18.5a8.6 8.6 0 0 0 3.7-.8M10 10.1a2.75 2.75 0 0 0 3.9 3.9"),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.75" />
      {p("M4.5 20a7.5 7.5 0 0 1 15 0")}
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="9" r="3.25" />
      {p("M3 19.5a6 6 0 0 1 12 0M15.5 5.9a3.25 3.25 0 0 1 0 6.2M17.5 14.3a6 6 0 0 1 3.5 5.2")}
    </>
  ),
  shield: p("M12 3.5 5 6v5.5c0 4.3 2.9 7.4 7 9 4.1-1.6 7-4.7 7-9V6z"),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      {p("M3.5 12h17M12 3.5c2.5 2.3 3.8 5.1 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.1-3.8-8.5S9.5 5.8 12 3.5z")}
    </>
  ),
  "sign-out": p("M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10M15.5 8l4 4-4 4M19.5 12h-10"),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      {p("M12 11v5.5M12 7.6v.1")}
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      {p("M9.5 9.5a2.5 2.5 0 1 1 3.7 2.2c-.8.5-1.2 1-1.2 2M12 16.8v.1")}
    </>
  ),
  alert: p("M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.1v.1"),
  sparkle: p("M12 3.5 13.7 9a2 2 0 0 0 1.3 1.3l5.5 1.7-5.5 1.7a2 2 0 0 0-1.3 1.3L12 20.5 10.3 15A2 2 0 0 0 9 13.7L3.5 12 9 10.3A2 2 0 0 0 10.3 9z"),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.75" />
      {p("M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4")}
    </>
  ),
  moon: p("M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7z"),
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="2.5" />
      {p("M9 20h6M12 16v4")}
    </>
  ),
  language: p("M4 6h9M8.5 4v2M6 6c.5 3.5 2.5 6 6 7.5M11 6c-.5 3.5-2.8 6.3-6.5 7.8M12.5 20l3.75-9 3.75 9M13.8 17h4.9"),

  // Content
  file: p("M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5zM13.5 3.5v5h5"),
  "file-text": p("M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5zM13.5 3.5v5h5M9 13h6M9 16.5h4"),
  folder: p("M3.5 7a2 2 0 0 1 2-2h3.7l2 2.5h7.3a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.5" />
      {p("m4.5 17 4.5-4 3.5 3 2.5-2 4.5 4")}
    </>
  ),
  paperclip: p("m19 11.5-7.3 7.3a4.5 4.5 0 0 1-6.4-6.4L12.8 5a3 3 0 0 1 4.2 4.2l-7.4 7.4a1.5 1.5 0 0 1-2.1-2.1l6.7-6.7"),
  comment: p("M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4.5 3.5V16.5h-.5a2 2 0 0 1-2-2z"),
  tag: (
    <>
      {p("M4 5.5v5.7a2 2 0 0 0 .6 1.4l7 7a1.5 1.5 0 0 0 2.1 0l5.7-5.7a1.5 1.5 0 0 0 0-2.1l-7-7A2 2 0 0 0 11 4.2L5.5 4A1.5 1.5 0 0 0 4 5.5z")}
      <circle cx="8.5" cy="8.5" r="1" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
      {p("M4 10h16M8.5 3.5v4M15.5 3.5v4")}
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      {p("M12 7.5V12l3 2")}
    </>
  ),
  list: p("M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5v.1M4.5 12v.1M4.5 17.5v.1"),
  columns: (
    <>
      <rect x="4" y="4.5" width="6.5" height="15" rx="1.75" />
      <rect x="13.5" y="4.5" width="6.5" height="9.5" rx="1.75" />
    </>
  ),
  table: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      {p("M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10")}
    </>
  ),
  chart: p("M4.5 4.5v15h15M8.5 15.5v-4M12.5 15.5v-8M16.5 15.5v-5.5"),
  layers: p("m12 4 8.5 4.5L12 13 3.5 8.5zM4.5 12.5 12 16.5l7.5-4M4.5 16 12 20l7.5-4"),
  template: (
    <>
      <rect x="4" y="4" width="16" height="6" rx="1.75" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.75" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.75" />
    </>
  ),
  note: p("M5 6.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2V14l-5 5.5H7a2 2 0 0 1-2-2zM19 14h-3a2 2 0 0 0-2 2v3.5"),
  frame: p("M7.5 3.5v17M16.5 3.5v17M3.5 7.5h17M3.5 16.5h17"),
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7" />
      {p("M12 13.5V10M9.5 3.5h5M12 3.5v3")}
    </>
  ),
  vote: p("M7 11.5 12 6l5 5.5M7 17.5 12 12l5 5.5"),
  keyboard: (
    <>
      <rect x="2.5" y="6.5" width="19" height="11.5" rx="2.5" />
      {p("M6.5 10.5v.1M10 10.5v.1M13.5 10.5v.1M17 10.5v.1M8 14.5h8")}
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6.5" rx="7" ry="2.75" />
      {p("M5 6.5v5.5c0 1.5 3.1 2.75 7 2.75s7-1.25 7-2.75V6.5M5 12v5.5c0 1.5 3.1 2.75 7 2.75s7-1.25 7-2.75V12")}
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13.5" rx="2.5" />
      {p("m4.5 8 7.5 5.5L19.5 8")}
    </>
  ),

  // Task types and priorities
  task: (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" />
      {p("m8.5 12.3 2.4 2.4 4.6-5")}
    </>
  ),
  bug: (
    <>
      <rect x="7.5" y="8" width="9" height="11.5" rx="4.5" />
      {p("M9.5 8a2.5 2.5 0 0 1 5 0M3.5 13.5h4M16.5 13.5h4M5 8l2.8 1.8M19 8l-2.8 1.8M5 19.5l2.8-2M19 19.5l-2.8-2")}
    </>
  ),
  epic: p("M13 3.5 5.5 13.5H11L10 20.5l8.5-10.5H13z"),
  bulb: p("M9 17.5h6M10 20.5h4M8.2 14.5a6 6 0 1 1 7.6 0c-.6.5-.8 1-.8 1.5v1.5H9V16c0-.5-.2-1-.8-1.5z"),
  snow: p("M12 3.5v17M4.6 7.8l14.8 8.4M19.4 7.8 4.6 16.2M9.5 4.8 12 7l2.5-2.2M9.5 19.2 12 17l2.5 2.2"),
  subtask: p("M6 4.5v9a3 3 0 0 0 3 3h3.5M12.5 13.5h6a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 11 18v-3a1.5 1.5 0 0 1 1.5-1.5z"),
  "priority-highest": p("m6.5 12.5 5.5-5.5 5.5 5.5M6.5 18 12 12.5l5.5 5.5"),
  "priority-high": p("m6.5 14.5 5.5-5.5 5.5 5.5"),
  "priority-medium": p("M6 9.5h12M6 14.5h12"),
  "priority-low": p("m6.5 9.5 5.5 5.5 5.5-5.5"),
  "priority-lowest": p("m6.5 6 5.5 5.5L17.5 6M6.5 11.5 12 17l5.5-5.5"),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function Icon({ name, size = 16, className, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className ?? ""}`}
      {...rest}
    >
      {ICONS[name]}
    </svg>
  );
}
