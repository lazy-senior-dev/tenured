import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync , readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normaliseInput, classify, decide, render, bumpDenials, clearDenials, applicableVerdict } from "../hooks/lib/gate.mjs";
import { lastVerdict } from "../hooks/lib/verdict.mjs";
import { assistantTextSinceLastPrompt, latestAssistantText } from "../hooks/lib/transcript.mjs";
const P_ = JSON.parse(readFileSync(new URL("../persona.json", import.meta.url), "utf8"));
const TF_ = P_.test || {};
// F maps the fixture file names into the persona's scope; T maps the Grump's words into the persona's.
const F = (p) => (TF_.ext ? p.replace(/\.(py|ts|go)$/, TF_.ext).replace(/^(?!\/)(?!src\/)/, TF_.dir + "/").replace(/^src\//, TF_.dir + "/").replace(/^\/repo\/src\//, "/repo/" + TF_.dir + "/") : p);
const T = (s) => {
  const pairs = [["GRUMP:", P_.verdictPrefix + ":"], ["REQUEST_CHANGES", P_.verdicts.changes], ["APPROVE", P_.verdicts.approve], ["BLOCK", P_.verdicts.block], ["Fine.", P_.approveWord]];
  for (const [a, b] of pairs) s = s.replace(new RegExp(a.replace(/[.]/g, "\\.") + (/[A-Z_]+$/.test(a) ? "\\b" : ""), "gi"), (m) => (m === m.toLowerCase() && a !== "Fine." ? b.toLowerCase() : b));
  return s.replace(/(\/?(?:repo\/)?(?:src\/)?[ab]\.(?:py|ts|go))(?=[:\s,]|$)/g, (m) => F(m));
};


const write = { toolName: "Write", toolInput: { file_path: F("src/a.py"), content: "" } };

test("classify recognises writes, commits, and ignores reads", () => {
  assert.deepEqual(classify(write), { kind: "write", file: F("src/a.py") });
  assert.equal(classify({ toolName: "Read", toolInput: { file_path: "x" } }), null);
  assert.equal(classify({ toolName: "Bash", toolInput: { command: "git status" } }), null);
  assert.equal(classify({ toolName: "Bash", toolInput: { command: "git add -A && git commit -m x" } }).kind, "commit");
  assert.equal(classify({ toolName: "Bash", toolInput: { command: "git -c user.name=x commit -m y" } }).kind, "commit");
  assert.equal(classify({ toolName: "apply_patch", toolInput: { input: "*** Begin Patch\n*** Update File: lib/b.go\n" } }).file, "lib/b.go");
  assert.equal(classify({ toolName: "MultiEdit", toolInput: { edits: [{ file_path: "m.ts" }] } }).file, "m.ts");
});

test("normaliseInput accepts claude and copilot shapes", () => {
  const a = normaliseInput({ tool_name: "Edit", tool_input: { file_path: "x" }, session_id: "s", transcript_path: "/t" });
  const b = normaliseInput({ toolName: "edit", toolArgs: { path: "x" }, sessionId: "s" }, "copilot");
  assert.equal(a.toolName, "Edit");
  assert.equal(a.transcriptPath, "/t");
  assert.equal(b.toolInput.path, "x");
  assert.equal(b.transcriptPath, null);
  assert.equal(normaliseInput(null).sessionId, "unknown");
});

const target = { kind: "write", file: F("src/a.py") };
const block = lastVerdict(T("GRUMP: BLOCK\n1. src/a.py:1 — secret in code — move to env"));
const changes = lastVerdict(T("GRUMP: REQUEST_CHANGES\n1. src/a.py:1 — unhandled error — return 404"));
const approve = lastVerdict(T("GRUMP: APPROVE\nFine."));
const override = lastVerdict(T("GRUMP: OVERRIDE — user: proceed, I accept it"));

test("off mode skips everything", () => {
  assert.equal(decide({ mode: "off", verdict: block, target }).action, "skip");
});

test("BLOCK is denied in nag and gate alike", () => {
  assert.equal(decide({ mode: "nag", verdict: block, target }).action, "deny");
  assert.equal(decide({ mode: "gate", verdict: block, target }).action, "deny");
});

test("REQUEST_CHANGES is denied only in gate", () => {
  assert.equal(decide({ mode: "nag", verdict: changes, target }).action, "allow");
  assert.match(decide({ mode: "nag", verdict: changes, target }).context, /1 finding/);
  assert.equal(decide({ mode: "gate", verdict: changes, target }).action, "deny");
});

test("APPROVE and OVERRIDE allow", () => {
  assert.equal(decide({ mode: "gate", verdict: approve, target }).action, "allow");
  const o = decide({ mode: "gate", verdict: override, target });
  assert.equal(o.action, "allow");
  assert.equal(o.logged, "override");
});

test("no verdict: nag allows with a reminder, gate denies then falls back", () => {
  const nag = decide({ mode: "nag", verdict: null, target });
  assert.equal(nag.action, "allow");
  assert.match(nag.context, /No verdict/);
  assert.equal(decide({ mode: "gate", verdict: null, target, denials: 0 }).action, "deny");
  assert.equal(decide({ mode: "gate", verdict: null, target, denials: 1 }).action, "deny");
  const fb = decide({ mode: "gate", verdict: null, target, denials: 2 });
  assert.equal(fb.action, "allow");
  assert.equal(fb.logged, "gate_fallback");
});

test("denial counters", () => {
  let s = bumpDenials({}, "a");
  s = bumpDenials(s, "a");
  assert.equal(s.denials.a, 2);
  assert.deepEqual(clearDenials(s, "a").denials, {});
  assert.equal(clearDenials({}, "a").denials, undefined);
});

test("render speaks each host's dialect", () => {
  const deny = { action: "deny", reason: "no" };
  const allow = { action: "allow", context: "hint" };
  assert.equal(JSON.parse(render(deny, "claude").stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(JSON.parse(render(allow, "claude").stdout).hookSpecificOutput.additionalContext, "hint");
  assert.equal(JSON.parse(render(allow, "claude").stdout).hookSpecificOutput.permissionDecision, undefined);
  assert.equal(render({ action: "allow" }, "claude").stdout, "");
  assert.equal(JSON.parse(render(deny, "copilot").stdout).permissionDecision, "deny");
  assert.equal(render(allow, "copilot").stdout, "");
  assert.equal(JSON.parse(render(deny, "gemini").stdout).decision, "deny");
  assert.equal(render(deny, "kiro").exitCode, 2);
  assert.equal(render(deny, "bob").exitCode, 2);
  assert.equal(render(deny, "bob").stderr, "no");
  assert.equal(render(allow, "bob").stdout, "");
  assert.equal(classify({ toolName: "write_to_file", toolInput: { path: "x.go" } }).file, "x.go");
  assert.equal(classify({ toolName: "execute_command", toolInput: { command: "git push origin main" } }).kind, "commit");
  assert.equal(render(deny, "kiro").stderr, "no");
  assert.equal(render({ action: "skip" }, "claude").stdout, "");
});

test("transcript: assistant text since the last human prompt", () => {
  const lines = [
    { type: "user", message: { content: "first prompt" } },
    { type: "assistant", message: { content: [{ type: "text", text: T("GRUMP: APPROVE\nFine.") }] } },
    { type: "user", message: { content: [{ type: "text", text: "second prompt" }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "thinking" }, { type: "tool_use", name: "Read" }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "file" }] } },
    { type: "assistant", message: { content: [{ type: "text", text: T("GRUMP: BLOCK\n1. a:1 — b — c") }] } },
    "not json",
  ].map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n");
  const text = assistantTextSinceLastPrompt(lines);
  assert.ok(text.includes("thinking"));
  assert.ok(text.includes(T("GRUMP: BLOCK")));
  assert.ok(!text.includes(T("APPROVE")));
});

test("a verdict covers the files it names; an unnamed one covers the write; earlier verdicts need the file", () => {
  const forA = lastVerdict(T("GRUMP: REQUEST_CHANGES\n1. src/a.py:3 — x — y"));
  const fineA = lastVerdict(T("GRUMP: APPROVE — src/a.py\nFine."));
  const fine = lastVerdict(T("GRUMP: APPROVE\nFine."));
  const a = { kind: "write", file: F("/repo/src/a.py") }, b = { kind: "write", file: F("/repo/src/b.py") };
  assert.equal(applicableVerdict({ latest: fineA, earlier: null, target: a }), fineA);
  assert.equal(applicableVerdict({ latest: fineA, earlier: null, target: b }), null, "an approval naming a.py does not cover b.py");
  assert.equal(applicableVerdict({ latest: fine, earlier: null, target: b }), fine, "an approval naming nothing covers the write");
  assert.equal(applicableVerdict({ latest: forA, earlier: null, target: b }), null);
  assert.equal(applicableVerdict({ latest: null, earlier: forA, target: a }), forA);
  assert.equal(applicableVerdict({ latest: null, earlier: forA, target: b }), null);
  assert.equal(applicableVerdict({ latest: null, earlier: fine, target: b }), null, "an old unnamed approval does not reach a later write");
  assert.equal(applicableVerdict({ latest: lastVerdict(T("GRUMP: OVERRIDE — user said go")), earlier: null, target: b }).override, true);
  assert.equal(applicableVerdict({ latest: fineA, earlier: null, target: { kind: "commit", file: "(git commit)" } }), fineA, "commits are covered by any approval");
});

test("latestAssistantText returns the previous completed message, not text since the last tool result", () => {
  const lines = [
    { type: "user", message: { content: "do it" } },
    { type: "assistant", message: { content: [{ type: "text", text: T("GRUMP: APPROVE — b.py\nFine.") }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Write" }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "denied" }] } },
  ].map((e) => JSON.stringify(e)).join("\n");
  assert.match(latestAssistantText(lines), new RegExp(T("APPROVE — b.py")));
  assert.equal(latestAssistantText(JSON.stringify({ type: "user", message: { content: "hi" } })), "");
});

test("transcript: text since the last tool result is narrower than text since the prompt", () => {
  const lines = [
    { type: "user", message: { content: "do it" } },
    { type: "assistant", message: { content: [{ type: "text", text: T("GRUMP: APPROVE\nFine.") }, { type: "tool_use", name: "Write" }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "now the second file" }, { type: "tool_use", name: "Write" }] } },
  ].map((e) => JSON.stringify(e)).join("\n");
  assert.ok(assistantTextSinceLastPrompt(lines).includes(T("APPROVE")));
  assert.ok(!assistantTextSinceLastPrompt(lines, { sinceTool: true }).includes("APPROVE"));
  assert.ok(assistantTextSinceLastPrompt(lines, { sinceTool: true }).includes("second file"));
});

test("end to end: a verdict for one file does not authorise a write to another in gate mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "grumpy-e2e-"));
  const transcript = join(dir, "t.jsonl");
  writeFileSync(transcript, [
    JSON.stringify({ type: "user", message: { content: "add both files" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: T("GRUMP: APPROVE — src/a.py\nFine.") }, { type: "tool_use", name: "Write" }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }),
  ].join("\n"));
  const env = { GRUMPY_CONFIG_DIR: join(dir, "cfg"), GRUMPY_MODE: "gate" };
  assert.equal(runGate({ session_id: "scope", tool_name: "Write", tool_input: { file_path: F("src/b.py") }, transcript_path: transcript }, env).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(runGate({ session_id: "scope", tool_name: "Write", tool_input: { file_path: F("src/a.py") }, transcript_path: transcript }, env), null, "the named file is allowed");
});

test("gate mode refuses malformed hook input; nag lets the host decide", () => {
  const dir = mkdtempSync(join(tmpdir(), "grumpy-e2e-"));
  assert.equal(runGate("{{not json", { GRUMPY_CONFIG_DIR: dir, GRUMPY_MODE: "gate" }).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(runGate("{{not json", { GRUMPY_CONFIG_DIR: dir, GRUMPY_MODE: "nag" }), null);
});

function runGate(input, env = {}, host = "claude") {
  const out = execFileSync(process.execPath, [join(process.cwd(), "hooks/review-gate.mjs"), "--host", host], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return out.trim() ? JSON.parse(out) : null;
}

test("end to end: the gate reads the transcript and denies a BLOCK", () => {
  const dir = mkdtempSync(join(tmpdir(), "grumpy-e2e-"));
  const transcript = join(dir, "t.jsonl");
  writeFileSync(transcript, [
    JSON.stringify({ type: "user", message: { content: "add the handler" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: T("GRUMP: BLOCK\n1. src/a.py:3 — password logged — drop it from the log line") }] } }),
  ].join("\n"));
  const env = { GRUMPY_CONFIG_DIR: join(dir, "cfg"), GRUMPY_MODE: "nag" };
  const res = runGate({ session_id: "e2e", tool_name: "Write", tool_input: { file_path: F("src/a.py") }, transcript_path: transcript }, env);
  assert.equal(res.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(runGate({ session_id: "e2e", tool_name: "Read", tool_input: { file_path: F("src/a.py") } }, env), null);
  assert.equal(runGate("{{not json", env), null);
  assert.equal(runGate({ session_id: "e2e", tool_name: "Write", tool_input: { file_path: F("src/a.py") } }, { ...env, GRUMPY_MODE: "off" }), null);
});

test("end to end: gate mode without a transcript denies twice then lets the write through", () => {
  const dir = mkdtempSync(join(tmpdir(), "grumpy-e2e-"));
  const env = { GRUMPY_CONFIG_DIR: join(dir, "cfg"), GRUMPY_MODE: "gate" };
  const call = { session_id: "g", tool_name: "Edit", tool_input: { file_path: F("b.ts") } };
  assert.equal(runGate(call, env).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(runGate(call, env).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(runGate(call, env).hookSpecificOutput.permissionDecision, undefined);
  assert.equal(runGate({ sessionId: "g", toolName: "edit", toolArgs: { path: F("c.ts") } }, env, "copilot").permissionDecision, "deny");
});

test("context hook prints the card with the mode, and nothing when off", () => {
  const run = (env) =>
    execFileSync(process.execPath, [join(process.cwd(), "hooks/review-context.mjs")], { env: { ...process.env, ...env }, encoding: "utf8" }).trim();
  const on = JSON.parse(run({ GRUMPY_MODE: "gate", GRUMPY_CONFIG_DIR: mkdtempSync(join(tmpdir(), "g-")) }));
  assert.match(on.hookSpecificOutput.additionalContext, /Review mode: gate/);
  assert.match(on.hookSpecificOutput.additionalContext, new RegExp(T("GRUMP:")));
  assert.equal(run({ GRUMPY_MODE: "off" }), "");
});
