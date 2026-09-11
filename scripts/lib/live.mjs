// SPDX-FileCopyrightText: 2026 Sandeep Bazar
// SPDX-License-Identifier: Apache-2.0
// Reads a host's hook-event stream and reports what the host decided. Kept apart from the runner
// so it can be tested against a recorded stream: a parser that quietly stops recognising denials
// would make the live check pass while the gate is dead, which is the exact failure it exists to
// catch.

// The host emits one system/hook_response per hook invocation. `output` is the hook's stdout, so a
// deny arrives as JSON nested inside a JSON string.
export function readDecisions(stream, { personaName = "Grump" } = {}) {
  const denials = [];
  let hookCalls = 0;
  let personaInjected = false;
  for (const line of String(stream).split("\n")) {
    if (!line.startsWith("{")) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.subtype !== "hook_response") continue;
    hookCalls++;
    const body = typeof e.output === "string" ? e.output : JSON.stringify(e.output ?? "");
    // "You are also the Grump" and "You are also Tenured" are both real headings, so the article is
    // optional. Matching only the first form reports the persona as never injected in a repository
    // where it was injected every time.
    if (e.hook_event === "UserPromptSubmit" && new RegExp(`You are also (?:the )?${personaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(body)) personaInjected = true;
    if (e.hook_event !== "PreToolUse") continue;
    let o;
    try { o = JSON.parse(body); } catch { continue; }
    const h = o.hookSpecificOutput;
    if (h && h.permissionDecision === "deny") {
      denials.push({ tool: String(e.hook_name || "").split(":")[1] || "", reason: h.permissionDecisionReason || "" });
    }
  }
  return { denials, hookCalls, personaInjected };
}
