// The three arms. Every arm sees the same ticket line and the same diff and is
// asked for a machine-readable last line, so the scorer treats them alike.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BENCH_ROOT } from "./cases.mjs";
const P = JSON.parse(readFileSync(join(BENCH_ROOT, "..", "persona.json"), "utf8"));

const VERDICT_LINE = "End your reply with exactly one line: `VERDICT: PASS` if you would merge this as it is, or `VERDICT: FAIL` if something must change first.";

export const ARMS = {
  bare: {
    label: "no skill",
    system: "",
    user: (c) => `Review this change before it is merged.\n\n${c.diff}\n\n${VERDICT_LINE}`,
  },
  generic: {
    label: "generic review prompt",
    system:
      "You are a careful senior code reviewer. Read the whole change. Look for correctness bugs, security problems, missing error handling, unhandled edge cases, and operational risk. For every problem cite the file and line, explain the impact, and say what to change. Do not comment on style unless nothing else is wrong.",
    user: (c) => `Review this change carefully before it is merged.\n\n${c.diff}\n\n${VERDICT_LINE}`,
  },
  grump: {
    label: P.slug,
    system: () => readFileSync(join(BENCH_ROOT, "..", "hooks", "persona.md"), "utf8") + "\n\nPrint the verdict block and nothing else.",
    user: (c) => `Review this change as ${P.asName || P.name}.\n\n${c.diff}`,
  },
};

export function buildPrompt(armName, c) {
  const arm = ARMS[armName];
  if (!arm) throw new Error(`unknown arm ${armName}`);
  const system = typeof arm.system === "function" ? arm.system() : arm.system;
  return { system, user: arm.user(c) };
}
