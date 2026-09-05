// Mode persistence and per-session bookkeeping. No dependencies, never throws:
// a hook that crashes on a bad config file would take the agent down with it.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MODES = ["nag", "gate", "off"];
export const DEFAULT_MODE = "nag";

export function configDir() {
  if (process.env.GRUMPY_CONFIG_DIR) return process.env.GRUMPY_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "grumpy-reviewer");
}

export function configPath() {
  return join(configDir(), "config.json");
}

export function readConfig() {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  try {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(configPath(), JSON.stringify(next, null, 2) + "\n");
    return next;
  } catch {
    return next;
  }
}

export function isMode(value) {
  return typeof value === "string" && MODES.includes(value.toLowerCase());
}

// A repository can pin its own mode with a .grumpy.json ({"mode": "gate"}) in the
// working directory or any parent, so one team's gate never depends on a laptop's setting.
export function projectConfig(cwd = process.cwd()) {
  let dir = cwd;
  for (let i = 0; i < 40; i++) {
    const p = join(dir, ".grumpy.json");
    if (existsSync(p)) {
      try {
        const parsed = JSON.parse(readFileSync(p, "utf8"));
        return { path: p, config: parsed && typeof parsed === "object" ? parsed : {} };
      } catch {
        return { path: p, config: {} };
      }
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Resolution order: GRUMPY_MODE, then .grumpy.json in the repository, then config.json, then the default.
export function resolveMode(cwd = process.cwd()) {
  const env = process.env.GRUMPY_MODE;
  if (isMode(env)) return { mode: env.toLowerCase(), source: "GRUMPY_MODE" };
  const project = projectConfig(cwd);
  if (project && isMode(project.config.mode)) return { mode: project.config.mode.toLowerCase(), source: project.path };
  const cfg = readConfig();
  if (isMode(cfg.mode)) return { mode: cfg.mode.toLowerCase(), source: configPath() };
  return { mode: DEFAULT_MODE, source: "default" };
}

export function setMode(mode) {
  if (!isMode(mode)) throw new Error(`unknown mode "${mode}"; use one of ${MODES.join(", ")}`);
  const previous = resolveMode();
  writeConfig({ mode: mode.toLowerCase() });
  return { mode: mode.toLowerCase(), previous: previous.mode };
}

function safeId(id) {
  return String(id || "unknown").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

// Per-session state: how many times each file has been stopped at the gate.
export function statePath(sessionId) {
  return join(configDir(), "state", safeId(sessionId) + ".json");
}

export function readState(sessionId) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(sessionId), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeState(sessionId, state) {
  try {
    mkdirSync(join(configDir(), "state"), { recursive: true });
    writeFileSync(statePath(sessionId), JSON.stringify(state));
  } catch {
    // best effort
  }
}

// Scorecard: one JSON line per gate decision, read back by /grumpy-scorecard.
export function scorecardPath(sessionId) {
  return join(configDir(), "scorecard", safeId(sessionId) + ".jsonl");
}

export function appendScorecard(sessionId, entry) {
  try {
    mkdirSync(join(configDir(), "scorecard"), { recursive: true });
    appendFileSync(scorecardPath(sessionId), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    // best effort
  }
}

export function readScorecard(sessionId) {
  try {
    return readFileSync(scorecardPath(sessionId), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function latestScorecardSession() {
  const dir = join(configDir(), "scorecard");
  if (!existsSync(dir)) return null;
  let best = null;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const mtime = statSync(join(dir, name)).mtimeMs;
    if (!best || mtime > best.mtime) best = { id: name.slice(0, -6), mtime };
  }
  return best ? best.id : null;
}

// House rules: a repository, or a whole organisation through a checked-in file, adds its own
// checks without forking the ruleset. The file is markdown and is appended to the card under its
// own heading. It can add checks and raise a verdict; it can never weaken a non-negotiable, which
// is stated in the card itself so the reviewer knows the precedence.
export const POLICY_FILES = [".grumpy/policy.md", ".grumpy/house-rules.md", "docs/code-review-policy.md"];
export const POLICY_LIMIT = 8000;

export function housePolicy(cwd = process.cwd()) {
  const project = projectConfig(cwd);
  const named = project && typeof project.config.policy === "string" ? [project.config.policy] : [];
  const base = project && project.path ? join(project.path, "..") : cwd;
  for (const rel of [...named, ...POLICY_FILES]) {
    const p = rel.startsWith("/") ? rel : join(base, rel);
    try {
      if (!existsSync(p)) continue;
      const text = readFileSync(p, "utf8").trim();
      if (!text) continue;
      const truncated = text.length > POLICY_LIMIT;
      return { path: p, text: truncated ? text.slice(0, POLICY_LIMIT) + "\n\n[house rules truncated]" : text, truncated };
    } catch { /* unreadable house rules must never take the agent down */ }
  }
  return null;
}

export function withHousePolicy(card, cwd = process.cwd()) {
  const house = housePolicy(cwd);
  if (!house) return card;
  return `${card}\n\n## House rules\n\nThe team that owns this repository added the rules below. They are additional checks, not replacements: they can add a finding or raise a verdict, and they can never lower one or waive a non-negotiable above. Source: \`${house.path}\`.\n\n${house.text}`;
}
