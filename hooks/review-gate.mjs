#!/usr/bin/env node
// PreToolUse gate. Reads the host's hook event from stdin, finds the last verdict
// the agent printed, and answers allow or deny in the host's dialect.
//
//   node review-gate.mjs [--host claude|codex|copilot|gemini|kiro]
//
// It never throws: any internal failure means "allow", because a broken reviewer
// must not become a broken editor.

import { resolveMode, readState, writeState, appendScorecard } from "./lib/config.mjs";
import { lastVerdict } from "./lib/verdict.mjs";
import { recentAssistantText } from "./lib/transcript.mjs";
import { normaliseInput, classify, decide, render, bumpDenials, clearDenials, applicableVerdict } from "./lib/gate.mjs";

// Read all of stdin. Hosts close it when the payload is complete; the long timer is only
// a guard against a host that never does, and its result is marked so gate mode can refuse it.
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve({ data, complete: true }));
    process.stdin.on("error", () => resolve({ data, complete: false }));
    setTimeout(() => resolve({ data, complete: false }), 12000).unref();
  });
}

function hostArg() {
  const i = process.argv.indexOf("--host");
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : "claude";
}

function emit(out) {
  if (out.stdout) process.stdout.write(out.stdout + "\n");
  if (out.stderr) process.stderr.write(out.stderr + "\n");
  process.exitCode = out.exitCode;
}

async function main() {
  const host = hostArg();
  const stdin = await readStdin();
  let raw = null;
  try {
    raw = JSON.parse(stdin.data);
  } catch {
    raw = null;
  }
  const { mode } = resolveMode();
  if (raw === null || !stdin.complete) {
    // Unreadable input: nag lets the host decide, gate refuses rather than guess.
    if (mode === "gate" && stdin.data.trim()) {
      return emit(render({ action: "deny", reason: "The reviewer could not read this tool call (truncated or malformed hook input) and gate mode does not guess. Retry the call." }, host));
    }
    return emit({ stdout: "", stderr: "", exitCode: 0 });
  }
  const call = normaliseInput(raw, host);
  const target = classify(call);
  if (!target) return emit({ stdout: "", stderr: "", exitCode: 0 });

  if (mode === "off") return emit({ stdout: "", stderr: "", exitCode: 0 });

  const texts = recentAssistantText(call.transcriptPath);
  const text = texts.sincePrompt;
  const verdict = applicableVerdict({ latest: lastVerdict(texts.latest), earlier: lastVerdict(texts.sincePrompt), target });
  let state = readState(call.sessionId);
  const denials = state.denials?.[target.file] || 0;

  const decision = decide({ mode, verdict, hasTranscript: Boolean(text), denials, target });

  if (decision.action === "deny") state = bumpDenials(state, target.file);
  else state = clearDenials(state, target.file);
  writeState(call.sessionId, state);

  appendScorecard(call.sessionId, {
    host,
    mode,
    tool: call.toolName,
    kind: target.kind,
    file: target.file,
    verdict: verdict ? verdict.verdict : null,
    findings: verdict ? verdict.findings.length : 0,
    decision: decision.action,
    logged: decision.logged || null,
  });

  emit(render(decision, host));
}

main().catch(() => emit({ stdout: "", stderr: "", exitCode: 0 }));
