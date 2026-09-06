// SPDX-FileCopyrightText: 2026 Sandeep Bazar
// SPDX-License-Identifier: Apache-2.0
//
// An agent that reports success having written nothing is the failure a reviewer is least likely to
// catch, because there is no diff to look at. These cover the three cases that separates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lastVerdict, parseFinding } from "../hooks/lib/verdict.mjs";

const P = JSON.parse(readFileSync(new URL("../persona.json", import.meta.url), "utf8"));
const BIN = new URL(`../bin/${P.command}.mjs`, import.meta.url).pathname;

function inEmptyRepo(args) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "lsd-incomplete-"));
  try {
    const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    writeFileSync(join(dir, "a.py"), "x = 1\n");
    git("add", "-A");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "i"], { cwd: dir, stdio: "pipe" });
    try {
      return { out: execFileSync("node", [BIN, ...args], { cwd: dir, encoding: "utf8" }), code: 0 };
    } catch (err) {
      return { out: err.stdout || "", code: err.status };
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("no task and no diff is not a finding", () => {
  const { out, code } = inEmptyRepo(["review", "--staged"]);
  assert.match(out, /Nothing to review/);
  assert.equal(code, 0);
});

test(P.incompleteVerdict ? "a stated task with no diff is refused" : "a persona without an incomplete verdict stays quiet", () => {
  const { out, code } = inEmptyRepo(["review", "--staged", "--task", "add a retry to the payment webhook"]);
  if (!P.incompleteVerdict) {
    assert.match(out, /Nothing to review/);
    assert.equal(code, 0);
    return;
  }
  assert.equal(code, 1, "a refusal has to be non-zero so a gate can act on it");
  // The parser reports a canonical verdict and the persona's own word for it; this persona's
  // word is the one a reader sees, so that is the one worth asserting.
  const v = lastVerdict(out);
  assert.equal(v.label, P.incompleteVerdict);
  const finding = parseFinding(out.split("\n")[0]);
  assert.ok(finding && finding.complete, "the finding has to parse like every other finding");
  assert.match(out, /add a retry to the payment webhook/, "it quotes the task it was given");
});
