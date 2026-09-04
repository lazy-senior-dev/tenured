// The gate's decision logic, kept pure so it can be tested without a host.

import { severityRank } from "./verdict.mjs";
import { persona } from "./persona.mjs";

function words() {
  const p = persona();
  return { P: p.verdictPrefix, A: p.verdicts.approve, C: p.verdicts.changes, B: p.verdicts.block, who: p.short, scope: new RegExp(p.scope || ".*", "i") };
}

const WRITE_TOOLS = /^(edit|write|multiedit|notebookedit|apply_patch|write_file|write_to_file|apply_diff|multi_apply_diff|insert_content|search_and_replace|replace|create|create_file|edit_file|str_replace_editor|str_replace_based_edit_tool)$/i;
const SHELL_TOOLS = /^(bash|shell|run_shell_command|execute_command|run_command|powershell|terminal|exec_command)$/i;
const COMMIT = /\bgit\s+(?:-{1,2}[\w-]+(?:[= ]\S+)?\s+)*(commit|push|merge|rebase|cherry-pick)\b/;
const MAX_GATE_DENIALS = 2;

// Normalise the different stdin shapes hosts send into one record.
export function normaliseInput(raw, host = "claude") {
  const input = raw && typeof raw === "object" ? raw : {};
  const toolName = input.tool_name ?? input.toolName ?? input.tool ?? "";
  const toolInput = input.tool_input ?? input.toolArgs ?? input.args ?? input.input ?? {};
  return {
    host,
    toolName: String(toolName),
    toolInput: toolInput && typeof toolInput === "object" ? toolInput : {},
    sessionId: input.session_id ?? input.sessionId ?? input.sessionID ?? "unknown",
    transcriptPath: input.transcript_path ?? input.transcriptPath ?? null,
    cwd: input.cwd ?? process.cwd(),
  };
}

function firstPatchPath(patch) {
  const m = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(String(patch || ""));
  return m ? m[1].trim() : null;
}

// What is this tool call about to touch? null when the call is not a write.
export function classify(call) {
  const { toolName, toolInput } = call;
  if (WRITE_TOOLS.test(toolName)) {
    const file =
      toolInput.file_path ?? toolInput.path ?? toolInput.filePath ?? toolInput.notebook_path ?? toolInput.filename ??
      (typeof toolInput.patch === "string" ? firstPatchPath(toolInput.patch) : null) ??
      (typeof toolInput.input === "string" ? firstPatchPath(toolInput.input) : null) ??
      (Array.isArray(toolInput.edits) && toolInput.edits[0]?.file_path) ??
      "(unknown file)";
    return { kind: "write", file: String(file) };
  }
  if (SHELL_TOOLS.test(toolName)) {
    const command = String(toolInput.command ?? toolInput.cmd ?? toolInput.script ?? "");
    const m = COMMIT.exec(command);
    if (m) return { kind: "commit", file: `(git ${m[1]})`, command };
  }
  return null;
}

// The verdict that applies to this write. `latest` is the most recently completed
// assistant text (the previous message); `earlier` is the last verdict anywhere in the
// turn. A verdict that names files covers only those files: "GRUMP: APPROVE — a.py" never
// authorises an unreviewed write to b.py. A verdict that names nothing covers the write.
export function applicableVerdict({ latest, earlier, target }) {
  const base = target ? String(target.file).split(/[\\/]/).pop() : "";
  const namesFiles = (v) => v.findings.some((f) => f.file) || /[\w.-]+\.[A-Za-z0-9]+|\//.test(v.reason || "");
  const namesThis = (v) => v.override || v.findings.some((f) => f.file && f.file.split(/[\\/]/).pop() === base) || (v.reason || "").includes(base);
  if (latest) {
    if (namesFiles(latest) && !namesThis(latest) && base && !base.startsWith("(")) return null;
    return latest;
  }
  if (!earlier || !target) return null;
  return namesThis(earlier) ? earlier : null;
}

// Decide what the gate does. `state` is the per-session record for this file.
export function decide({ mode, verdict, hasTranscript, denials = 0, target }) {
  const where = target?.kind === "commit" ? target.file : `write to ${target?.file ?? "file"}`;
  const { P, A, C, B, who, scope } = words();
  if (mode === "off") return { action: "skip", reason: "mode off" };
  if (target && target.kind === "write" && !scope.test(String(target.file))) return { action: "skip", reason: "outside this persona's scope" };

  if (verdict?.override) {
    return { action: "allow", logged: "override", reason: `override: ${verdict.reason || "no reason given"}` };
  }

  if (verdict && severityRank(verdict.verdict) >= 0) {
    const open = verdict.findings.length + verdict.malformed.length;
    if (verdict.verdict === "BLOCK") {
      return {
        action: "deny",
        logged: "block",
        reason: `${P}: ${B} stands on the ${where}. ${open} finding(s) open. Fix them and print a new verdict. A ${B} is never downgraded by mode; if the user has explicitly told you to proceed, print ${P}: OVERRIDE — quoting them — and retry.`,
      };
    }
    if (verdict.verdict === "REQUEST_CHANGES") {
      if (mode === "gate") {
        return {
          action: "deny",
          logged: "request_changes",
          reason: `${P}: ${C} stands on the ${where} with ${open} finding(s). Gate mode: fix them, print a new verdict, then retry.`,
        };
      }
      return {
        action: "allow",
        logged: "request_changes",
        context: `${who} left ${open} finding(s) open on this ${where}. Nag mode lets it through. Fix them before you finish the task.`,
      };
    }
    return { action: "allow", logged: "approve" };
  }

  // No verdict found.
  if (mode === "gate") {
    if (denials >= MAX_GATE_DENIALS) {
      return {
        action: "allow",
        logged: "gate_fallback",
        context: `The gate could not find a verdict for this ${where} after ${denials} attempts and is letting it through. Print the ${P}: block in your reply, not inside a tool call.`,
      };
    }
    return {
      action: "deny",
      logged: "no_verdict",
      reason: `No verdict found for this ${where}. If you have not reviewed it yet: answer the ten checklist questions in writing and print the ${P}: block (${A}, ${C}, or ${B} with numbered file:line — failure — smallest fix lines; name the files an ${A} covers on the ${P} line). If you printed the verdict in this same message, the gate reads completed messages: just retry the ${target?.kind === "commit" ? "command" : "write"} now.`,
    };
  }
  return {
    action: "allow",
    logged: "no_verdict",
    context: `No verdict printed before this ${where}. Nag mode lets it through. Before the next write, answer the checklist and print the ${P}: block.`,
  };
}

export function bumpDenials(state, file) {
  const next = { ...state, denials: { ...(state.denials || {}) } };
  next.denials[file] = (next.denials[file] || 0) + 1;
  return next;
}

export function clearDenials(state, file) {
  if (!state.denials || !state.denials[file]) return state;
  const next = { ...state, denials: { ...state.denials } };
  delete next.denials[file];
  return next;
}

// Render a decision in the JSON dialect each host expects.
export function render(decision, host, eventName = "PreToolUse") {
  if (decision.action === "skip") return { stdout: "", stderr: "", exitCode: 0 };
  const deny = decision.action === "deny";
  switch (host) {
    case "copilot":
      return deny
        ? { stdout: JSON.stringify({ permissionDecision: "deny", permissionDecisionReason: decision.reason }), stderr: "", exitCode: 0 }
        : { stdout: "", stderr: "", exitCode: 0 };
    case "gemini":
      return deny
        ? { stdout: JSON.stringify({ decision: "deny", reason: decision.reason }), stderr: "", exitCode: 0 }
        : { stdout: decision.context ? JSON.stringify({ hookSpecificOutput: { hookEventName: "BeforeTool", additionalContext: decision.context } }) : "", stderr: "", exitCode: 0 };
    case "kiro":
      return deny
        ? { stdout: "", stderr: decision.reason, exitCode: 2 }
        : { stdout: decision.context || "", stderr: "", exitCode: 0 };
    case "bob":
      // Bob Shell: exit 2 blocks the tool; stdout of a PreToolUse hook is not fed to the model.
      return deny ? { stdout: "", stderr: decision.reason, exitCode: 2 } : { stdout: "", stderr: "", exitCode: 0 };
    case "claude":
    case "codex":
    default: {
      const out = { hookEventName: eventName };
      if (deny) {
        out.permissionDecision = "deny";
        out.permissionDecisionReason = decision.reason;
      } else if (decision.context) {
        out.additionalContext = decision.context;
      } else {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: JSON.stringify({ hookSpecificOutput: out }), stderr: "", exitCode: 0 };
    }
  }
}
