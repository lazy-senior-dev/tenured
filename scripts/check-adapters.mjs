#!/usr/bin/env node
// Fail when any generated adapter differs from what rules/grump.md would render.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadRuleset, validateRuleset } from "./lib/ruleset.mjs";
import { renderAll, ROOT } from "./lib/render.mjs";

const rs = loadRuleset();
const problems = validateRuleset(rs);
if (problems.length) {
  console.error("rules/grump.md is not valid:\n  " + problems.join("\n  "));
  process.exit(1);
}

const stale = [];
for (const [rel, content] of renderAll(rs)) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) stale.push(rel + " (missing)");
  else if (readFileSync(path, "utf8") !== content) stale.push(rel + " (differs)");
}
if (stale.length) {
  console.error("Stale adapters. Run `npm run build` and commit the result:\n  " + stale.join("\n  "));
  process.exit(1);
}
console.log(`adapters up to date (${renderAll(rs).size} files)`);
