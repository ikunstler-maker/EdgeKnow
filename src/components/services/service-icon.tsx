import type { ReactNode } from "react";
import { SERVICE_BRANDS, type ServiceKey } from "@/lib/services";

// Each service's mark: a rounded tile in the service's own 135° gradient with a
// drawn glyph inside. The same mark is used wherever a service is named.
export type ServiceIconId = ServiceKey | "home";

const HOME_COLORS = ["#64748B", "#1E293B"];

const GLYPHS: Record<ServiceIconId, ReactNode> = {
  home: <path d="M5 10.8 12 5l7 5.8V18a1 1 0 0 1-1 1h-3.5v-4.5h-5V19H6a1 1 0 0 1-1-1z" />,
  // An open book
  wiki: <path d="M12 7.5c-1.8-1.3-4-1.8-6.5-1.5v11c2.5-.3 4.7.2 6.5 1.5 1.8-1.3 4-1.8 6.5-1.5V6c-2.5-.3-4.7.2-6.5 1.5zM12 7.5v11" />,
  // A ticked box in motion
  tasks: (
    <>
      <rect x="5.5" y="5.5" width="13" height="13" rx="3.5" />
      <path d="m9 12.2 2.2 2.2 3.9-4.4" />
    </>
  ),
  // Sticky notes on a canvas
  boards: (
    <>
      <rect x="5" y="5" width="8.5" height="8.5" rx="2" />
      <path d="M16.5 10.5H17a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-4.5a2 2 0 0 1-2-2v-.5" />
    </>
  ),
  // Linked nodes
  nodes: (
    <>
      <circle cx="7" cy="12" r="2.25" />
      <circle cx="17" cy="7" r="2.25" />
      <circle cx="17" cy="17" r="2.25" />
      <path d="m9 11 6-3M9 13l6 3" />
    </>
  ),
  // A sheet of cells
  sheets: (
    <>
      <rect x="5" y="5.5" width="14" height="13" rx="2.5" />
      <path d="M5 10h14M5 14.3h14M10 10v8.5" />
    </>
  ),
  // A frame that plays
  slides: (
    <>
      <rect x="4.5" y="6" width="15" height="10.5" rx="2.5" />
      <path d="m10.8 9.3 3.2 2-3.2 2zM9 19.5h6" />
    </>
  ),
  // Answers ticked off
  surveys: <path d="m5.5 8 1.5 1.5L9.5 7M5.5 15l1.5 1.5L9.5 14M12.5 8.3h6M12.5 15.3h6" />,
  // A speech bubble
  chat: <path d="M5 7.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2h-5l-4 3v-3H7a2 2 0 0 1-2-2zM9 10.8h6" />,
  // A vault door
  files: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="3" />
      <circle cx="12" cy="12" r="2.75" />
      <path d="M12 9.25V7.5M12 16.5v-1.75M14.75 12h1.75" />
    </>
  ),
  // A day on the calendar
  calendar: (
    <>
      <rect x="5" y="6" width="14" height="13" rx="2.75" />
      <path d="M5 10.3h14M9 4.5v3M15 4.5v3M12 14.3v.1" />
    </>
  ),
  // A camera
  meet: (
    <>
      <rect x="4.5" y="7.5" width="10.5" height="9" rx="2.5" />
      <path d="m15 11 4.5-2.5v7L15 13" />
    </>
  ),
  // A spark
  ai: <path d="M12 5 13.4 9.3a2 2 0 0 0 1.3 1.3L19 12l-4.3 1.4a2 2 0 0 0-1.3 1.3L12 19l-1.4-4.3a2 2 0 0 0-1.3-1.3L5 12l4.3-1.4a2 2 0 0 0 1.3-1.3z" />,
  // A page in a window
  sites: (
    <>
      <rect x="4.5" y="5.5" width="15" height="13" rx="2.75" />
      <path d="M4.5 9.5h15M7.3 7.5v.1M9.8 7.5v.1M8 13h4M8 15.5h7" />
    </>
  ),
  // The sun over the horizon
  apps: <path d="M4.5 16.5h15M7.5 16.5a4.5 4.5 0 0 1 9 0M12 7v1.8M6.2 9.7l1.3 1.3M17.8 9.7l-1.3 1.3M8 19.5h8" />,
  // People together
  crm: (
    <>
      <circle cx="9.3" cy="9.5" r="2.5" />
      <circle cx="15.5" cy="10.5" r="2" />
      <path d="M4.8 18a4.5 4.5 0 0 1 9 0M15 14.3a3.8 3.8 0 0 1 4.2 3.7" />
    </>
  ),
};

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

export function ServiceIcon({ serviceId, size = 24, muted = false, className }: { serviceId: ServiceIconId; size?: number; muted?: boolean; className?: string }) {
  const colors = serviceId === "home" ? HOME_COLORS : SERVICE_BRANDS[serviceId].colors;
  // A glyph must read on its own tile: dark ink where the gradient is pale on average.
  const average = colors.reduce((sum, c) => sum + luminance(c), 0) / colors.length;
  const ink = average > 165 ? "#0D1017" : "#FFFFFF";
  return (
    <span
      aria-hidden="true"
      data-service-icon={serviceId}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        backgroundImage: `linear-gradient(135deg, ${colors.join(", ")})`,
        color: ink,
      }}
      className={`inline-flex shrink-0 items-center justify-center shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14),0_1px_2px_rgb(0_0_0/0.25)] ${muted ? "opacity-45 grayscale" : ""} ${className ?? ""}`}
    >
      <svg viewBox="0 0 24 24" width={size * 0.8} height={size * 0.8} fill="none" stroke="currentColor" strokeWidth={size >= 32 ? 1.6 : 1.9} strokeLinecap="round" strokeLinejoin="round">
        {GLYPHS[serviceId]}
      </svg>
    </span>
  );
}
