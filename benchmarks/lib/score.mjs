// Scoring. Pure functions over (case, response text).
import { lastVerdict } from "../../hooks/lib/verdict.mjs";

const PASS_FAIL = /VERDICT:\s*(PASS|FAIL)\b/gi;

// Did the reviewer flag the change? true, false, or null when it said neither.
export function flagged(text) {
  const v = lastVerdict(text || "");
  if (v && !v.override) return v.verdict !== "APPROVE";
  let last = null;
  for (const m of (text || "").matchAll(PASS_FAIL)) last = m[1].toUpperCase();
  if (last) return last === "FAIL";
  return null;
}

export function keywordsHit(c, text) {
  if (!c.match || !c.match.length) return true;
  const hay = text || "";
  return c.match.every((alt) => new RegExp(alt, "i").test(hay));
}

// Only required when the diff touches more than one file; a single-file review
// that says "the handler" instead of the file name has still found the defect.
export function fileMentioned(c, text) {
  if (!c.file) return true;
  const files = (c.diff || "").match(/^diff --git /gm) || [];
  if (files.length <= 1) return true;
  const base = c.file.split("/").pop();
  return (text || "").includes(base);
}

export function scoreResponse(c, text) {
  const v = lastVerdict(text || "");
  const isFlagged = flagged(text);
  const verdict = v && !v.override ? v.verdict : null;
  if (c.clean) {
    return { flagged: isFlagged, verdict, falsePositive: isFlagged === true, unparseable: isFlagged === null };
  }
  const named = keywordsHit(c, text) && fileMentioned(c, text);
  return {
    flagged: isFlagged,
    verdict,
    caught: isFlagged === true && named,
    named,
    unparseable: isFlagged === null,
    blocked: verdict === "BLOCK",
    blockCorrect: verdict === "BLOCK" ? c.verdict === "BLOCK" : null,
    findings: v ? v.findings.length : null,
  };
}

const median = (xs) => {
  const a = xs.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};
const mean = (xs) => {
  const a = xs.filter((x) => typeof x === "number" && !Number.isNaN(x));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
};

// Aggregate one agent's records (all arms, cases, runs) into the summary the report prints.
export function aggregate(records, cases) {
  const byArm = {};
  const seeded = cases.filter((c) => !c.clean);
  const clean = cases.filter((c) => c.clean);
  const ids = new Set(cases.map((c) => c.id));
  records = records.filter((r) => ids.has(r.case));
  const caseById = Object.fromEntries(cases.map((c) => [c.id, c]));
  for (const r of records) {
    if (r.error || !caseById[r.case]) continue;
    const arm = (byArm[r.arm] ||= { runs: {}, perCase: {}, tokens: [], outTokens: [], latency: [], cost: [], blocked: 0, blockCorrect: 0, model: r.model });
    const run = (arm.runs[r.run] ||= { caught: 0, fp: 0, unparseable: 0, seededSeen: 0, cleanSeen: 0 });
    const s = r.score;
    const c = caseById[r.case];
    const pc = (arm.perCase[r.case] ||= { hits: 0, n: 0 });
    pc.n++;
    if (c.clean) {
      run.cleanSeen++;
      if (s.falsePositive) {
        run.fp++;
        pc.hits++;
      }
    } else {
      run.seededSeen++;
      if (s.caught) {
        run.caught++;
        pc.hits++;
      }
      if (s.blocked) {
        arm.blocked++;
        if (s.blockCorrect) arm.blockCorrect++;
      }
    }
    if (s.unparseable) run.unparseable++;
    if (r.usage) {
      arm.tokens.push(r.usage.input);
      arm.outTokens.push(r.usage.output);
    }
    if (typeof r.durationMs === "number") arm.latency.push(r.durationMs);
    if (typeof r.costUsd === "number") arm.cost.push(r.costUsd);
  }
  const out = {};
  for (const [name, arm] of Object.entries(byArm)) {
    const runs = Object.values(arm.runs);
    out[name] = {
      model: arm.model,
      runs: runs.length,
      seeded: seeded.length,
      clean: clean.length,
      caught: { median: median(runs.map((r) => r.caught)), mean: mean(runs.map((r) => r.caught)), perRun: runs.map((r) => r.caught) },
      falsePositives: { median: median(runs.map((r) => r.fp)), mean: mean(runs.map((r) => r.fp)), perRun: runs.map((r) => r.fp) },
      unparseable: runs.reduce((s, r) => s + r.unparseable, 0),
      blockPrecision: arm.blocked ? arm.blockCorrect / arm.blocked : null,
      blocks: arm.blocked,
      tokens: { inputMedian: median(arm.tokens), outputMedian: median(arm.outTokens) },
      latencyMedianMs: median(arm.latency),
      costMedianUsd: median(arm.cost),
      perCase: arm.perCase,
    };
  }
  return out;
}
