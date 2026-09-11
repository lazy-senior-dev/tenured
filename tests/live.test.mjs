import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readDecisions } from "../scripts/lib/live.mjs";

const P = JSON.parse(readFileSync(new URL("../persona.json", import.meta.url), "utf8"));

// Shaped like the host's real stream: one JSON object per line, and a hook's stdout arrives as a
// JSON string nested inside it. Anything that is not a hook_response is noise the parser must skip.
const ev = (o) => JSON.stringify(o);
const hookResponse = (hookEvent, hookName, output) =>
  ev({ type: "system", subtype: "hook_response", hook_event: hookEvent, hook_name: hookName, output });
const deny = (reason) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });

test("a denied write is reported with the tool that was stopped", () => {
  const stream = [
    hookResponse("PreToolUse", "PreToolUse:Read", "{}\n"),
    hookResponse("PreToolUse", "PreToolUse:Edit", deny("no verdict for this write")),
  ].join("\n");
  const { denials, hookCalls } = readDecisions(stream);
  assert.equal(hookCalls, 2);
  assert.equal(denials.length, 1);
  assert.equal(denials[0].tool, "Edit");
  assert.match(denials[0].reason, /no verdict/);
});

test("an allowed write is not counted as a denial", () => {
  const stream = [
    hookResponse("PreToolUse", "PreToolUse:Edit", "{}\n"),
    hookResponse("PostToolUse", "PostToolUse:Edit", "{}\n"),
  ].join("\n");
  assert.equal(readDecisions(stream).denials.length, 0);
});

test("the persona is seen only when the prompt hook actually injected it", () => {
  // Both headings are real: "You are also the Grump" and "You are also Tenured". The article is
  // optional, and matching only one form reports the persona as absent where it was always present.
  for (const heading of [`# You are also the ${P.short}\n`, `# You are also ${P.short}\n`]) {
    const injected = hookResponse("UserPromptSubmit", "UserPromptSubmit", JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: heading },
    }));
    assert.equal(readDecisions(injected, { personaName: P.short }).personaInjected, true, heading.trim());
  }
  assert.equal(readDecisions(hookResponse("UserPromptSubmit", "UserPromptSubmit", "{}\n"), { personaName: P.short }).personaInjected, false);
});

test("malformed lines and non-hook events are skipped rather than throwing", () => {
  const stream = ["not json", "", ev({ type: "assistant" }), hookResponse("PreToolUse", "PreToolUse:Edit", "{not json"), hookResponse("PreToolUse", "PreToolUse:Write", deny("blocked"))].join("\n");
  const { denials, hookCalls } = readDecisions(stream);
  assert.equal(hookCalls, 2, "only the two hook_response lines count");
  assert.equal(denials.length, 1);
  assert.equal(denials[0].tool, "Write");
});
