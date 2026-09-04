#!/usr/bin/env node
// Print what the Grump caught in a session as a markdown table.
//   node review-scorecard.mjs [session_id]

import { readScorecard, latestScorecardSession, scorecardPath } from "./lib/config.mjs";

const requested = (process.argv[2] || "").trim();
const sessionId = requested && requested !== "unknown" ? requested : latestScorecardSession();

if (!sessionId) {
  console.log("No scorecard yet. The reviewer has not seen a write in this session.");
  process.exit(0);
}

const rows = readScorecard(sessionId);
if (!rows.length) {
  console.log(`No entries in ${scorecardPath(sessionId)}.`);
  process.exit(0);
}

const count = (pred) => rows.filter(pred).length;
const summary = {
  writes: rows.length,
  approved: count((r) => r.verdict === "APPROVE"),
  changesRequested: count((r) => r.verdict === "REQUEST_CHANGES"),
  blocked: count((r) => r.verdict === "BLOCK"),
  denied: count((r) => r.decision === "deny"),
  overrides: count((r) => r.logged === "override"),
  unreviewed: count((r) => !r.verdict),
  findings: rows.reduce((n, r) => n + (r.findings || 0), 0),
};

console.log(`Review scorecard for session ${sessionId}`);
console.log("");
console.log("| Writes seen | Approved | Changes requested | Blocked | Denied at the gate | Overrides | Unreviewed | Findings |");
console.log("|---|---|---|---|---|---|---|---|");
console.log(`| ${summary.writes} | ${summary.approved} | ${summary.changesRequested} | ${summary.blocked} | ${summary.denied} | ${summary.overrides} | ${summary.unreviewed} | ${summary.findings} |`);
console.log("");
console.log("| Time | Target | Verdict | Findings | Gate | Mode |");
console.log("|---|---|---|---|---|---|");
for (const r of rows) {
  const time = String(r.ts || "").replace("T", " ").slice(11, 19);
  console.log(`| ${time} | ${r.file || ""} | ${r.verdict || "none"} | ${r.findings || 0} | ${r.decision}${r.logged === "override" ? " (override)" : ""} | ${r.mode} |`);
}
