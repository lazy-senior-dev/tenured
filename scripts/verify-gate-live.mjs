#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Sandeep Bazar
// SPDX-License-Identifier: Apache-2.0
// Live-host verification. The author benchmark scores the ruleset by re-running the review over a
// staged diff, which is a faithful model of the gate but not the gate itself. This runs the real
// plugin inside a real host -- the shipped hooks.json, loaded the way an install loads it -- and
// records what the host actually decided, so "the gate refuses the write" is an observation rather
// than a description of the code.
//
//   node scripts/verify-gate-live.mjs [--tasks a,b] [--runs 1] [--concurrency 2] [--model claude-sonnet-5]
//
// Exits non-zero if the gate never denied a write: a plugin whose hook silently stops firing is
// the one failure this repo must never ship, and it is invisible to every other test.
import { mkdtempSync, realpathSync, cpSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readDecisions } from "./lib/live.mjs";
import { isRefusal } from "../benchmarks/lib/limits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TASKS = join(ROOT, "benchmarks", "author", "tasks");
const OUT = join(ROOT, "benchmarks", "results", "live");
const P = JSON.parse(readFileSync(join(ROOT, "persona.json"), "utf8"));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const only = opt("--tasks", "").split(",").filter(Boolean);
const runs = Number(opt("--runs", 1));
const concurrency = Number(opt("--concurrency", 2));
const model = opt("--model", "claude-sonnet-5");

const git = (cwd, a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function taskIds() {
  const all = execFileSync("ls", [TASKS], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  return all.filter((t) => (!only.length || only.includes(t)) && existsSync(join(TASKS, t, "check.mjs")));
}

// A usage limit is an error, not a result: a session refused before it could write records the same
// "no deny seen" as a session the gate ignored, and only one of those is a bug worth failing on.


function claude(prompt, cwd) {
  return new Promise((resolve) => {
    const a = ["-p", prompt, "--plugin-dir", ROOT, "--output-format", "stream-json", "--verbose",
      "--include-hook-events", "--permission-mode", "acceptEdits",
      "--allowedTools", "Edit", "Write", "MultiEdit", "Read", "Glob", "Grep",
      "--model", model];
    const p = spawn("claude", a, { cwd, env: { ...process.env, GRUMPY_MODE: "gate" } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ out, err, code }));
    p.on("error", (e) => resolve({ out, err: String(e), code: -1 }));
  });
}

async function one(taskId, runIdx) {
  const dir = join(TASKS, taskId);
  const repo = mkdtempSync(join(realpathSync(tmpdir()), "lsd-live-"));
  try {
    git(repo, ["init", "-q"]);
    const commit = (msg) => {
      git(repo, ["add", "-A"]);
      git(repo, ["-c", "user.name=bench", "-c", "user.email=bench@example.com", "commit", "-q", "--allow-empty", "-m", msg]);
    };
    // Tasks with a history.json replay it first, exactly as the author tier does. A reviewer whose
    // whole claim is that it reads the repository's log has nothing to read without this, and the
    // session would score as "the gate did not object" when the truth is it was never shown the
    // evidence.
    const hist = join(dir, "history.json");
    if (existsSync(hist)) {
      for (const c of JSON.parse(readFileSync(hist, "utf8"))) {
        for (const [f, content] of Object.entries(c.files || {})) {
          mkdirSync(join(repo, f, ".."), { recursive: true });
          if (content === null) rmSync(join(repo, f), { force: true });
          else writeFileSync(join(repo, f), content);
        }
        commit(c.message);
      }
    }
    cpSync(join(dir, "scaffold"), repo, { recursive: true });
    commit("current state");
    const res = await claude(readFileSync(join(dir, "TASK.md"), "utf8"), repo);
    if (isRefusal({ text: res.out, stderr: res.err, exit: res.code })) {
      throw new Error(`usage limit: ${(res.err || res.out).replace(/\s+/g, " ").slice(0, 200)}`);
    }
    const { denials, hookCalls, personaInjected } = readDecisions(res.out, { personaName: P.short });
    const added = git(repo, ["diff", "-U0"]).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
    const check = await import(pathToFileURL(join(dir, "check.mjs")).href);
    return {
      task: taskId, run: runIdx, model, host: "claude-code", mode: "gate",
      hookCalls, personaInjected, denied: denials.length > 0, denials,
      implemented: Boolean(check.implemented(added)), shippedDefect: Boolean(check.implemented(added) && check.shipped(added)),
      defect: check.defect, at: new Date().toISOString(),
    };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

const OUT_FILE = join(OUT, "claude-code.json");
const prior = existsSync(OUT_FILE)
  ? (JSON.parse(readFileSync(OUT_FILE, "utf8")).records || []).filter((r) => r.model === model && !r.error)
  : [];
const done = new Set(prior.map((r) => `${r.task}#${r.run}`));

const queue = [];
for (const t of taskIds()) for (let i = 0; i < runs; i++) if (!done.has(`${t}#${i}`)) queue.push([t, i]);
console.log(`[live] ${queue.length} sessions to run (${prior.length} already recorded), model=${model}, concurrency=${concurrency}`);

const records = [...prior];
let cursor = 0, limitHit = null;
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
  while (cursor < queue.length && !limitHit) {
    const [t, i] = queue[cursor++];
    try {
      const r = await one(t, i);
      records.push(r);
      console.log(`  ${r.task}#${r.run} hooks=${r.hookCalls} persona=${r.personaInjected} denied=${r.denied}(${r.denials.length}) implemented=${r.implemented} shippedDefect=${r.shippedDefect}`);
    } catch (e) {
      if (/usage limit/i.test(e.message)) { limitHit = e.message; break; }
      console.log(`  ${t}#${i} error: ${e.message}`);
      records.push({ task: t, run: i, model, error: e.message, at: new Date().toISOString() });
    }
  }
}));

mkdirSync(OUT, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify({ model, host: "claude-code", recordedAt: new Date().toISOString(), records }, null, 2) + "\n");

const ok = records.filter((r) => !r.error);
const denied = ok.filter((r) => r.denied).length;
const shipped = ok.filter((r) => r.shippedDefect).length;
const impl = ok.filter((r) => r.implemented).length;
console.log(`\n[live] sessions=${ok.length} persona-injected=${ok.filter((r) => r.personaInjected).length} gate-denied=${denied} implemented=${impl} shipped-defect=${shipped}`);
if (limitHit) { console.error(`[live] stopped early: ${limitHit}`); process.exit(2); }
if (!ok.length) { console.error("[live] no sessions completed"); process.exit(1); }
if (!denied) { console.error("[live] the gate never denied a write -- the hook is not firing in the host"); process.exit(1); }
