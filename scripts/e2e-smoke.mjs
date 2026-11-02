// Browser smoke test of the whole app against a local Supabase, run after
// scripts/api-isolation.mjs. It is split into independent parts in scripts/e2e/
// (wiki, tasks, team); CI runs each on its own machine at the same time. This
// runs them one after another against one stack, or only the ones named.
//
// Usage: node scripts/e2e-smoke.mjs status.json http://localhost:3000 [wiki tasks team]

import { spawnSync } from "node:child_process";

const [statusFile = "status.json", app = "http://localhost:3000", ...named] = process.argv.slice(2);
const parts = named.length ? named : ["wiki", "tasks", "team"];
let failed = false;
for (const part of parts) {
  const run = spawnSync(process.execPath, [new URL(`./e2e/${part}.mjs`, import.meta.url).pathname, statusFile, app], { stdio: "inherit" });
  if (run.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
