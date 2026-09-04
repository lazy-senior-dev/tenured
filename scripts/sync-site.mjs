#!/usr/bin/env node
// Copy the assets the Pages site needs into docs/ (GitHub Pages only serves that folder).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pairs = [
  ["assets/grump.svg", "docs/assets/grump.svg"],
  ["assets/social-card.png", "docs/assets/social-card.png"],
  ["assets/benchmark.svg", "docs/assets/benchmark.svg"],
  ["benchmarks/results/latest.json", "docs/data/latest.json"],
  ["benchmarks/results/author/latest.json", "docs/data/author.json"],
];
for (const [from, to] of pairs) {
  if (!existsSync(join(ROOT, from))) {
    console.log(`skip ${from} (missing)`);
    continue;
  }
  mkdirSync(dirname(join(ROOT, to)), { recursive: true });
  copyFileSync(join(ROOT, from), join(ROOT, to));
  console.log(`copied ${from} -> ${to}`);
}
