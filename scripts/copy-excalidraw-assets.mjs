// Copies the board canvas's fonts (Excalidraw, MIT) into public/ so the site
// serves them itself instead of loading them from a third-party CDN.
// Runs before `next dev` and `next build` (npm "predev" / "prebuild").
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
// The package exports only its entry point: start from there (dist/prod/index.js).
const root = join(dirname(require.resolve("@excalidraw/excalidraw")), "..", "..");
const from = join(root, "dist", "prod", "fonts");
const to = join(process.cwd(), "public", "excalidraw-assets", "fonts");
if (!existsSync(from)) {
  console.warn(`excalidraw fonts not found at ${from}; the canvas falls back to its CDN`);
} else {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}
