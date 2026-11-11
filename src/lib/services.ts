// The services of the platform, in the order of the start page and the switcher.
// "ready: false" ones show as "Soon" until they are built (docs/suite-plan-uk.md).
export type ServiceKey = "wiki" | "tasks" | "boards" | "nodes" | "sheets" | "slides" | "surveys" | "chat" | "files" | "calendar" | "meet" | "ai" | "sites" | "apps" | "crm";

export const SERVICES: { key: ServiceKey; ready: boolean; path: string | null }[] = [
  { key: "wiki", ready: true, path: "" },
  { key: "tasks", ready: true, path: "/tasks" },
  { key: "boards", ready: true, path: "/boards" },
  { key: "nodes", ready: true, path: "/nodes" },
  { key: "sheets", ready: true, path: "/sheets" },
  { key: "slides", ready: true, path: "/slides" },
  { key: "surveys", ready: true, path: "/surveys" },
  { key: "chat", ready: false, path: null },
  { key: "files", ready: false, path: null },
  { key: "calendar", ready: true, path: "/calendar" },
  { key: "meet", ready: false, path: null },
  { key: "ai", ready: false, path: null },
  { key: "sites", ready: false, path: null },
  { key: "apps", ready: true, path: "/apps" },
  { key: "crm", ready: false, path: null },
];

// Wherever services are listed they come in these four groups, in this order.
export type ServiceCategory = "work" | "visual" | "data" | "comms";
export const SERVICE_CATEGORIES: { key: ServiceCategory; services: ServiceKey[] }[] = [
  { key: "work", services: ["wiki", "tasks", "calendar"] },
  { key: "visual", services: ["boards", "nodes", "slides", "sites"] },
  { key: "data", services: ["sheets", "surveys", "files"] },
  { key: "comms", services: ["chat", "meet", "crm", "apps", "ai"] },
];
export const serviceByKey = (key: ServiceKey) => SERVICES.find((s) => s.key === key)!;

// Each service's own name (the platform's prefix left out) and colours.
// A near-white first stop would vanish on a light page, so light themes start from
// the next colour (`light`).
export const SERVICE_BRANDS: Record<ServiceKey, { name: string; colors: string[] }> = {
  wiki: { name: "Wika", colors: ["#E5E7EB", "#2563EB"] },
  tasks: { name: "Rukh", colors: ["#059669", "#A3E635"] },
  boards: { name: "Bordy", colors: ["#EC4899", "#FBBF24"] },
  nodes: { name: "Nodo", colors: ["#6D28D9", "#F43F5E"] },
  sheets: { name: "Sota", colors: ["#F3F4F6", "#10B981"] },
  slides: { name: "Kadry", colors: ["#EF4444", "#9333EA"] },
  surveys: { name: "Questa", colors: ["#CBD5E1", "#0D9488"] },
  chat: { name: "Toker", colors: ["#8B5CF6", "#FB7185"] },
  files: { name: "Vault", colors: ["#F8FAFC", "#94A3B8"] },
  calendar: { name: "Doba", colors: ["#E2E8F0", "#FB923C", "#38BDF8"] },
  meet: { name: "Visio", colors: ["#06B6D4", "#3B82F6"] },
  ai: { name: "Apus AI", colors: ["#F1F5F9", "#EC4899", "#4F46E5"] },
  sites: { name: "Showy", colors: ["#E4E4E7", "#8B5CF6"] },
  apps: { name: "Obriy", colors: ["#FBBF24", "#14B8A6"] },
  crm: { name: "Spilno", colors: ["#E7E5E4", "#E11D48"] },
};

const isPale = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 200;
};
const gradient = (colors: string[]) => `linear-gradient(135deg, ${colors.length === 1 ? `${colors[0]}, ${colors[0]}` : colors.join(", ")})`;

export function brandGradients(key: ServiceKey) {
  const { colors } = SERVICE_BRANDS[key];
  const strong = colors.filter((c) => !isPale(c));
  // Pale greys only (files): darken for light pages.
  return { dark: gradient(colors), light: gradient(strong.length ? strong : ["#64748B", "#334155"]) };
}
