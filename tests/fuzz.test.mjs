import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseVerdicts, lastVerdict, parseFinding } from "../hooks/lib/verdict.mjs";

const P = JSON.parse(readFileSync(new URL("../persona.json", import.meta.url), "utf8"));

// The verdict parser reads whatever the model printed. That text is not hostile on purpose, but it
// is not controlled either, and it is parsed inside the PreToolUse hook -- which has a timeout and
// fails open, so making the parser hang or throw is a way to turn a refusal into an allow. A real
// exponential backtracking bug shipped here and was found by a scanner rather than by this suite.
//
// Deterministic on purpose: a seeded generator that fails once fails again on the next run with the
// offending input printed, instead of going quiet until CI happens to roll the same bytes.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

// Pieces that mean something to the parser, so the generator spends its time near the grammar
// rather than in random noise any parser rejects on the first character.
const ATOMS = [
  `${P.verdictPrefix}:`, P.verdicts.approve, P.verdicts.changes, P.verdicts.block, "OVERRIDE",
  "1.", "2)", "—", "–", "--", ":", "`", "/", "\\", ".", "!/", "a.py", "src/a.py",
  "/repo/a.py", "12", "0", " ", "\t", "\n", ">", "#", "**", "…", "é", "🙂",
];

function grow(rand, budget) {
  let out = "";
  while (out.length < budget) out += ATOMS[Math.floor(rand() * ATOMS.length)];
  return out.slice(0, budget);
}

test("the finding parser never throws and never hangs on generated input", () => {
  const rand = rng(0x5eed1);
  for (let i = 0; i < 4000; i++) {
    const line = grow(rand, 1 + Math.floor(rand() * 160));
    const started = Date.now();
    let result;
    try {
      result = parseFinding(line);
    } catch (err) {
      assert.fail(`parseFinding threw on ${JSON.stringify(line)}: ${err.message}`);
    }
    const took = Date.now() - started;
    assert.ok(took < 200, `parseFinding took ${took}ms on ${JSON.stringify(line)}`);
    // A parse either fails, or produces a finding whose line number is a real number.
    if (result && result.line !== null) assert.ok(Number.isFinite(result.line), JSON.stringify(line));
  }
});

test("the verdict parser never throws and never hangs on generated replies", () => {
  const rand = rng(0xd1ce);
  for (let i = 0; i < 1500; i++) {
    const lines = [];
    for (let n = 1 + Math.floor(rand() * 6); n > 0; n--) lines.push(grow(rand, 1 + Math.floor(rand() * 120)));
    const reply = lines.join("\n");
    const started = Date.now();
    try {
      const parsed = parseVerdicts(reply);
      lastVerdict(reply);
      assert.ok(Array.isArray(parsed), "parseVerdicts returns a list");
    } catch (err) {
      assert.fail(`parsing threw on ${JSON.stringify(reply)}: ${err.message}`);
    }
    const took = Date.now() - started;
    assert.ok(took < 500, `parsing took ${took}ms on ${JSON.stringify(reply)}`);
  }
});

test("the pathological input that shipped is covered explicitly", () => {
  // The shape the scanner named: repeated "!/" ahead of no colon at all.
  for (const n of [20, 40, 80, 160]) {
    const line = `1. ${"!/".repeat(n)}x — it breaks — fix it`;
    const started = Date.now();
    parseFinding(line);
    const took = Date.now() - started;
    assert.ok(took < 200, `${n} repetitions took ${took}ms`);
  }
});
