import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toSarif } from "../action/lib/sarif.mjs";

const P = JSON.parse(readFileSync(new URL("../persona.json", import.meta.url), "utf8"));

const fileResult = (verdict, findings, malformed = []) => ({
  file: { filename: "src/app.py" },
  verdict: { verdict, findings, malformed },
});
const finding = (line, failure = "exception is swallowed", fix = "log it before returning 503") =>
  ({ line, failure, fix, complete: true });

test("the document is SARIF 2.1.0 with one run and a named driver", () => {
  const s = toSarif({ results: [], verdict: P.verdicts.approve, tool: { name: P.slug, informationUri: P.homepage } });
  assert.equal(s.version, "2.1.0");
  assert.equal(s.runs.length, 1);
  assert.equal(s.runs[0].tool.driver.name, P.slug);
  assert.equal(s.runs[0].tool.driver.informationUri, P.homepage);
  assert.ok(s.runs[0].tool.driver.rules.length >= 3);
});

test("the driver never names a persona the caller did not ask for", () => {
  // This file is copied between the three personas. A default naming one of them would travel with
  // it and make the others report results under the wrong tool.
  const s = JSON.stringify(toSarif({ results: [] }));
  for (const other of ["grumpy-reviewer", "paranoid-sre", "tenured"]) {
    if (other === P.slug) continue;
    assert.ok(!s.includes(other), `the default driver does not mention ${other}`);
  }
});

test("a blocking verdict raises its findings to error, other verdicts stay warnings", () => {
  const blocked = toSarif({ results: [fileResult(P.verdicts.block, [finding(21)])] }).runs[0].results;
  assert.equal(blocked[0].level, "error");
  assert.equal(blocked[0].ruleId, "review/block");
  const changes = toSarif({ results: [fileResult(P.verdicts.changes, [finding(21)])] }).runs[0].results;
  assert.equal(changes[0].level, "warning");
  assert.equal(changes[0].ruleId, "review/finding");
});

test("a finding the parser could not read is reported, not dropped", () => {
  const s = toSarif({ results: [fileResult(P.verdicts.block, [], [{ raw: "something the parser could not read", complete: false }])] });
  const r = s.runs[0].results;
  assert.equal(r.length, 1, "a lost finding would make a broken reply look like a clean one");
  assert.equal(r[0].ruleId, "review/unparsed");
  assert.equal(r[0].level, "note");
});

test("every result carries what a SARIF consumer requires", () => {
  const s = toSarif({
    results: [fileResult(P.verdicts.block, [finding(21), finding(null)], [{ raw: "odd", complete: false }])],
    verdict: P.verdicts.block,
  });
  const declared = new Set(s.runs[0].tool.driver.rules.map((r) => r.id));
  for (const r of s.runs[0].results) {
    assert.ok(declared.has(r.ruleId), `${r.ruleId} is declared in the driver`);
    assert.ok(r.message.text.length, "a result has message text");
    // A result with no location is dropped by some consumers, so a finding whose line did not
    // parse still has to be anchored to its file.
    assert.equal(r.locations.length, 1);
    assert.equal(r.locations[0].physicalLocation.artifactLocation.uri, "src/app.py");
    assert.ok(r.partialFingerprints.primaryLocationLineHash);
  }
  const noLine = s.runs[0].results.find((r) => !r.locations[0].physicalLocation.region);
  assert.ok(noLine, "a finding without a line is still emitted");
});

test("the fingerprint survives a finding moving to a different line", () => {
  const at21 = toSarif({ results: [fileResult(P.verdicts.block, [finding(21)])] }).runs[0].results[0];
  const at84 = toSarif({ results: [fileResult(P.verdicts.block, [finding(84)])] }).runs[0].results[0];
  assert.equal(at21.partialFingerprints.primaryLocationLineHash, at84.partialFingerprints.primaryLocationLineHash);
  assert.notEqual(at21.locations[0].physicalLocation.region.startLine, at84.locations[0].physicalLocation.region.startLine);
});

test("a file with no verdict contributes nothing", () => {
  assert.equal(toSarif({ results: [{ file: { filename: "a.py" }, verdict: null }] }).runs[0].results.length, 0);
});
