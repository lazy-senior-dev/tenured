#!/usr/bin/env node
// Render rules/grump.md into every adapter and write the results.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadRuleset, validateRuleset } from "./lib/ruleset.mjs";
import { renderAll, ROOT } from "./lib/render.mjs";

const rs = loadRuleset();
const problems = validateRuleset(rs);
if (problems.length) {
  console.error("rules/grump.md is not valid:\n  " + problems.join("\n  "));
  process.exit(1);
}

let written = 0;
let unchanged = 0;
for (const [rel, content] of renderAll(rs)) {
  const path = join(ROOT, rel);
  if (existsSync(path) && readFileSync(path, "utf8") === content) {
    unchanged++;
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  written++;
  console.log("wrote " + rel);
}
console.log(`${written} written, ${unchanged} unchanged`);
