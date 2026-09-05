#!/usr/bin/env node
// Turn benchmarks/results/raw/*.jsonl into benchmarks/results/<date>.md and latest.json.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadCases, BENCH_ROOT } from "./lib/cases.mjs";
import { aggregate } from "./lib/score.mjs";
import { AGENTS } from "./lib/agents.mjs";
import { ARMS } from "./lib/arms.mjs";

const RAW = join(BENCH_ROOT, "results", "raw");
const cases = loadCases();
const seeded = cases.filter((c) => c.tier === "seeded");
const clean = cases.filter((c) => c.tier === "clean");
const needle = cases.filter((c) => c.tier === "needle");
const baseCases = [...seeded, ...clean];
const date = process.argv[2] || new Date().toISOString().slice(0, 10);

if (!existsSync(RAW)) {
  console.error("no raw results; run npm run bench first");
  process.exit(1);
}

const perAgent = {};
const ORDER = ["claude", "codex", "bob", "api", "agy"];
const byOrder = (a, b) => (ORDER.indexOf(a.replace(/\.jsonl$/, "")) + 100) % 100 - (ORDER.indexOf(b.replace(/\.jsonl$/, "")) + 100) % 100 || a.localeCompare(b);
for (const file of readdirSync(RAW).filter((f) => f.endsWith(".jsonl")).sort(byOrder)) {
  const agent = file.replace(/\.jsonl$/, "");
  // One record per case, arm and run: a rerun appends rather than replacing, so the last write for
  // a key is the live one and any older row for it is history.
  const byKey = new Map();
  for (const line of readFileSync(join(RAW, file), "utf8").split("\n").filter(Boolean)) {
    const rec = JSON.parse(line);
    byKey.set(`${rec.case}|${rec.arm}|${rec.run}`, rec);
  }
  const records = [...byKey.values()];
  const errors = records.filter((r) => r.error).length;
  perAgent[agent] = { label: AGENTS[agent]?.label || agent, errors, calls: records.length, arms: aggregate(records, baseCases), needle: aggregate(records, needle) };
}

const fmt = (x, d = 0) => (x === null || x === undefined ? "n/a" : typeof x === "number" ? x.toFixed(d) : String(x));
const pct = (x) => (x === null || x === undefined ? "n/a" : `${Math.round(x * 100)}%`);
const armOrder = Object.keys(ARMS);

let md = `# Benchmark results, ${date}

**What is measured.** ${seeded.length} small diffs, each with exactly one seeded defect, plus ${clean.length} clean diffs, plus a needle tier: ${needle.length} four-file pull requests of about 150 lines with one of those defects buried among clean changes. Each diff is shown to a headless agent three ways: with no skill, with a generic "review this carefully" prompt, and with grumpy-reviewer's persona card. Every arm gets the same ticket line and the same diff.

**Scores.** *Caught* means the reviewer flagged the change (a FAIL, REQUEST_CHANGES, or BLOCK verdict) and named the seeded defect (its file plus the defect's key terms). *False positives* are clean diffs that were flagged. *BLOCK precision* is, of the diffs the Grump marked BLOCK, the share whose seeded defect is a BLOCK-class defect (secrets, injection, auth, data loss, destructive or privileged operations). Medians are across runs; the per-diff table shows hits over runs.

`;

for (const [agent, a] of Object.entries(perAgent)) {
  md += `## ${a.label}\n\n`;
  md += `Model per arm is listed in the table. ${a.calls} calls, ${a.errors} errors (errors are excluded from the scores).\n\n`;
  const anyArm = Object.values(a.arms)[0] || {};
  const nSeeded = anyArm.seeded ?? seeded.length, nClean = anyArm.clean ?? clean.length;
  if (anyArm.droppedCases?.length) md += `\nNot counted for this agent, because at least one arm has no reply for them: ${anyArm.droppedCases.join(", ")}.\n`;
  md += `| Arm | Model | Runs | Defects caught (median of ${nSeeded}) | Mean | False positives (median of ${nClean}) | BLOCK precision | Unparseable replies | Median input tokens | Median output tokens | Median latency |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const arm of armOrder) {
    const s = a.arms[arm];
    if (!s) continue;
    md += `| ${ARMS[arm].label} | \`${s.model}\` | ${s.runs} | **${fmt(s.caught.median)}** | ${fmt(s.caught.mean, 1)} | ${fmt(s.falsePositives.median)} | ${arm === "grump" ? `${pct(s.blockPrecision)} (${s.blocks} blocks)` : "n/a"} | ${s.unparseable} | ${fmt(s.tokens.inputMedian)} | ${fmt(s.tokens.outputMedian)} | ${s.latencyMedianMs === null ? "n/a" : (s.latencyMedianMs / 1000).toFixed(1) + " s"} |\n`;
  }
  if (a.needle && a.needle.grump) {
    md += `\n### Needle tier: one defect in a four-file pull request\n\n| Arm | Model | Runs | Defects found (median of ${needle.length}) | Mean | Unparseable | Median input tokens | Median latency |\n|---|---|---|---|---|---|---|---|\n`;
    for (const arm of armOrder) {
      const s = a.needle[arm];
      if (!s) continue;
      md += `| ${ARMS[arm].label} | \`${s.model}\` | ${s.runs} | **${fmt(s.caught.median)}** | ${fmt(s.caught.mean, 1)} | ${s.unparseable} | ${fmt(s.tokens.inputMedian)} | ${s.latencyMedianMs === null ? "n/a" : (s.latencyMedianMs / 1000).toFixed(1) + " s"} |\n`;
    }
    md += "\nNeedle cases are built from the seeded and clean sets (\`benchmarks/lib/cases.mjs\`): the defect's file must be named for a catch to count.\n";
  }
  const bare = a.arms.bare;
  const grump = a.arms.grump;
  if (bare && grump && bare.tokens.inputMedian !== null && grump.tokens.inputMedian !== null) {
    md += `\nOverhead of the persona card: about ${fmt(grump.tokens.inputMedian - bare.tokens.inputMedian)} input tokens per review over the no-skill arm.\n`;
  }
  md += `\n### Per diff (hits / runs)\n\n| Diff | Category | Expected | ${armOrder.filter((x) => a.arms[x]).map((x) => ARMS[x].label).join(" | ")} |\n|---|---|---|${armOrder.filter((x) => a.arms[x]).map(() => "---").join("|")}|\n`;
  for (const c of [...seeded, ...clean, ...needle]) {
    const src = c.tier === "needle" ? a.needle : a.arms;
    const cells = armOrder.filter((x) => a.arms[x]).map((x) => {
      const pc = src[x] && src[x].perCase[c.id];
      return pc ? `${pc.hits}/${pc.n}` : "-";
    });
    md += `| \`${c.id}\` | ${c.clean ? "clean" : c.tier === "needle" ? "needle: " + c.category : c.category} | ${c.clean ? "no flag" : c.verdict} | ${cells.join(" | ")} |\n`;
  }
  md += "\nFor clean diffs the cell counts false positives, so lower is better.\n\n";
}

md += `## Method

- Cases live in \`benchmarks/seeded/<id>/\` (\`diff.patch\` plus a hidden \`answer.json\` with the file, lines, defect class, and the key terms a finding must name) and \`benchmarks/clean/<id>/\`. They are original and written for this benchmark.
- Arms are defined in \`benchmarks/lib/arms.mjs\`. The Grump arm uses \`hooks/persona.md\`, the exact text the hooks inject, as the system prompt. Nothing else differs between arms.
- Agents run headless with tools disabled and a single turn: \`claude -p --safe-mode --tools ""\`, \`codex exec --sandbox read-only --ignore-user-config\`, \`agy -p --mode plan\`, or the Messages API directly. The runner is \`benchmarks/run.mjs\`; the scorer is \`benchmarks/lib/score.mjs\` and is unit-tested against a fixture.
- Every raw reply is kept in \`benchmarks/results/raw/<agent>.jsonl\`, so any number here can be re-derived: \`npm run bench:report\`.

## Limitations

- Thirty seeded defects is a small set; a difference of one or two catches between arms is noise. Read the direction, not the decimals.
- The key-term matcher is deliberately strict: a reviewer that flags the right line but describes the defect in unexpected words scores as "flagged, missed the defect". That penalises every arm equally, but it means the absolute numbers are a floor.
- Diffs are shown without the surrounding repository. Some defects (an unchecked user id, a missing authorisation check) are easier to spot with the codebase in view; others (a needless dependency) are harder. Real reviews have more context and more noise.
- Agents are non-deterministic and change between releases. The model and CLI version are recorded per run; numbers from different dates are not comparable.
- The Grump arm is asked for a fixed verdict block; the other arms are asked for a PASS/FAIL line. Both are one line of instruction; neither says what to look for.

Reproduce: \`npm run bench\` then \`npm run bench:report\`. Add \`--agents claude\` or \`--only s01\` to \`npm run bench --\` to narrow a run.
`;

const outMd = join(BENCH_ROOT, "results", `${date}.md`);
writeFileSync(outMd, md);
const latest = { date, seeded: seeded.length, clean: clean.length, needle: needle.length, agents: {} };
for (const [agent, a] of Object.entries(perAgent)) {
  latest.agents[agent] = { label: a.label, calls: a.calls, errors: a.errors, arms: {}, needle: {} };
  for (const [arm, s] of Object.entries(a.needle || {})) latest.agents[agent].needle[arm] = { label: ARMS[arm]?.label || arm, model: s.model, runs: s.runs, caughtMedian: s.caught.median, caughtMean: s.caught.mean, unparseable: s.unparseable, inputTokensMedian: s.tokens.inputMedian, latencyMedianMs: s.latencyMedianMs };
  for (const [arm, s] of Object.entries(a.arms)) {
    latest.agents[agent].arms[arm] = {
      label: ARMS[arm]?.label || arm,
      model: s.model,
      runs: s.runs,
      seeded: s.seeded,
      clean: s.clean,
      caughtMedian: s.caught.median,
      caughtMean: s.caught.mean,
      falsePositivesMedian: s.falsePositives.median,
      blockPrecision: s.blockPrecision,
      blocks: s.blocks,
      unparseable: s.unparseable,
      inputTokensMedian: s.tokens.inputMedian,
      outputTokensMedian: s.tokens.outputMedian,
      latencyMedianMs: s.latencyMedianMs,
    };
  }
}
writeFileSync(join(BENCH_ROOT, "results", "latest.json"), JSON.stringify(latest, null, 2) + "\n");
console.log(`wrote ${outMd} and results/latest.json`);
