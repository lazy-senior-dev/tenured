#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Sandeep Bazar
// SPDX-License-Identifier: Apache-2.0
// Try the Grump without installing anything:
//   npx github:lazy-senior-dev/grumpy-reviewer review [--staged] [--agent claude|codex|agy|api] [--model ID]
//   npx github:lazy-senior-dev/grumpy-reviewer pr <number|url> [--agent ...]
//   npx github:lazy-senior-dev/grumpy-reviewer install <host> [--force]   copy the adapter for a host into this repo
//   npx github:lazy-senior-dev/grumpy-reviewer uninstall <host>           remove exactly those files
// Hosts: agents, bob, cursor, windsurf, cline, kiro, qoder, opencode, gemini, copilot, all
// Uses whichever headless agent you already have signed in. Sends the diff to that agent and nothing else.
import { execFileSync } from "node:child_process";
import fs, { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AGENTS, availableAgents } from "../benchmarks/lib/agents.mjs";
import { lastVerdict } from "../hooks/lib/verdict.mjs";
import { withHousePolicy } from "../hooks/lib/config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const P = JSON.parse(readFileSync(join(HERE, "..", "persona.json"), "utf8"));
const CMD = P.command;
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : def; };
const flag = (name) => args.includes(name);

function usage(code = 0) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 8).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(code);
}
if (!cmd || cmd === "help" || cmd === "--help") usage();

// ---- mcp: speak the Model Context Protocol on stdio, for any client that has no adapter here ----
if (cmd === "mcp") {
  await import(join(HERE, "..", "mcp", "server.mjs"));
} else {


// ---- install / uninstall: copy the files a host reads into the current repository ----
const ROOT = join(HERE, "..");
const CMDS = [CMD, `${CMD}-review`, `${CMD}-pr`, `${CMD}-fix`, `${CMD}-scorecard`, `${CMD}-help`];
const HOSTS = {
  agents: { files: ["AGENTS.md"], note: "Read by every AGENTS.md-aware host (Codex, Copilot, Cursor, Kiro, Bob Shell, OpenCode, and more)." },
  bob: { files: [`.bob/rules/${CMD}.md`, `.bob/skills/${P.slug}/SKILL.md`, ...CMDS.map((c) => `.bob/commands/${c}.md`)], dirs: [["hooks", `.bob/hooks/${CMD}`]], settings: ".bob/settings.json", note: "IBM Bob Shell: rules, skill, six commands, and PreToolUse/UserPromptSubmit hooks in .bob/settings.json." },
  cursor: { files: [`.cursor/rules/${CMD}.mdc`], note: "Cursor rule, alwaysApply." },
  windsurf: { files: [`.windsurf/rules/${CMD}.md`], note: "Windsurf / Devin Desktop rule, always_on." },
  cline: { files: [`.clinerules/${CMD}.md`], note: "Cline rule." },
  kiro: { files: [`.kiro/steering/${CMD}.md`], note: "Kiro steering file, inclusion: always." },
  qoder: { files: [`.qoder/rules/${CMD}.md`], note: "Qoder rule." },
  opencode: { files: [`.opencode/plugins/${CMD}.mjs`, ...CMDS.map((c) => `.opencode/command/${c}.md`), "AGENTS.md"], note: "OpenCode plugin (two-phase gate), commands, and AGENTS.md." },
  gemini: { files: ["GEMINI.md"], note: `Gemini CLI context file. For the extension form use: gemini extensions install https://github.com/lazy-senior-dev/${P.slug}` },
  copilot: { files: [".github/copilot-instructions.md"], note: `Copilot custom instructions. For the plugin form use: copilot plugin marketplace add lazy-senior-dev/${P.slug}` },
};
HOSTS.all = { files: [...new Set(Object.values(HOSTS).flatMap((h) => h.files))], dirs: HOSTS.bob.dirs, settings: HOSTS.bob.settings, note: "Every instruction-only adapter at once." };

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const a = join(from, name), b = join(to, name);
    if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

if (cmd === "install" || cmd === "uninstall") {
  const host = args[1];
  if (!host || !HOSTS[host]) {
    console.error(`Which host? One of: ${Object.keys(HOSTS).join(", ")}`);
    process.exit(2);
  }
  const h = HOSTS[host];
  const force = flag("--force");
  const cwd = process.cwd();
  if (cmd === "install") {
    const written = [], skipped = [];
    for (const rel of h.files) {
      const dest = join(cwd, rel);
      if (fs.existsSync(dest) && !force) { skipped.push(rel); continue; }
      fs.mkdirSync(dirname(dest), { recursive: true });
      fs.copyFileSync(join(ROOT, rel), dest);
      written.push(rel);
    }
    for (const [from, to] of h.dirs || []) { copyDir(join(ROOT, from), join(cwd, to)); written.push(to + "/"); }
    if (h.settings) {
      const dest = join(cwd, h.settings);
      const ours = JSON.parse(readFileSync(join(ROOT, h.settings), "utf8"));
      for (const groups of Object.values(ours.hooks)) for (const g of groups) for (const hk of g.hooks) hk.command = hk.command.replace("node hooks/", `node .bob/hooks/${CMD}/`);
      let merged = ours;
      if (fs.existsSync(dest)) {
        try {
          const existing = JSON.parse(readFileSync(dest, "utf8"));
          merged = { ...existing, hooks: { ...(existing.hooks || {}) } };
          for (const [event, groups] of Object.entries(ours.hooks)) merged.hooks[event] = [...(existing.hooks?.[event] || []).filter((g) => !JSON.stringify(g).includes("review-")), ...groups];
        } catch { if (!force) { skipped.push(h.settings + " (could not parse; use --force to replace)"); merged = null; } }
      }
      if (merged) { fs.mkdirSync(dirname(dest), { recursive: true }); fs.writeFileSync(dest, JSON.stringify(merged, null, 2) + "\n"); written.push(h.settings); }
    }
    console.log(`Installed ${P.name} for ${host}. ${h.note}`);
    for (const w of written) console.log("  wrote   " + w);
    for (const sk of skipped) console.log("  kept    " + sk + " (exists; --force to overwrite)");
    console.log(`Start a new session. Remove with: npx github:lazy-senior-dev/${P.slug} uninstall ${host}`);
  } else {
    const removed = [];
    for (const rel of h.files) { const p = join(cwd, rel); if (fs.existsSync(p)) { fs.rmSync(p); removed.push(rel); } }
    for (const [, to] of h.dirs || []) { const p = join(cwd, to); if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true }); removed.push(to + "/"); } }
    if (h.settings && fs.existsSync(join(cwd, h.settings))) {
      try {
        const existing = JSON.parse(readFileSync(join(cwd, h.settings), "utf8"));
        for (const [event, groups] of Object.entries(existing.hooks || {})) existing.hooks[event] = groups.filter((g) => !JSON.stringify(g).includes("review-"));
        fs.writeFileSync(join(cwd, h.settings), JSON.stringify(existing, null, 2) + "\n");
        removed.push(h.settings + " (grumpy hooks removed)");
      } catch { console.log("  could not parse " + h.settings + "; remove the grumpy hooks by hand"); }
    }
    console.log(removed.length ? "Removed:\n  " + removed.join("\n  ") : "Nothing to remove.");
  }
  process.exit(0);
}

function sh(c, a) { return execFileSync(c, a, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }); }

let diff = "";
let label = "";
try {
  if (cmd === "review") {
    diff = flag("--staged") ? sh("git", ["diff", "--cached"]) : sh("git", ["diff"]) + sh("git", ["diff", "--cached"]);
    label = flag("--staged") ? "staged changes" : "working tree";
  } else if (cmd === "pr") {
    const ref = args[1];
    if (!ref) usage(2);
    diff = sh("gh", ["pr", "diff", ref]);
    label = `pull request ${ref}`;
  } else usage(2);
} catch (err) {
  console.error(`Could not read the ${cmd === "pr" ? "pull request (is gh installed and signed in?)" : "diff (is this a git repository?)"}: ${err.message.split("\n")[0]}`);
  process.exit(2);
}
if (!diff.trim()) {
  console.log("Nothing to review.");
  process.exit(0);
}
if (diff.length > 400_000) {
  console.error(`That diff is ${Math.round(diff.length / 1000)} KB. ${P.name} reads everything, but not that; narrow it with --staged or review files in batches.`);
  process.exit(2);
}

const wanted = opt("--agent", null);
const available = await availableAgents();
const agentName = wanted && AGENTS[wanted] ? wanted : available[0];
if (!agentName || (wanted && !available.includes(wanted))) {
  console.error(`No headless agent found${wanted ? ` for --agent ${wanted}` : ""}. Install and sign in to one of: claude, codex, agy, bob (with BOB_API_KEY); or set ANTHROPIC_API_KEY.`);
  process.exit(2);
}
const agent = AGENTS[agentName];
const model = opt("--model", agent.defaultModel);
const system = withHousePolicy(readFileSync(join(HERE, "..", "hooks", "persona.md"), "utf8")) + "\n\nPrint the verdict block and nothing else.";
// Personas that judge a change against what the repository remembers get the log of every touched
// file, plus changelog and postmortem notes, appended as repository history. Others get the diff alone.
function repoHistory() {
  if (!P.context || !P.context.history) return "";
  const files = [...new Set([...diff.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)].map((m) => m[1]).filter((f) => f !== "/dev/null"))];
  const parts = [];
  for (const f of files) {
    try {
      const log = sh("git", ["log", "--oneline", "-n", "12", "--", f]).trim();
      if (log) parts.push(`$ git log --oneline -- ${f}\n${log}`);
    } catch { /* not tracked yet */ }
  }
  const notes = [];
  for (const dir of ["docs/postmortems", "docs/incidents", "postmortems"]) {
    if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir).filter((n) => /\.md$/.test(n)).sort().slice(0, 8)) notes.push({ path: `${dir}/${n}`, text: readFileSync(`${dir}/${n}`, "utf8") });
  }
  for (const ch of ["CHANGELOG.md", "docs/CHANGELOG.md"]) if (fs.existsSync(ch)) notes.push({ path: ch, text: readFileSync(ch, "utf8").split("\n").slice(0, 60).join("\n") });
  for (const n of notes) parts.push(`${n.path} (excerpt):\n${n.text.trim().slice(0, 1500)}`);
  return parts.length ? `\n\nRepository history (what the reviewer can see):\n\n${parts.join("\n\n")}` : "";
}
const user = `Review this change as ${P.asName || P.name}. It is the ${label}.${repoHistory()}\n\n${diff}\n\nEverything the review needs is above: the complete change${P.context && P.context.history ? " and what the repository records" : ""}. Do not search or open files; answer from what is here.`;

process.stderr.write(`Reading the ${label} (${diff.split("\n").length} lines) with ${agent.label}${model ? ` (${model})` : ""}. ${P.name} does not skim; give it a moment.\n`);
const started = Date.now();
let res;
try {
  res = await agent.run({ system, user, model });
} catch (err) {
  console.error(`The agent failed: ${err.message}`);
  process.exit(1);
}
const verdict = lastVerdict(res.text);
// Some hosts narrate the whole checklist before the verdict, or wrap it in a code fence. Print from the
// last verdict header onward, without fences, so the terminal shows the block the rules ask for.
const printable = (() => {
  const lines = res.text.trim().split("\n").filter((l) => !/^\s*```/.test(l));
  const head = new RegExp(`^\\s*\\*{0,2}${P.verdictPrefix}:`);
  let start = -1;
  lines.forEach((l, i) => { if (head.test(l)) start = i; });
  return (start >= 0 ? lines.slice(start) : lines).join("\n").trim();
})();
console.log(printable);
const tokens = res.usage.input || res.usage.output ? ` · ${res.usage.input} in / ${res.usage.output} out tokens` : "";
process.stderr.write(`\n${Math.round((Date.now() - started) / 1000)} s${tokens}${res.costUsd != null ? ` · $${res.costUsd.toFixed(4)}` : ""}\n`);
process.exit(verdict && verdict.verdict !== "APPROVE" ? 1 : 0);
}
