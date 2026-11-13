// For unit tests run with --experimental-strip-types: the app's own modules import each other
// without the ".ts" ending (as Next.js allows); this adds it for relative imports and "@/".
// Use: node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs <test>
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = ${JSON.stringify(new URL("../src/", import.meta.url).href)};
export async function resolve(specifier, context, next) {
  let target = specifier.startsWith("@/") ? root + specifier.slice(2) : (specifier.startsWith(".") && context.parentURL ? new URL(specifier, context.parentURL).href : null);
  if (target && !/\\.[cm]?[jt]sx?$/.test(target)) {
    for (const end of [".ts", ".tsx", "/index.ts"]) if (existsSync(fileURLToPath(target + end))) return next(target + end, context);
  }
  return next(specifier, context);
}
`));
