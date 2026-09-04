#!/usr/bin/env node
// Structural validation of every plugin manifest, without a schema library.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const P = JSON.parse(readFileSync(join(ROOT, "persona.json"), "utf8"));
const problems = [];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

function load(rel) {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
  } catch (e) {
    problems.push(`${rel}: ${e.message}`);
    return null;
  }
}

function expect(rel, cond, msg) {
  if (!cond) problems.push(`${rel}: ${msg}`);
}

function checkPlugin(rel, { requireSkills = true } = {}) {
  const m = load(rel);
  if (!m) return;
  expect(rel, KEBAB.test(m.name), "name must be kebab-case");
  expect(rel, m.name === P.slug, `name must be ${P.slug}`);
  expect(rel, SEMVER.test(m.version), "version must be semver");
  expect(rel, m.version === pkg.version, `version must match package.json (${pkg.version})`);
  expect(rel, typeof m.description === "string" && m.description.length > 20, "description missing");
  expect(rel, m.author && m.author.name === "Sandeep Bazar", "author.name");
  expect(rel, m.license === "Apache-2.0", "license");
  if (requireSkills) expect(rel, m.skills === "./skills" && existsSync(join(ROOT, "skills")), "skills path");
  if (m.hooks) expect(rel, existsSync(join(ROOT, m.hooks)), `hooks file ${m.hooks} missing`);
  if (m.rules) expect(rel, existsSync(join(ROOT, m.rules)), `rules dir ${m.rules} missing`);
}

function checkMarketplace(rel, { ownerRequired = true } = {}) {
  const m = load(rel);
  if (!m) return;
  expect(rel, typeof m.name === "string" && m.name.length, "name");
  if (ownerRequired) expect(rel, m.owner && m.owner.name === "sandeepbazar", "owner.name");
  expect(rel, Array.isArray(m.plugins) && m.plugins.length >= 1, "plugins[]");
  for (const p of m.plugins || []) {
    expect(rel, KEBAB.test(p.name || ""), `plugin name ${p.name}`);
    const src = typeof p.source === "string" ? p.source : p.source?.path;
    expect(rel, src === "./" || (src && existsSync(join(ROOT, src))), `plugin ${p.name} source ${JSON.stringify(p.source)}`);
  }
}

checkPlugin(".claude-plugin/plugin.json");
checkPlugin(".codex-plugin/plugin.json");
checkPlugin(".github/plugin/plugin.json");
checkPlugin(".devin-plugin/plugin.json");
checkPlugin(".qoder-plugin/plugin.json");
checkMarketplace(".claude-plugin/marketplace.json");
checkMarketplace(".github/plugin/marketplace.json");
checkMarketplace(".agents/plugins/marketplace.json", { ownerRequired: false });

const gemini = load("gemini-extension.json");
if (gemini) {
  expect("gemini-extension.json", /^[a-z0-9-]+$/.test(gemini.name), "name");
  expect("gemini-extension.json", gemini.version === pkg.version, "version");
  expect("gemini-extension.json", gemini.contextFileName && existsSync(join(ROOT, gemini.contextFileName)), "contextFileName");
}

const hooks = load("hooks/hooks.json");
if (hooks) {
  const EVENTS = new Set(["UserPromptSubmit", "PreToolUse", "PostToolUse", "SessionStart", "Stop", "SubagentStart", "SubagentStop", "PreCompact", "SessionEnd", "Notification"]);
  for (const [event, groups] of Object.entries(hooks.hooks || {})) {
    expect("hooks/hooks.json", EVENTS.has(event), `unknown event ${event}`);
    for (const g of groups) {
      for (const h of g.hooks || []) {
        expect("hooks/hooks.json", h.type === "command" && typeof h.command === "string", "hook entry");
        expect("hooks/hooks.json", h.command.includes("${CLAUDE_PLUGIN_ROOT}"), "command must resolve via CLAUDE_PLUGIN_ROOT");
        expect("hooks/hooks.json", Number.isInteger(h.timeout) && h.timeout <= 30, "timeout must be a small integer");
      }
    }
  }
}

const copilot = load("hooks/copilot-hooks.json");
if (copilot) {
  expect("hooks/copilot-hooks.json", copilot.version === 1, "version 1");
  for (const [event, entries] of Object.entries(copilot.hooks || {})) {
    expect("hooks/copilot-hooks.json", ["sessionStart", "sessionEnd", "userPromptSubmitted", "preToolUse", "postToolUse", "errorOccurred"].includes(event), `event ${event}`);
    for (const e of entries) expect("hooks/copilot-hooks.json", e.type === "command" && e.bash && e.timeoutSec, "entry shape");
  }
}

// action.yml is YAML; a light structural check is enough here.
if (existsSync(join(ROOT, "action.yml"))) {
  const y = readFileSync(join(ROOT, "action.yml"), "utf8");
  expect("action.yml", /^name:/m.test(y) && /using:\s*["']?composite/m.test(y), "composite action");
  for (const input of ["mode", "provider", "model", "max_files", "ignore", "github_token"]) expect("action.yml", new RegExp(`^  ${input}:`, "m").test(y), `input ${input}`);
}

if (problems.length) {
  console.error("Manifest check failed:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("manifests valid");
