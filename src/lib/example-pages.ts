import { t } from "@/i18n";

// The example pages a new workspace can start from (onboarding), in the
// viewer's language. Plain BlockNote blocks, so they work in every database.

type Line = { kind: "h2" | "p" | "bullet" | "todo"; text: string };
export type ExamplePage = { title: string; icon: string; blocks: unknown[] };

let counter = 0;
const block = (line: Line) => {
  const id = `example-${++counter}`;
  const content = [{ type: "text", text: line.text, styles: {} }];
  if (line.kind === "h2") return { id, type: "heading", props: { level: 2 }, content, children: [] };
  if (line.kind === "bullet") return { id, type: "bulletListItem", props: {}, content, children: [] };
  if (line.kind === "todo") return { id, type: "checkListItem", props: { checked: false }, content, children: [] };
  return { id, type: "paragraph", props: {}, content, children: [] };
};

export function examplePages(): ExamplePage[] {
  counter = 0;
  return t.onboarding.examples.map((page) => ({
    title: page.title,
    icon: page.icon,
    blocks: (page.lines as readonly Line[]).map(block),
  }));
}
