import { test } from "node:test";
import assert from "node:assert/strict";
import { isRefusal } from "../benchmarks/lib/limits.mjs";

// These tickets ask the agent to write retry loops, mailers and HTTP error handling, so a finished,
// correct run routinely uses the same words a refusal does. Reading the reply as a refusal aborted
// whole passes on completed work, which is why these are the first cases here.
test("an agent writing about retries and 429s has not been refused", () => {
  for (const text of [
    "Implementation looks correct. I added backoff so we do not trip the rate limit and retry on 429.",
    "The endpoint returns 429 Too Many Requests when the caller exceeds the quota.",
    "Capped retries so a burst cannot become a retry storm against a rate limit.",
  ]) {
    assert.equal(isRefusal({ text, stderr: "", exit: 0 }), false, text.slice(0, 40));
  }
});

test("the host's own refusal is recognised in either stream", () => {
  assert.equal(isRefusal({ text: "You've hit your session limit · resets 9:50pm (Asia/Calcutta)", exit: 1 }), true);
  assert.equal(isRefusal({ text: "", stderr: "usage limit reached, try again at 5:36 AM", exit: 1 }), true);
  assert.equal(isRefusal({ text: "", stderr: "Resets in 2h46m59s -- usage limit", exit: 1 }), true);
  assert.equal(isRefusal({ text: "quota exceeded for this account", exit: 0 }), true);
});

test("a failed process is read the looser way, because then the words are probably the cause", () => {
  assert.equal(isRefusal({ text: "request failed with 429", exit: 1 }), true);
  assert.equal(isRefusal({ text: "request failed with 429", exit: 0 }), false);
});

test("an ordinary run is not a refusal", () => {
  assert.equal(isRefusal({ text: "Added the header check and a constant-time compare.", stderr: "", exit: 0 }), false);
  assert.equal(isRefusal({}), false);
});
