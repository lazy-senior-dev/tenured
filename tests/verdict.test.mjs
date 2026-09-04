import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { parseVerdicts, lastVerdict, parseFinding, formatVerdict } from "../hooks/lib/verdict.mjs";
const P_ = JSON.parse(readFileSync(new URL("../persona.json", import.meta.url), "utf8"));
const TF_ = P_.test || {};
// F maps the fixture file names into the persona's scope; T maps the Grump's words into the persona's.
const F = (p) => (TF_.ext ? p.replace(/\.(py|ts|go)$/, TF_.ext).replace(/^(?!\/)(?!src\/)/, TF_.dir + "/").replace(/^src\//, TF_.dir + "/").replace(/^\/repo\/src\//, "/repo/" + TF_.dir + "/") : p);
const T = (s) => {
  const pairs = [["GRUMP:", P_.verdictPrefix + ":"], ["REQUEST_CHANGES", P_.verdicts.changes], ["APPROVE", P_.verdicts.approve], ["BLOCK", P_.verdicts.block], ["Fine.", P_.approveWord]];
  for (const [a, b] of pairs) s = s.replace(new RegExp(a.replace(/[.]/g, "\\.") + (/[A-Z_]+$/.test(a) ? "\\b" : ""), "gi"), (m) => (m === m.toLowerCase() && a !== "Fine." ? b.toLowerCase() : b));
  return s.replace(/(\/?(?:repo\/)?(?:src\/)?[ab]\.(?:py|ts|go))(?=[:\s,]|$)/g, (m) => F(m));
};


const REQUEST = T(`Answering the checklist.
1. Scope: fine.

GRUMP: REQUEST_CHANGES
1. src/api/users.py:42 — user_id comes from the body, so any caller can read any user — take it from the session
2. src/api/users.py:58 — missing row raises KeyError and returns 500 — return 404 on empty lookup

Fixing now.`);

test("parses a request-changes block with two findings", () => {
  const v = lastVerdict(REQUEST);
  assert.equal(v.verdict, "REQUEST_CHANGES");
  assert.equal(v.findings.length, 2);
  assert.equal(v.findings[0].file, "src/api/users.py");
  assert.equal(v.findings[0].line, 42);
  assert.equal(v.findings[1].fix, "return 404 on empty lookup");
  assert.equal(v.malformed.length, 0);
});

test("approve is one word, optionally naming the files it covers", () => {
  const v = lastVerdict(T("GRUMP: APPROVE\nFine.\n"));
  assert.equal(v.verdict, "APPROVE");
  assert.equal(v.approvedWord, P_.approveWord);
  assert.equal(v.findings.length, 0);
  const named = lastVerdict(T("GRUMP: APPROVE — app/api/users.py, tests/test_users.py\nFine."));
  assert.equal(named.verdict, "APPROVE");
  assert.match(named.reason, /users\.py, tests/);
});

test("last verdict wins", () => {
  const text = T("GRUMP: BLOCK\n1. a.go:1 — leaks a key — remove it\n\nfixed\n\nGRUMP: APPROVE\nFine.");
  assert.equal(lastVerdict(text).verdict, "APPROVE");
  assert.equal(parseVerdicts(text).length, 2);
});

test("override carries the quoted reason", () => {
  const v = lastVerdict(T("GRUMP: OVERRIDE — user said: ship it, I own the risk"));
  assert.equal(v.override, true);
  assert.match(v.reason, /ship it/);
});

test("malformed findings are kept apart from complete ones", () => {
  const v = lastVerdict(T("GRUMP: REQUEST_CHANGES\n1. this line has no separators\n2. b.ts:3 — fails — fix"));
  assert.equal(v.findings.length, 1);
  assert.equal(v.malformed.length, 1);
  assert.equal(v.malformed[0].complete, false);
});

test("accepts hyphen separators, lower case, and a block quote", () => {
  const v = lastVerdict(T("> grump: block\n> 1. deploy.yaml:12 -- image tag latest -- pin the digest"));
  assert.equal(v.verdict, "BLOCK");
  assert.equal(v.findings.length, 1);
  assert.equal(v.findings[0].line, 12);
});

test("no verdict returns null, garbage returns null", () => {
  assert.equal(lastVerdict("nothing here"), null);
  assert.equal(lastVerdict(""), null);
  assert.equal(lastVerdict(null), null);
  assert.equal(lastVerdict("GRUMPY: APPROVE"), null);
  assert.equal(lastVerdict(T("GRUMP: MAYBE")), null);
});

test("parseFinding handles windows paths and ranges", () => {
  const f = parseFinding("3. src\\lib\\x.cs:10-14 — race on counter — take the lock");
  assert.equal(f.complete, true);
  assert.equal(f.line, 10);
});

test("formatVerdict round-trips", () => {
  const v = lastVerdict(REQUEST);
  const again = lastVerdict(formatVerdict(v));
  assert.deepEqual(again.findings.map((f) => f.file), v.findings.map((f) => f.file));
  assert.equal(formatVerdict(lastVerdict(T("GRUMP: APPROVE\nFine."))), T("GRUMP: APPROVE\nFine."));
});
