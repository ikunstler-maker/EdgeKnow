// The interface uses drawn icons, never emoji (decision 2026-11-11). This check
// runs before every build and fails when an emoji shows up in the interface code
// or its strings. Emoji stay only where a person picks them or where they are
// content, not interface: see ALLOWED below.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Pictographs and symbols drawn as emoji. Arrows, typographic signs and the plain
// check and cross marks (used in native lists, where a drawn icon cannot go) are
// left out on purpose.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{FF0B}]/u;
const PLAIN_MARKS = /[\u2713\u2717\u2715]/g;

const ALLOWED = [
  // The picker of a wiki page's own icon: its contents are the emoji people choose from.
  { file: "src/components/pages/emoji-picker.tsx" },
  // A page saved as Markdown: these are characters of the exported file.
  { file: "src/lib/page-markdown.ts" },
  { file: "src/lib/markdown.ts" },
  // Status marks a person puts on a diagram node; they are stored in the page.
  { file: "src/lib/diagram.ts", line: /STATUS_EMOJI/ },
  // The example wiki pages a new workspace starts with carry page icons.
  { file: "src/i18n/uk.ts", line: /^\s+icon: "/ },
  { file: "src/i18n/en.ts", line: /^\s+icon: "/ },
];

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield path;
  }
}

const found = [];
for (const path of files("src")) {
  const file = path.replaceAll("\\", "/");
  const rules = ALLOWED.filter((rule) => rule.file === file);
  if (rules.some((rule) => !rule.line)) continue;
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((text, index) => {
      const trimmed = text.trim();
      // Comments may show an old label when they explain a change.
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("{/*")) return;
      if (!EMOJI.test(text.replace(PLAIN_MARKS, "")) || rules.some((rule) => rule.line.test(text))) return;
      found.push(`${file}:${index + 1}: ${trimmed.slice(0, 120)}`);
    });
}

if (found.length) {
  console.error(`Emoji in the interface (${found.length}). Use <Icon> or <ServiceIcon> instead:\n${found.join("\n")}`);
  process.exit(1);
}
console.log("No emoji in the interface.");
