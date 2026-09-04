import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCases } from "../benchmarks/lib/cases.mjs";
import { buildPrompt, ARMS } from "../benchmarks/lib/arms.mjs";
import { scoreResponse, flagged, aggregate } from "../benchmarks/lib/score.mjs";

import { readFileSync } from "node:fs";
const P_ = JSON.parse(readFileSync(new URL("../persona.json", import.meta.url), "utf8"));
const TF_ = P_.test || {};
// F maps the fixture file names into the persona's scope; T maps the Grump's words into the persona's.
const F = (p) => (TF_.ext ? p.replace(/\.(py|ts|go)$/, TF_.ext).replace(/^(?!\/)(?!src\/)/, TF_.dir + "/").replace(/^src\//, TF_.dir + "/").replace(/^\/repo\/src\//, "/repo/" + TF_.dir + "/") : p);
const T = (s) => {
  const pairs = [["GRUMP:", P_.verdictPrefix + ":"], ["REQUEST_CHANGES", P_.verdicts.changes], ["APPROVE", P_.verdicts.approve], ["BLOCK", P_.verdicts.block], ["Fine.", P_.approveWord]];
  for (const [a, b] of pairs) s = s.replace(new RegExp(a.replace(/[.]/g, "\\.") + (/[A-Z_]+$/.test(a) ? "\\b" : ""), "gi"), (m) => (m === m.toLowerCase() && a !== "Fine." ? b.toLowerCase() : b));
  return s.replace(/(\/?(?:repo\/)?(?:src\/)?[ab]\.(?:py|ts|go))(?=[:\s,]|$)/g, (m) => F(m));
};

const P = JSON.parse(readFileSync(new URL("../persona.json", import.meta.url), "utf8"));
const cases = loadCases();
const seededCases = cases.filter((c) => c.tier === "seeded");
const s01 = cases.find((c) => c.id === "s01-py-user-id-from-body") || seededCases[0];
const c02 = cases.find((c) => c.id === "c02-ts-rename-helper") || cases.find((c) => c.tier === "clean");

test("the corpus is 30 seeded plus 10 clean plus 10 needle cases, each with a ticket line and a diff", () => {
  assert.equal(cases.filter((c) => c.tier === "seeded").length, P.bench.seeded);
  assert.equal(cases.filter((c) => c.tier === "clean").length, P.bench.clean);
  const needles = cases.filter((c) => c.tier === "needle");
  assert.equal(needles.length, P.bench.needle);
  for (const n of needles) {
    assert.equal(n.parts.length, 4, n.id);
    assert.ok(n.diff.split("\n").length > 60, n.id + " is a real pull request");
    assert.ok(n.diff.includes(n.file), n.id + " contains the seeded file");
    assert.equal((n.diff.match(/^Ticket: /gm) || []).length, 1, n.id + " has one ticket line");
  }
  for (const c of cases) {
    assert.ok(c.ticket, c.id + " ticket");
    assert.match(c.diff, /^diff --git|\ndiff --git/, c.id + " diff");
    if (!c.clean) {
      assert.ok(["BLOCK", "REQUEST_CHANGES"].includes(c.verdict), c.id + " verdict");
      assert.ok(Array.isArray(c.match) && c.match.length >= 1, c.id + " match");
      assert.ok(c.diff.includes(c.file), c.id + " names its file");
    }
  }
  assert.ok(new Set(cases.map((c) => c.language)).size >= 1);
});

test("every arm gets the same diff and a way to say pass or fail", () => {
  for (const arm of Object.keys(ARMS)) {
    const p = buildPrompt(arm, s01);
    assert.ok(p.user.includes(s01.diff), arm + " sees the diff");
    assert.ok(p.user.includes(s01.ticket), arm + " sees the ticket");
  }
  assert.match(buildPrompt("grump", s01).system, new RegExp(P.verdictPrefix + ":"));
  assert.equal(buildPrompt("bare", s01).system, "");
  assert.throws(() => buildPrompt("nope", s01), /unknown arm/);
});

test("flagged reads verdict blocks and PASS/FAIL lines, last one wins", () => {
  assert.equal(flagged(T("GRUMP: APPROVE\nFine.")), false);
  assert.equal(flagged(T("GRUMP: BLOCK\n1. a:1 — b — c")), true);
  assert.equal(flagged("looks fine to me\nVERDICT: PASS"), false);
  assert.equal(flagged("VERDICT: PASS\n\nactually no\nVERDICT: FAIL"), true);
  assert.equal(flagged("no opinion"), null);
});

test("scoring a seeded case: caught needs a flag and the named defect", { skip: !cases.some((c) => c.id === "s01-py-user-id-from-body") }, () => {
  const hit = T("GRUMP: BLOCK\n1. app/api/profiles.py:14 — user_id comes from the body so any authenticated user can read another user's profile — read it from the session");
  const s = scoreResponse(s01, hit);
  assert.equal(s.caught, true);
  assert.equal(s.blocked, true);
  assert.equal(s.blockCorrect, true);
  assert.equal(s.findings, 1);
  const wrongReason = scoreResponse(s01, T("GRUMP: REQUEST_CHANGES\n1. app/api/profiles.py:20 — no test — add one"));
  assert.equal(wrongReason.flagged, true);
  assert.equal(wrongReason.caught, false);
  const passed = scoreResponse(s01, "Looks good. VERDICT: PASS");
  assert.equal(passed.caught, false);
  assert.equal(passed.unparseable, false);
  const freeText = scoreResponse(s01, "the /me handler takes user_id from the body; that is an authorization bypass.\nVERDICT: FAIL");
  assert.equal(freeText.caught, true, "single-file diffs do not require the file name");
  const s16 = cases.find((c) => c.id === "s16-ts-needless-dependency");
  assert.equal(scoreResponse(s16, "a dependency for one line of arithmetic\nVERDICT: FAIL").caught, false, "multi-file diffs require the file name");
  assert.equal(scoreResponse(s16, "package.json adds a dependency for one line of arithmetic\nVERDICT: FAIL").caught, true);
  assert.equal(freeText.verdict, null);
});

test("scoring a clean case: a flag is a false positive", () => {
  assert.equal(scoreResponse(c02, T("GRUMP: APPROVE\nFine.")).falsePositive, false);
  assert.equal(scoreResponse(c02, "VERDICT: FAIL").falsePositive, true);
  assert.equal(scoreResponse(c02, "hmm").unparseable, true);
});

test("aggregate produces medians per arm and per-case hit counts", { skip: !cases.some((c) => c.id === "s01-py-user-id-from-body") }, () => {
  const fixture = [];
  const mk = (arm, c, run, text, extra = {}) => ({ arm, case: c.id, run, model: "m", score: scoreResponse(c, text), usage: { input: 100 + run, output: 10 }, durationMs: 1000, ...extra });
  const hit = T("GRUMP: BLOCK\n1. app/api/profiles.py:14 — user_id from the body lets any user read another user — use the session");
  for (const run of [1, 2, 3]) {
    fixture.push(mk("grump", s01, run, run === 2 ? T("GRUMP: APPROVE\nFine.") : hit));
    fixture.push(mk("grump", c02, run, run === 3 ? T("GRUMP: REQUEST_CHANGES\n1. x:1 — y — z") : T("GRUMP: APPROVE\nFine.")));
    fixture.push(mk("bare", s01, run, "VERDICT: PASS"));
    fixture.push(mk("bare", c02, run, "VERDICT: PASS"));
  }
  fixture.push({ arm: "bare", case: s01.id, run: 1, error: "boom" });
  const agg = aggregate(fixture, [s01, c02]);
  assert.equal(agg.grump.caught.median, 1);
  assert.deepEqual(agg.grump.caught.perRun, [1, 0, 1]);
  assert.equal(agg.grump.falsePositives.median, 0);
  assert.equal(agg.grump.blockPrecision, 1);
  assert.equal(agg.grump.blocks, 2);
  assert.equal(agg.bare.caught.median, 0);
  assert.equal(agg.grump.perCase[s01.id].hits, 2);
  assert.equal(agg.grump.perCase[c02.id].hits, 1);
  assert.equal(agg.grump.tokens.inputMedian, 102);
});

test("every author-tier task has a scaffold, a ticket, and fixed checks that are functions", async () => {
  const { loadTasks } = await import("../benchmarks/lib/authors.mjs");
  const { existsSync } = await import("node:fs");
  const { pathToFileURL } = await import("node:url");
  const tasks = loadTasks();
  assert.ok(tasks.length >= 8, `expected at least 8 tasks, found ${tasks.length}`);
  for (const t of tasks) {
    assert.ok(existsSync(`${t.dir}/scaffold`), `${t.id} has no scaffold`);
    assert.match(t.task, /^Ticket: /, `${t.id} ticket line`);
    const c = await import(pathToFileURL(`${t.dir}/check.mjs`).href);
    assert.equal(typeof c.implemented, "function", `${t.id} implemented`);
    assert.equal(typeof c.shipped, "function", `${t.id} shipped`);
    assert.ok(typeof c.defect === "string" && c.defect.length > 10, `${t.id} defect description`);
    assert.equal(c.implemented("", ""), false, `${t.id}: an empty diff is not an implementation`);
  }
});
