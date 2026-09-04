import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRuleset, validateRuleset, parseRuleset } from "../scripts/lib/ruleset.mjs";
import { readFileSync } from "node:fs";
const P = JSON.parse(readFileSync(new URL("../persona.json", import.meta.url), "utf8"));

test("the ruleset parses and validates", () => {
  const rs = loadRuleset();
  assert.equal(rs.title, P.name);
  assert.deepEqual(validateRuleset(rs), []);
  assert.equal(rs.checklist.length, 10);
  assert.equal(rs.checklist[0].title, P.checklist.first);
  assert.equal(rs.checklist[9].title, P.checklist.last);
  assert.deepEqual(rs.modes.map((m) => m.name), ["nag", "gate", "off"]);
  assert.equal(rs.commands.length, 6);
  assert.equal(rs.catchphrase, P.tagline);
  assert.match(rs.verdictExample, new RegExp("^" + P.verdictPrefix + ": " + P.verdicts.changes));
});

test("the ruleset never uses the banned words in the Grump's own voice", () => {
  const rs = loadRuleset();
  const voice = [rs.sections["The verdict"], rs.verdictExample].join("\n");
  for (const word of ["nice work", "looks good", "minor nit"]) assert.ok(!voice.toLowerCase().includes(word), word);
});

test("a broken ruleset reports problems instead of throwing", () => {
  const rs = parseRuleset("# X\n\n## The checklist\n\n1. **Only.** one\n\n## Modes\n\n- `nag`: a\n");
  const problems = validateRuleset(rs);
  assert.ok(problems.some((p) => /expected 10/.test(p)));
  assert.ok(problems.some((p) => /mode gate missing/.test(p)));
  assert.throws(() => parseRuleset("no title"), /missing level-1 title/);
});
