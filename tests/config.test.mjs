import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grumpy-"));
  process.env.GRUMPY_CONFIG_DIR = dir;
  delete process.env.GRUMPY_MODE;
});

const lib = await import("../hooks/lib/config.mjs");

test("default mode is nag", () => {
  assert.deepEqual(lib.resolveMode(), { mode: "nag", source: "default" });
});

test("setMode persists to config.json and reports the previous mode", () => {
  assert.deepEqual(lib.setMode("gate"), { mode: "gate", previous: "nag" });
  assert.equal(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).mode, "gate");
  assert.equal(lib.resolveMode().mode, "gate");
  assert.deepEqual(lib.setMode("OFF"), { mode: "off", previous: "gate" });
});

test("GRUMPY_MODE wins over config.json", () => {
  lib.setMode("gate");
  process.env.GRUMPY_MODE = "off";
  assert.deepEqual(lib.resolveMode(), { mode: "off", source: "GRUMPY_MODE" });
  process.env.GRUMPY_MODE = "bogus";
  assert.equal(lib.resolveMode().mode, "gate");
});

test("malformed config is ignored", () => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), "{not json");
  assert.equal(lib.resolveMode().mode, "nag");
  writeFileSync(join(dir, "config.json"), JSON.stringify({ mode: "loud" }));
  assert.equal(lib.resolveMode().mode, "nag");
});

test("a .grumpy.json in the repository wins over the user config", () => {
  lib.setMode("off");
  const repo = mkdtempSync(join(tmpdir(), "grumpy-repo-"));
  mkdirSync(join(repo, "src", "deep"), { recursive: true });
  writeFileSync(join(repo, ".grumpy.json"), JSON.stringify({ mode: "gate" }));
  assert.equal(lib.resolveMode(join(repo, "src", "deep")).mode, "gate");
  assert.equal(lib.resolveMode(join(repo, "src", "deep")).source, join(repo, ".grumpy.json"));
  process.env.GRUMPY_MODE = "nag";
  assert.equal(lib.resolveMode(join(repo, "src")).mode, "nag", "the environment still wins");
  delete process.env.GRUMPY_MODE;
  writeFileSync(join(repo, ".grumpy.json"), "{broken");
  assert.equal(lib.resolveMode(repo).mode, "off", "a broken project file is ignored");
});

test("unknown mode is rejected", () => {
  assert.throws(() => lib.setMode("shout"), /unknown mode/);
});

test("scorecard appends and reads back, tolerating a bad line", () => {
  lib.appendScorecard("abc/../x", { decision: "deny" });
  lib.appendScorecard("abc/../x", { decision: "allow" });
  writeFileSync(lib.scorecardPath("abc/../x"), readFileSync(lib.scorecardPath("abc/../x"), "utf8") + "garbage\n");
  const rows = lib.readScorecard("abc/../x");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].decision, "allow");
  assert.ok(rows[0].ts);
  assert.equal(lib.latestScorecardSession(), "abc_.._x");
});

test("state round-trips", () => {
  lib.writeState("s", { denials: { "a.py": 2 } });
  assert.deepEqual(lib.readState("s"), { denials: { "a.py": 2 } });
  assert.deepEqual(lib.readState("missing"), {});
});

test("house rules are appended to the card, never replace it, and a missing or unreadable file is ignored", async () => {
  const { withHousePolicy, housePolicy, POLICY_LIMIT } = await import("../hooks/lib/config.mjs");
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const empty = mkdtempSync(join(tmpdir(), "policy-none-"));
  assert.equal(housePolicy(empty), null);
  assert.equal(withHousePolicy("CARD", empty), "CARD", "no house rules means the card is untouched");

  const repo = mkdtempSync(join(tmpdir(), "policy-"));
  mkdirSync(join(repo, ".grumpy"), { recursive: true });
  writeFileSync(join(repo, ".grumpy.json"), JSON.stringify({ mode: "gate" }));
  writeFileSync(join(repo, ".grumpy", "policy.md"), "- Every endpoint carries a rate limit.");
  const merged = withHousePolicy("CARD", repo);
  assert.ok(merged.startsWith("CARD"), "the ruleset comes first");
  assert.match(merged, /## House rules/);
  assert.match(merged, /rate limit/);
  assert.match(merged, /can never lower one or waive a non-negotiable/, "precedence has to be stated to the reviewer");

  const big = mkdtempSync(join(tmpdir(), "policy-big-"));
  mkdirSync(join(big, ".grumpy"), { recursive: true });
  writeFileSync(join(big, ".grumpy", "policy.md"), "x".repeat(POLICY_LIMIT + 5000));
  const cut = housePolicy(big);
  assert.equal(cut.truncated, true);
  assert.ok(cut.text.length < POLICY_LIMIT + 100, "a huge policy file cannot flood every turn");

  const named = mkdtempSync(join(tmpdir(), "policy-named-"));
  writeFileSync(join(named, ".grumpy.json"), JSON.stringify({ policy: "rules/house.md" }));
  mkdirSync(join(named, "rules"), { recursive: true });
  writeFileSync(join(named, "rules", "house.md"), "- No new dependencies without an owner.");
  assert.match(withHousePolicy("CARD", named), /No new dependencies/);
});
