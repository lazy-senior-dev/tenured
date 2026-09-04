// The persona this copy of the hooks enforces. The generator writes hooks/persona.json from
// the repository's persona.json so the hooks directory stays self-contained when copied.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DEFAULT = {
  slug: "grumpy-reviewer", command: "grumpy", name: "The Grump", short: "Grump", pronoun: "he",
  verdictPrefix: "GRUMP", verdicts: { approve: "APPROVE", changes: "REQUEST_CHANGES", block: "BLOCK" }, approveWord: "Fine.", scope: ".*",
};

let cached = null;
export function persona() {
  if (cached) return cached;
  try {
    const raw = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "persona.json"), "utf8"));
    cached = { ...DEFAULT, ...raw, verdicts: { ...DEFAULT.verdicts, ...(raw.verdicts || {}) } };
  } catch {
    cached = DEFAULT;
  }
  return cached;
}

// Canonical level for a persona-specific verdict word: APPROVE, REQUEST_CHANGES, BLOCK, OVERRIDE.
export function canonical(word, p = persona()) {
  const w = String(word).toUpperCase().replace(/ /g, "_");
  if (w === "OVERRIDE") return "OVERRIDE";
  for (const [level, label] of Object.entries(p.verdicts)) if (label.toUpperCase().replace(/ /g, "_") === w) return { approve: "APPROVE", changes: "REQUEST_CHANGES", block: "BLOCK" }[level];
  if (["APPROVE", "REQUEST_CHANGES", "BLOCK"].includes(w)) return w;
  return null;
}
