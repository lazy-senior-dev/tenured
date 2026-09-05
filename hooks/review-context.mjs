#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Sandeep Bazar
// SPDX-License-Identifier: Apache-2.0
// UserPromptSubmit (Claude Code, Codex), sessionStart (Copilot CLI), BeforeAgent (Gemini CLI).
// Injects the reviewer card plus the current mode. Prints nothing when the mode is off.
//
//   node review-context.mjs [--host claude|codex|copilot|gemini]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveMode, withHousePolicy } from "./lib/config.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function hostArg() {
  const i = process.argv.indexOf("--host");
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : "claude";
}

function persona() {
  try {
    return readFileSync(join(here, "persona.md"), "utf8").trim();
  } catch {
    return "";
  }
}

function main() {
  const host = hostArg();
  const { mode, source } = resolveMode();
  const card = withHousePolicy(persona());
  if (mode === "off" || !card) return;
  const gate = mode === "gate" ? "writes are denied until the verdict is APPROVE" : "writes proceed after the verdict; a BLOCK still stops them";
  const context = `${card}\n\nReview mode: ${mode} (${source}); ${gate}.`;
  let out;
  switch (host) {
    case "copilot":
      out = { additionalContext: context };
      break;
    case "gemini":
      out = { hookSpecificOutput: { hookEventName: "BeforeAgent", additionalContext: context } };
      break;
    case "bob":
      process.stdout.write(context + "\n");
      return;
    default:
      out = { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } };
  }
  process.stdout.write(JSON.stringify(out) + "\n");
}

try {
  main();
} catch {
  // stay silent: a failed injection must not block the prompt
}
