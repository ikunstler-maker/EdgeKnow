import type { Block, OurPriority, OurRole, OurType, TrackerField, TrackerRole, TrackerStatus, TrackerType, TrackerUser } from "@/lib/tracker-convert";
import type { Person } from "@/lib/tasks";

// What the import wizard and the server say to each other (Rukh Р-3а).
export type ImportOutline = {
  importId: string;
  site: string;
  project: { key: string; name: string };
  total: number;
  statuses: TrackerStatus[];
  types: TrackerType[];
  priorities: string[];
  users: TrackerUser[];
  // The tracker project's roles and who holds each.
  roles: TrackerRole[];
  // Custom fields that hold something in the first tasks (the rest can't be seen cheaply).
  fields: TrackerField[];
  ours: {
    projects: { id: string; key: string; name: string; columns: { id: string; name: string; category: string }[] }[];
    members: Person[];
    people: Record<string, string | null>;
  };
};

export type ImportTarget =
  // A new project under this key.
  | { kind: "new"; key: string; name: string }
  // The project that holds the key gets another one, then a new project takes the key.
  | { kind: "rename"; projectId: string; otherKey: string; key: string; name: string }
  // Into an existing project: its own tasks move after the imported ones.
  | { kind: "merge"; projectId: string };

export type ImportPlan = {
  target: ImportTarget;
  // tracker status id → an existing column's id, or "new" (a column of that name is made)
  statuses: Record<string, string>;
  types: Record<string, OurType>;
  priorities: Record<string, OurPriority>;
  people: Record<string, string | null>;
  // tracker role name → the role of ours its people get in the project (null: none)
  roles?: Record<string, OurRole | null>;
  fields: string[];
  startField: string | null;
};

export type ImportPreview = {
  key: string;
  title: string;
  status: string;
  type: OurType;
  priority: OurPriority;
  assignee: string | null;
  reporter: string | null;
  labels: string[];
  due: string | null;
  description: Block[] | null;
}[];

export type ImportProgress = {
  phase: "tasks" | "relations" | "activity" | "done";
  cursor: string | null;
  total: number;
  seen: number;
  created: number;
  updated: number;
  parents: number;
  links: number;
  // Links and parents whose other task isn't among the imported ones.
  missing: number;
  // Comments and status changes brought with their dates and authors.
  comments?: number;
  moves?: number;
  // Tracker people brought as seats, and how many of them sit on a member already.
  people?: number;
  seated?: number;
  // Tasks left out, with the reason (first 200).
  skipped: { key: string; reason: string }[];
  // What was shortened or left out inside tasks: reason → how many tasks.
  notes: Record<string, number>;
};

export type ImportState = {
  id: string;
  state: "draft" | "running" | "done" | "failed";
  site: string;
  sourceProject: string;
  projectKey: string | null;
  progress: ImportProgress | null;
  lastError: string | null;
  createdAt: string;
};
