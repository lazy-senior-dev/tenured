// Renders rules/grump.md into every host's format. Pure: returns a Map of
// repo-relative path -> file content. build-adapters.mjs writes the map,
// check-adapters.mjs diffs it against the working tree.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const P = JSON.parse(readFileSync(join(ROOT, "persona.json"), "utf8"));
const CMD = P.command;
const V = P.verdicts;
const VERDICT_LIST = `${V.approve} | ${V.changes} | ${V.block}`;
const REPO = `lazy-senior-dev/${P.slug}`;
const HOMEPAGE = P.homepage || `https://lazy-senior-dev.github.io/${P.slug}`;
const REPO_URL = `https://github.com/${REPO}`;
const AUTHOR = { name: "Sandeep Bazar", url: "https://github.com/sandeepbazar" };
const GENERATED = `Rendered from ${P.rules} by scripts/build-adapters.mjs. Edit the rules, then run npm run build.`;

export function pkg() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
}

const json = (obj) => JSON.stringify(obj, null, 2) + "\n";

// ---------- text building blocks ----------

function checklistMd(rs) {
  return rs.checklist.map((c) => `${c.n}. **${c.title}.** ${c.text}`).join("\n");
}

function sectionsMd(rs, names) {
  return names
    .filter((n) => rs.sections[n])
    .map((n) => `## ${n}\n\n${n === "The checklist" ? checklistIntro(rs) + checklistMd(rs) : rs.sections[n]}`)
    .join("\n\n");
}

function checklistIntro(rs) {
  const body = rs.sections["The checklist"];
  const firstItem = body.indexOf("\n1. ");
  return firstItem > 0 ? body.slice(0, firstItem).trim() + "\n\n" : "";
}

// The full ruleset as an instruction file. `commands` false swaps the slash-command
// table for plain-language equivalents, for hosts that have no commands.
export function instructionBody(rs, { commands = true, heading = `# ${P.name}` } = {}) {
  const parts = [
    heading,
    `> ${rs.description}`,
    `*${rs.catchphrase}*`,
    sectionsMd(rs, ["Character", "The checklist", "The verdict", "Non-negotiables", "Modes", "Self-review protocol"]),
  ];
  if (commands) parts.push(`## Commands\n\n${rs.sections["Commands"]}`);
  else parts.push(`## Asking for a review\n\n${plainCommands(rs)}`);
  return parts.join("\n\n") + "\n";
}

function plainCommands(rs) {
  return [
    `This host has no slash commands, so ask in plain words. ${P.name} answers the same way.`,
    "",
    `- "Review ${P.reviews} as ${P.asName}" does what \`/${CMD}-review\` does: the working-tree diff, a numbered request-changes list, no code.`,
    `- "Review PR 123 as ${P.asName}" does what \`/${CMD}-pr\` does.`,
    `- "Apply ${P.possessive} findings" does what \`/${CMD}-fix\` does: one minimal edit per finding, then a fresh review.`,
    `- "${P.short} mode gate" or "${P.short} mode off" sets the mode for this conversation; the persistent setting is \`mode\` in \`~/.config/grumpy-reviewer/config.json\` or the \`GRUMPY_MODE\` environment variable.`,
  ].join("\n");
}

// The compact card injected on every turn by the hooks. No modes (appended at
// runtime) and no commands (the host lists them).
export function personaCard(rs) {
  return [
    `# You are also ${P.asName}`,
    `> ${rs.description}`,
    sectionsMd(rs, ["Character", "Self-review protocol", "The checklist", "The verdict", "Non-negotiables"]),
  ].join("\n\n") + "\n";
}

// ---------- skills (Claude Code, Codex, Copilot, OpenClaw) ----------

function frontmatter(obj) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) lines.push(`${k}:`, ...v.map((x) => `  - ${x}`));
    else if (typeof v === "string" && /[:#"']/.test(v)) lines.push(`${k}: ${JSON.stringify(v)}`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push("---");
  return lines.join("\n");
}

const HOOKS_REL = "${CLAUDE_SKILL_DIR}/../../hooks";

export function skills(rs) {
  const commands = Object.fromEntries(rs.commands.map((c) => [c.name, c]));
  const helpTable = rs.sections["Commands"];
  const noCode = "You are reviewing, not writing. Do not edit, create, or delete any file while this skill runs.";
  const protocol = [
    "Read the whole diff before you write a word. If it is empty, say `Nothing to review.` and stop. If it is truncated, say so and do not approve.",
    `Answer the ten checklist questions in writing, in order, one line each. A \`${V.block}\` finding decides the verdict; finish the list anyway.`,
    `Print the verdict block: \`${P.verdictPrefix}: ${VERDICT_LIST}\`, then numbered \`file:line — what fails in production — smallest fix\` lines. \`${V.approve}\` names the files it covers and is followed by \`${P.approveWord}\` and nothing else.`,
  ];

  const c = (suffix) => commands[suffix ? `${CMD}-${suffix}` : CMD];
  const set = {
    [CMD]: {
      fm: {
        name: CMD,
        description: c("").text + ` Use when the user says ${CMD}, ${P.short.toLowerCase()} mode, nag, gate, or turn ${P.asName} off.`,
        "argument-hint": "[nag|gate|off]",
        "disable-model-invocation": true,
        "allowed-tools": "Bash(node *)",
      },
      body: [
        `!\`node "${HOOKS_REL}/review-mode.mjs" $ARGUMENTS\``,
        "",
        "Repeat the line above to the user exactly as printed. Do nothing else.",
        "",
        "Modes, for reference:",
        "",
        rs.modes.map((m) => `- \`${m.name}\`${m.note ? ` (${m.note})` : ""}: ${m.text}`).join("\n"),
      ].join("\n"),
    },
    [`${CMD}-review`]: {
      fm: {
        name: `${CMD}-review`,
        description: c("review").text + " Use when the user asks for a review of their changes, the diff, or what is about to be committed.",
        "allowed-tools": "Bash(git diff *), Bash(git status *), Bash(git log *), Read, Grep, Glob",
      },
      body: [
        "Working tree status:",
        "",
        "!`git status --short`",
        "",
        "Unstaged changes:",
        "",
        "!`git diff`",
        "",
        "Staged changes:",
        "",
        "!`git diff --cached`",
        "",
        `Review the changes above as ${P.asName}.`,
        "",
        ...protocol.map((p, i) => `${i + 1}. ${p}`),
        `4. ${noCode} If the user wants the findings applied, they run \`/${CMD}-fix\`.`,
      ].join("\n"),
    },
    [`${CMD}-pr`]: {
      fm: {
        name: `${CMD}-pr`,
        description: c("pr").text + " Use when the user gives a pull request number or URL to review.",
        "argument-hint": "<number|url>",
        "allowed-tools": "Bash(gh pr diff *), Bash(gh pr view *), Read, Grep, Glob",
      },
      body: [
        "Pull request:",
        "",
        "!`gh pr view $ARGUMENTS`",
        "",
        "Diff:",
        "",
        "!`gh pr diff $ARGUMENTS`",
        "",
        `Review the pull request above as ${P.asName}. If the \`gh\` output is an error, report it in one line and stop.`,
        "",
        ...protocol.map((p, i) => `${i + 1}. ${p}`),
        `4. ${noCode} Do not post anything to the pull request; print the verdict here.`,
      ].join("\n"),
    },
    [`${CMD}-fix`]: {
      fm: {
        name: `${CMD}-fix`,
        description: c("fix").text + ` Use only when the user asks to apply, fix, or address ${P.possessive} findings.`,
        "disable-model-invocation": true,
        "allowed-tools": "Read, Edit, Write, Grep, Glob, Bash(git diff *)",
      },
      body: [
        `This is the one command where ${P.possessive} findings are turned into edits.`,
        "",
        `1. Find the most recent \`${P.verdictPrefix}:\` verdict block in this conversation. If there is none, run the \`/${CMD}-review\` procedure first and print the verdict.`,
        "2. For each numbered finding, in order: open the file, make the smallest edit that resolves exactly that finding, and nothing else. One edit per finding. No renames, no reformatting, no drive-by improvements.",
        "3. If a finding cannot be resolved without a decision from the user (a schema change, a product question), skip it and say why in one line.",
        `4. Review the result again as ${P.asName}: answer the checklist, print a fresh verdict block. Repeat once at most; if findings remain after the second pass, stop and list them.`,
      ].join("\n"),
    },
    [`${CMD}-scorecard`]: {
      fm: {
        name: `${CMD}-scorecard`,
        description: c("scorecard").text + ` Use when the user asks what ${P.asName} caught, blocked, or let through.`,
        "disable-model-invocation": true,
        "allowed-tools": "Bash(node *)",
      },
      body: [
        `!\`node "${HOOKS_REL}/review-scorecard.mjs" \${CLAUDE_SESSION_ID}\``,
        "",
        "Show the tables above to the user unchanged. Below them, add one line naming the number of overrides and what they were for, or `No overrides.`",
      ].join("\n"),
    },
    [`${CMD}-help`]: {
      fm: {
        name: `${CMD}-help`,
        description: c("help").text + ` Use when the user asks how ${P.asName} works or which commands exist.`,
        "disable-model-invocation": true,
      },
      body: [
        `${rs.description}`,
        "",
        helpTable,
        "",
        "Modes:",
        "",
        rs.modes.map((m) => `- \`${m.name}\`${m.note ? ` (${m.note})` : ""}: ${m.text}`).join("\n"),
        "",
        `Docs: ${HOMEPAGE}`,
      ].join("\n"),
    },
  };

  const out = new Map();
  for (const [name, s] of Object.entries(set)) {
    out.set(`skills/${name}/SKILL.md`, `${frontmatter(s.fm)}\n\n${s.body}\n`);
  }
  return out;
}

// ---------- hooks ----------

function hookCommand(script, host) {
  const hostArg = host ? ` --host ${host}` : "";
  return `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${script}"${hostArg} 2>/dev/null || true`;
}

export function claudeHooks() {
  return {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [{ type: "command", command: hookCommand("review-context.mjs"), timeout: 10 }],
        },
      ],
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash|apply_patch|shell",
          hooks: [{ type: "command", command: hookCommand("review-gate.mjs"), timeout: 15 }],
        },
      ],
    },
  };
}

export function copilotHooks() {
  const cmd = (script) => `node hooks/${script} --host copilot 2>/dev/null || true`;
  const ps = (script) => `node hooks/${script} --host copilot`;
  return {
    version: 1,
    hooks: {
      sessionStart: [{ type: "command", bash: cmd("review-context.mjs"), powershell: ps("review-context.mjs"), timeoutSec: 10 }],
      preToolUse: [{ type: "command", bash: cmd("review-gate.mjs"), powershell: ps("review-gate.mjs"), timeoutSec: 15 }],
    },
  };
}

export function geminiHooksExample() {
  const cmd = (script) => `node "$HOME/.${P.slug}/hooks/${script}" --host gemini 2>/dev/null || true`;
  return {
    hooks: {
      BeforeAgent: [{ hooks: [{ name: `${CMD}-context`, type: "command", command: cmd("review-context.mjs"), timeout: 10 }] }],
      BeforeTool: [{ matcher: "write_file|replace|edit|run_shell_command", hooks: [{ name: `${CMD}-gate`, type: "command", command: cmd("review-gate.mjs"), timeout: 15 }] }],
    },
  };
}

export function copilotRepoHooksExample() {
  const cmd = (script) => `node "$HOME/.${P.slug}/hooks/${script}" --host copilot 2>/dev/null || true`;
  return {
    version: 1,
    hooks: {
      sessionStart: [{ type: "command", bash: cmd("review-context.mjs"), timeoutSec: 10 }],
      preToolUse: [{ type: "command", bash: cmd("review-gate.mjs"), timeoutSec: 15 }],
    },
  };
}

// ---------- manifests ----------

export function claudePlugin(rs, p) {
  return {
    name: P.slug,
    displayName: P.displayName,
    version: p.version,
    description: p.description,
    author: AUTHOR,
    homepage: HOMEPAGE,
    repository: REPO_URL,
    license: "Apache-2.0",
    keywords: p.keywords,
    skills: "./skills",
    hooks: "./hooks/hooks.json",
  };
}

export function claudeMarketplace(rs, p) {
  return {
    name: "lazy-senior-dev",
    owner: { name: "sandeepbazar", url: "https://github.com/lazy-senior-dev" },
    metadata: {
      description: "Senior engineers your AI agent can be. One persona per plugin.",
      version: p.version,
    },
    plugins: [
      {
        name: P.slug,
        displayName: P.displayName,
        description: p.description,
        version: p.version,
        source: "./",
        category: "productivity",
        tags: ["code-review", "quality", "security", "hooks"],
      },
      ...(P.marketplace || []).map((m) => ({ name: m.name, displayName: m.displayName, description: m.description, source: { source: "github", repo: `lazy-senior-dev/${m.name}` }, category: "productivity", tags: m.tags || [] })),
    ],
  };
}

export function codexPlugin(rs, p) {
  return {
    name: P.slug,
    version: p.version,
    description: p.description,
    author: AUTHOR,
    homepage: HOMEPAGE,
    repository: REPO_URL,
    license: "Apache-2.0",
    keywords: p.keywords,
    skills: "./skills",
    hooks: "./hooks/hooks.json",
    interface: {
      displayName: P.displayName,
      shortDescription: P.shortDescription || `${P.name}, inside your agent.`,
      longDescription: `${rs.description} Every write and commit is reviewed against a ten-question checklist and given a verdict: ${V.approve}, ${V.changes}, or ${V.block}.`,
      developerName: "lazy-senior-dev",
      category: "Productivity",
      capabilities: ["Code review", "Security review", "Pre-commit gate"],
      websiteURL: HOMEPAGE,
      defaultPrompt: [`Review ${P.reviews} as ${P.asName}`, `${P.short} mode gate`],
      brandColor: "#1f1f1f",
    },
  };
}

export function codexMarketplace() {
  return {
    name: "lazy-senior-dev",
    interface: { displayName: "lazy-senior-dev" },
    plugins: [
      {
        name: P.slug,
        source: { source: "local", path: "./" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  };
}

export function copilotPlugin(rs, p) {
  return {
    name: P.slug,
    version: p.version,
    description: p.description,
    author: AUTHOR,
    homepage: HOMEPAGE,
    repository: REPO_URL,
    license: "Apache-2.0",
    keywords: p.keywords,
    skills: "./skills",
    hooks: "./hooks/copilot-hooks.json",
  };
}

export function copilotMarketplace(rs, p) {
  return {
    name: "lazy-senior-dev",
    owner: { name: "sandeepbazar", email: "5602033+sandeepbazar@users.noreply.github.com" },
    metadata: { description: "Senior engineers your AI agent can be. One persona per plugin.", version: p.version },
    plugins: [{ name: P.slug, description: p.description, version: p.version, source: "./" }],
  };
}

export function geminiExtension(rs, p) {
  return { name: P.slug, version: p.version, description: p.description, contextFileName: "GEMINI.md" };
}

export function devinPlugin(rs, p) {
  return {
    name: P.slug,
    version: p.version,
    description: p.description,
    author: AUTHOR,
    homepage: HOMEPAGE,
    repository: REPO_URL,
    license: "Apache-2.0",
    keywords: p.keywords,
    skills: "./skills",
  };
}

export function qoderPlugin(rs, p) {
  return {
    name: P.slug,
    version: p.version,
    description: p.description,
    author: AUTHOR,
    homepage: HOMEPAGE,
    repository: REPO_URL,
    license: "Apache-2.0",
    keywords: p.keywords,
    skills: "./skills",
    rules: "./.qoder/rules",
  };
}

// ---------- Gemini commands (TOML) ----------

function toml(str) {
  return '"""\n' + str.replace(/\\/g, "\\\\") + '\n"""';
}

export function geminiCommands(rs) {
  const out = new Map();
  const review = [
    `Review the working-tree changes as ${P.asName}.`,
    "",
    "Status:",
    "!{git status --short}",
    "",
    "Unstaged:",
    "!{git diff}",
    "",
    "Staged:",
    "!{git diff --cached}",
    "",
    `Read the whole diff. Answer the ten checklist questions in writing, in order. Print the verdict block: ${P.verdictPrefix}: ${VERDICT_LIST}, then numbered file:line — what fails in production — smallest fix lines. Do not edit any file.`,
  ].join("\n");
  const pr = [
    `Review pull request {{args}} as ${P.asName}.`,
    "",
    "!{gh pr view {{args}}}",
    "",
    "!{gh pr diff {{args}}}",
    "",
    "Read the whole diff. Answer the ten checklist questions in writing, in order. Print the verdict block. Do not edit any file and do not post to the pull request.",
  ].join("\n");
  const fix = [
    `Apply the findings from the most recent ${P.verdictPrefix}: verdict in this conversation. One minimal edit per finding, nothing else. Then review the result again as ${P.asName} and print a fresh verdict. If there is no verdict yet, review the working tree first.`,
  ].join("\n");
  const mode = [
    `Set ${P.possessive} mode to {{args}} for this conversation (nag, gate, or off) and confirm it in one line. If {{args}} is empty, report the current mode. The persistent setting lives in ~/.config/grumpy-reviewer/config.json under \`mode\`; tell the user that in one sentence.`,
  ].join("\n");
  const help = `Print this table and nothing else:\n\n${rs.sections["Commands"].replace(/\\\|/g, "|")}`;
  const scorecard =
    `List every ${P.verdictPrefix}: verdict you printed in this conversation as a markdown table with columns Target, Verdict, Findings. Add a final line with the number of overrides.`;
  const ct = (n) => rs.commands.find((c) => c.name === n).text;
  const entries = {
    [`${CMD}-review`]: [ct(`${CMD}-review`), review],
    [`${CMD}-pr`]: [ct(`${CMD}-pr`), pr],
    [`${CMD}-fix`]: [ct(`${CMD}-fix`), fix],
    [CMD]: [ct(CMD), mode],
    [`${CMD}-scorecard`]: [ct(`${CMD}-scorecard`), scorecard],
    [`${CMD}-help`]: [ct(`${CMD}-help`), help],
  };
  for (const [name, [description, prompt]] of Object.entries(entries)) {
    out.set(`commands/${name}.toml`, `# ${GENERATED}\ndescription = ${JSON.stringify(description.replace(/\\\|/g, "|"))}\nprompt = ${toml(prompt)}\n`);
  }
  return out;
}

// ---------- OpenCode ----------

export function opencodePlugin(rs) {
  const card = JSON.stringify(personaCard(rs));
  return `// ${P.slug} plugin for OpenCode. ${GENERATED}
// Copy this file to .opencode/plugins/${CMD}.mjs (project) or ~/.config/opencode/plugins/ (global).
// It injects ${P.asName} on every turn and, in gate mode, stops the first write to each
// file until a verdict has been printed. Mode: GRUMPY_MODE, then ~/.config/grumpy-reviewer/config.json.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CARD = ${card};
const WRITE_TOOLS = /^(edit|write|multiedit|patch|apply_patch|write_file)$/i;
const SHELL_TOOLS = /^(bash|shell)$/i;
const COMMIT = /\\bgit\\s+(?:-{1,2}[\\w-]+(?:[= ]\\S+)?\\s+)*(commit|push|merge|rebase|cherry-pick)\\b/;
const MODES = ["nag", "gate", "off"];

function mode() {
  const env = (process.env.GRUMPY_MODE || "").toLowerCase();
  if (MODES.includes(env)) return env;
  try {
    const dir = process.env.GRUMPY_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "grumpy-reviewer");
    const cfg = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    if (MODES.includes(String(cfg.mode).toLowerCase())) return String(cfg.mode).toLowerCase();
  } catch {}
  return "nag";
}

export const ${P.displayName.replace(/[^A-Za-z0-9]/g, "")} = async () => {
  const stopped = new Map(); // sessionID -> Set of files already stopped once
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const m = mode();
      if (m === "off") return;
      const gate = m === "gate" ? "the first write to each file is refused until a verdict is printed" : "writes proceed after the verdict";
      output.system.push(CARD + "\\n\\nReview mode: " + m + "; " + gate + ".");
    },
    "tool.execute.before": async (input, output) => {
      if (mode() !== "gate") return;
      let file = null;
      if (WRITE_TOOLS.test(input.tool)) file = output.args?.filePath ?? output.args?.file_path ?? output.args?.path ?? "(unknown file)";
      else if (SHELL_TOOLS.test(input.tool) && COMMIT.test(String(output.args?.command ?? ""))) file = "(git commit)";
      if (!file) return;
      const seen = stopped.get(input.sessionID) ?? new Set();
      stopped.set(input.sessionID, seen);
      if (seen.has(file)) return;
      seen.add(file);
      throw new Error(
        "${P.name} stopped this write to " + file + ". Review your own change first: answer the ten checklist questions in writing, print the ${P.verdictPrefix}: verdict block (${VERDICT_LIST} with numbered file:line — failure — smallest fix lines), fix any findings, then retry. The retry for this file will go through."
      );
    },
  };
};
`;
}

export function opencodeCommands(rs) {
  const out = new Map();
  const mk = (name, description, body) => out.set(`.opencode/command/${name}.md`, `---\ndescription: ${JSON.stringify(description.replace(/\\\|/g, "|"))}\n---\n\n${body}\n`);
  const ct = (n) => rs.commands.find((c) => c.name === n).text;
  mk(`${CMD}-review`, ct(`${CMD}-review`), [
    `Review the working-tree changes as ${P.asName}.`,
    "",
    "Status: !`git status --short`",
    "Unstaged: !`git diff`",
    "Staged: !`git diff --cached`",
    "",
    `Read the whole diff. Answer the ten checklist questions in writing, in order. Print the verdict block (${P.verdictPrefix}: ${VERDICT_LIST}, then numbered file:line — what fails in production — smallest fix). Do not edit any file.`,
  ].join("\n"));
  mk(`${CMD}-pr`, ct(`${CMD}-pr`), [
    `Review pull request $ARGUMENTS as ${P.asName}.`,
    "",
    "!`gh pr view $ARGUMENTS`",
    "!`gh pr diff $ARGUMENTS`",
    "",
    "Read the whole diff. Answer the checklist in writing. Print the verdict block. Do not edit any file and do not post to the pull request.",
  ].join("\n"));
  mk(`${CMD}-fix`, ct(`${CMD}-fix`),
    `Apply the findings from the most recent ${P.verdictPrefix}: verdict in this conversation: one minimal edit per finding, nothing else. Then review the result again as ${P.asName} and print a fresh verdict. If there is no verdict yet, review the working tree first.`);
  mk(CMD, ct(CMD),
    `Set ${P.possessive} mode to $ARGUMENTS for this conversation (nag, gate, or off) and confirm in one line. If no mode was given, report the current one. The persistent setting is \`mode\` in ~/.config/grumpy-reviewer/config.json, or the GRUMPY_MODE environment variable.`);
  mk(`${CMD}-scorecard`, ct(`${CMD}-scorecard`),
    `List every ${P.verdictPrefix}: verdict you printed in this conversation as a markdown table with columns Target, Verdict, Findings. Add a final line with the number of overrides.`);
  mk(`${CMD}-help`, ct(`${CMD}-help`), `Print this table and nothing else:\n\n${rs.sections["Commands"].replace(/\\\|/g, "|")}`);
  return out;
}

export function opencodeConfig() {
  return {
    $schema: "https://opencode.ai/config.json",
    instructions: ["AGENTS.md"],
  };
}

// ---------- rules files for instruction-only hosts ----------

function rulesFile(rs, header, opts = {}) {
  const body = instructionBody(rs, { commands: false, heading: `# ${P.name}`, ...opts });
  return (header ? header + "\n\n" : "") + body;
}

// Cursor reads hooks.json from the project or the user home and calls the command for each event.
// preToolUse covers edits and writes; beforeShellExecution covers the commit itself.
// GitHub Copilot code review loads a skill from .github/skills/<name>/SKILL.md and calls its tools
// read-only, which suits a reviewer that never edits code.
export function copilotReviewSkill(rs, p) {
  return [
    "---",
    `name: ${P.slug}`,
    `description: "${P.name} reviews ${P.reviews}. Use on a pull request or a diff. Answers with the verdict block: ${P.verdictPrefix} followed by ${P.verdicts.approve}, ${P.verdicts.changes}, or ${P.verdicts.block}, then one numbered finding per line as file:line, what breaks, the smallest fix."`,
    "license: Apache-2.0",
    `compatibility: "Read-only review. Never edits files, never runs commands."`,
    "metadata:",
    `  homepage: "${P.homepage}"`,
    `  verdicts: "${P.verdicts.approve}, ${P.verdicts.changes}, ${P.verdicts.block}"`,
    "---",
    "",
    personaCard(rs),
    "",
  ].join("\n");
}

export function cursorHooks() {
  const gate = `node hooks/review-gate.mjs --host cursor`;
  return {
    version: 1,
    hooks: {
      beforeSubmitPrompt: [{ command: "node hooks/review-context.mjs --host cursor" }],
      preToolUse: [{ command: gate }],
      beforeShellExecution: [{ command: gate }],
    },
  };
}

export function cursorRule(rs) {
  return rulesFile(rs, frontmatter({ description: `${P.name} reviews every change before it is written: a ten-question checklist and a verdict.`, alwaysApply: true }));
}

export function windsurfRule(rs) {
  return rulesFile(rs, frontmatter({ trigger: "always_on", description: `${P.name} reviews every change before it is written.` }));
}

export function kiroRule(rs) {
  return rulesFile(rs, frontmatter({ inclusion: "always" }));
}

export function qoderRule(rs) {
  return rulesFile(rs, frontmatter({ trigger: "always_on", description: `${P.name} reviews every change before it is written.` }));
}

export function clineRule(rs) {
  return rulesFile(rs, "");
}

export function copilotInstructions(rs) {
  return rulesFile(rs, "");
}

export function agentsMd(rs) {
  return instructionBody(rs, { commands: false, heading: `# ${P.name}` });
}

export function geminiMd(rs) {
  return instructionBody(rs, { commands: true, heading: `# ${P.name}` });
}

export function openclawSkill(rs, p) {
  const fm = [
    "---",
    `name: ${P.slug}`,
    `description: ${JSON.stringify(p.description)}`,
    `homepage: ${HOMEPAGE}`,
    "user-invocable: true",
    "metadata:",
    "  openclaw:",
    "    always: true",
    "    emoji: \"\"",
    "---",
  ].join("\n");
  return `${fm}\n\n${instructionBody(rs, { commands: false })}`;
}

// ---------- IBM Bob (Bob Shell) ----------

export function bobSettings() {
  const cmd = (script) => `node hooks/${script} --host bob 2>/dev/null || true`;
  return {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: cmd("review-context.mjs"), timeout: 10 }] }],
      PreToolUse: [{ matcher: "^(edit|write_file|apply_diff|insert_content|search_and_replace|execute_command|bash|shell)$", hooks: [{ type: "command", command: cmd("review-gate.mjs"), timeout: 15 }] }],
    },
  };
}

export function bobSkill(rs, p) {
  const fm = ["---", `name: ${P.slug}`, `description: ${JSON.stringify(`Review any change as ${P.asName} before it is written or committed: ten questions, a fixed verdict block (${P.verdictPrefix}: ${VERDICT_LIST}), no rewrites. Use whenever the user asks for a review, a second opinion on a diff, or before committing.`)}`, "---"].join("\n");
  return `${fm}\n\n${instructionBody(rs, { commands: false })}`;
}

export function bobCommands(rs) {
  const out = new Map();
  const mk = (name, description, hint, body) => out.set(`.bob/commands/${name}.md`, `---\ndescription: ${JSON.stringify(description.replace(/\\\|/g, "|"))}${hint ? `\nargument-hint: ${JSON.stringify(hint)}` : ""}\n---\n\n${body}\n`);
  const c = (n) => rs.commands.find((x) => x.name === n).text;
  mk(`${CMD}-review`, c(`${CMD}-review`), "", `Run \`git status --short\`, \`git diff\`, and \`git diff --cached\`, then review the changes as ${P.asName}: read the whole diff, answer the ten checklist questions in writing, in order, and print the verdict block (${P.verdictPrefix}: ${VERDICT_LIST}, then numbered file:line — what fails in production — smallest fix lines). Do not edit any file.`);
  mk(`${CMD}-pr`, c(`${CMD}-pr`), "<number-or-url>", `Run \`gh pr view $1\` and \`gh pr diff $1\`, then review the pull request as ${P.asName}: read the whole diff, answer the ten checklist questions in writing, print the verdict block. Do not edit any file and do not post to the pull request.`);
  mk(`${CMD}-fix`, c(`${CMD}-fix`), "", `Apply the findings from the most recent ${P.verdictPrefix}: verdict in this conversation: one minimal edit per finding, nothing else. Then review the result again as ${P.asName} and print a fresh verdict. If there is no verdict yet, run the review first.`);
  mk(CMD, c(CMD), "[nag|gate|off]", `Set ${P.possessive} mode to $1 for this conversation (nag, gate, or off) and confirm in one line; with no argument, report the current mode. The persistent setting is \`mode\` in ~/.config/grumpy-reviewer/config.json, or the GRUMPY_MODE environment variable.`);
  mk(`${CMD}-scorecard`, c(`${CMD}-scorecard`), "", `List every ${P.verdictPrefix}: verdict you printed in this conversation as a markdown table with columns Target, Verdict, Findings, and add a final line with the number of overrides.`);
  mk(`${CMD}-help`, c(`${CMD}-help`), "", `Print this table and nothing else:\n\n${rs.sections["Commands"].replace(/\\\|/g, "|")}`);
  return out;
}

// ---------- the whole set ----------

export function renderAll(rs, p = pkg()) {
  const files = new Map();
  files.set("AGENTS.md", agentsMd(rs));
  files.set("GEMINI.md", geminiMd(rs));
  files.set("hooks/persona.md", personaCard(rs));
  files.set("hooks/hooks.json", json(claudeHooks()));
  files.set("hooks/copilot-hooks.json", json(copilotHooks()));
  files.set(".claude-plugin/plugin.json", json(claudePlugin(rs, p)));
  files.set(".claude-plugin/marketplace.json", json(claudeMarketplace(rs, p)));
  files.set(".codex-plugin/plugin.json", json(codexPlugin(rs, p)));
  files.set(".agents/plugins/marketplace.json", json(codexMarketplace()));
  files.set(".github/plugin/plugin.json", json(copilotPlugin(rs, p)));
  files.set(".github/plugin/marketplace.json", json(copilotMarketplace(rs, p)));
  files.set(".github/copilot-instructions.md", copilotInstructions(rs));
  files.set("gemini-extension.json", json(geminiExtension(rs, p)));
  files.set(".devin-plugin/plugin.json", json(devinPlugin(rs, p)));
  files.set(".qoder-plugin/plugin.json", json(qoderPlugin(rs, p)));
  files.set(`.opencode/plugins/${CMD}.mjs`, opencodePlugin(rs));
  files.set(`.cursor/rules/${CMD}.mdc`, cursorRule(rs));
  files.set("examples/cursor-hooks.json", json(cursorHooks()));
  files.set(`.github/skills/${P.slug}/SKILL.md`, copilotReviewSkill(rs, p));
  files.set(`.windsurf/rules/${CMD}.md`, windsurfRule(rs));
  files.set(`.clinerules/${CMD}.md`, clineRule(rs));
  files.set(`.kiro/steering/${CMD}.md`, kiroRule(rs));
  files.set(`.qoder/rules/${CMD}.md`, qoderRule(rs));
  files.set(`.openclaw/skills/${P.slug}/SKILL.md`, openclawSkill(rs, p));
  files.set(`.bob/rules/${CMD}.md`, clineRule(rs));
  files.set(`.bob/skills/${P.slug}/SKILL.md`, bobSkill(rs, p));
  files.set("hooks/persona.json", readFileSync(join(ROOT, "persona.json"), "utf8"));
  files.set(".bob/settings.json", json(bobSettings()));
  for (const [k, v] of bobCommands(rs)) files.set(k, v);
  files.set("examples/opencode.json", json(opencodeConfig()));
  files.set("examples/gemini-settings-hooks.json", json(geminiHooksExample()));
  files.set("examples/copilot-repo-hooks.json", json(copilotRepoHooksExample()));
  for (const [k, v] of skills(rs)) files.set(k, v);
  for (const [k, v] of geminiCommands(rs)) files.set(k, v);
  for (const [k, v] of opencodeCommands(rs)) files.set(k, v);
  return files;
}

export { ROOT, GENERATED };
