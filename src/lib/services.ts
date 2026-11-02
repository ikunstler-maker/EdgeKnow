// The services of the platform, in the order of the start page and the switcher.
// "ready: false" ones show as "Soon" until they are built (docs/suite-plan-uk.md).
export type ServiceKey = "wiki" | "tasks" | "boards" | "nodes" | "sheets" | "slides" | "surveys" | "chat";

export const SERVICES: { key: ServiceKey; icon: string; ready: boolean; path: string | null }[] = [
  { key: "wiki", icon: "📚", ready: true, path: "" },
  { key: "tasks", icon: "✅", ready: true, path: "/tasks" },
  { key: "boards", icon: "🎨", ready: false, path: null },
  { key: "nodes", icon: "🧠", ready: true, path: "/nodes" },
  { key: "sheets", icon: "📊", ready: false, path: null },
  { key: "slides", icon: "🖼️", ready: false, path: null },
  { key: "surveys", icon: "📝", ready: false, path: null },
  { key: "chat", icon: "💬", ready: false, path: null },
];
