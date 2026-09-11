#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Sandeep Bazar
// SPDX-License-Identifier: Apache-2.0
// Author tier runner: the agent ships a change for a ticket, with and without the persona loaded,
// and the shipped diff is scored by the task's fixed checks. Records go to
// benchmarks/results/author/raw/<agent>.jsonl and a rerun resumes whatever is missing.
//   node benchmarks/author.mjs [--agents claude,codex,bob] [--arms bare,generic,grump] [--n 2] [--concurrency 3] [--tasks a,b]
import { mkdtempSync, realpathSync, cpSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
// realpath: on macOS tmpdir is /var/... symlinked to /private/var/..., and a sandboxed agent that
// resolves the real path sees its own workspace as "outside the project" and rejects every write.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AUTHORS, ARMS, availableAuthors, loadTasks } from "./lib/authors.mjs";
import { BENCH_ROOT } from "./lib/cases.mjs";
import { isRefusal, LIMIT_CLI } from "./lib/limits.mjs";

const P = JSON.parse(readFileSync(join(BENCH_ROOT, "..", "persona.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const agents = opt("--agents", (await availableAuthors()).join(",")).split(",").filter(Boolean);
const arms = opt("--arms", "bare,generic,grump,gate").split(",");
const n = Number(opt("--n", 2));
const concurrency = Number(opt("--concurrency", 3));
const only = opt("--tasks", "").split(",").filter(Boolean);
const tasks = loadTasks().filter((t) => !only.length || only.includes(t.id));
const RAW = join(BENCH_ROOT, "results", "author", "raw");
mkdirSync(RAW, { recursive: true });

const git = (cwd, a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const verdictRe = new RegExp(`${P.verdictPrefix}:\\s*(${P.verdicts.approve}|${P.verdicts.changes}|${P.verdicts.block})`, "g");

async function job(agentName, t, arm, runIdx) {
  const agent = AUTHORS[agentName];
  const repo = mkdtempSync(join(realpathSync(tmpdir()), "lsd-author-"));
  git(repo, ["init", "-q"]);
  const commit = (msg) => { git(repo, ["add", "-A"]); git(repo, ["-c", "user.name=bench", "-c", "user.email=bench@example.com", "commit", "-q", "--allow-empty", "-m", msg]); };
  // Tasks with a history.json replay it first: each entry writes files and commits with the given
  // message, so a persona that reads the log sees what the task describes. The scaffold is the
  // current state and is committed last.
  const hist = join(t.dir, "history.json");
  if (existsSync(hist)) {
    for (const c of JSON.parse(readFileSync(hist, "utf8"))) {
      for (const [f, content] of Object.entries(c.files || {})) { mkdirSync(join(repo, f, ".."), { recursive: true }); if (content === null) rmSync(join(repo, f), { force: true }); else writeFileSync(join(repo, f), content); }
      commit(c.message);
    }
  }
  cpSync(join(t.dir, "scaffold"), repo, { recursive: true });
  commit("current state");
  const prompt = ARMS[arm].prompt(t.task);
  let res = await agent.write({ prompt, cwd: repo, model: agent.defaultModel || "" });
  // A limit reply is an error, never a result: a run that was refused before it could write
  // records the same zeros as a run that wrote nothing wrong, and only one of those is good
  // news. Each vendor words it differently, so match the phrasings rather than one product.
  if (isRefusal(res)) {
    rmSync(repo, { recursive: true, force: true });
    // Report the stream that actually carries the refusal. Codex prints "Reading additional input
    // from stdin..." on stderr and the real message -- including when the window reopens -- inside a
    // turn.failed event on stdout. Preferring stderr meant the worker saw a banner with no time in
    // it and fell back to blind 45 minute retries instead of sleeping until the window returns.
    const detail = [res.stderr, res.text].find((s) => s && LIMIT_CLI.test(s)) || res.stderr || res.text || "";
    throw new Error(`usage limit: ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  git(repo, ["add", "-A"]);
  // The gate arm runs the plugin's own review over the staged diff and hands the findings back,
  // up to two rounds, which is what the PreToolUse hook does inside a host.
  const rounds = [];
  if (ARMS[arm].gated) {
    for (let round = 1; round <= 2; round++) {
      const review = spawnSync(process.execPath, [join(BENCH_ROOT, "..", "bin", `${P.command}.mjs`), "review", "--staged", "--agent", agentName], { cwd: repo, encoding: "utf8", env: process.env, maxBuffer: 20 * 1024 * 1024 });
      const verdictText = (review.stdout || "").trim();
      const level = (new RegExp(`${P.verdictPrefix}:\\s*([A-Z_]+)`).exec(verdictText) || [])[1] || null;
      rounds.push({ round, level, findings: verdictText.slice(0, 4000) });
      if (!level || level === P.verdicts.approve) break;
      const fix = await agent.write({ prompt: `Your change was reviewed before it could be committed and the review refused it. Fix every finding in the change you already made, then stop.\n\n${verdictText}`, cwd: repo, model: agent.defaultModel || "" });
      res = { ...fix, text: `${res.text}\n\n${verdictText}\n\n${fix.text}`, durationMs: (res.durationMs || 0) + (fix.durationMs || 0), usage: { input: (res.usage?.input || 0) + (fix.usage?.input || 0), output: (res.usage?.output || 0) + (fix.usage?.output || 0) }, costUsd: (res.costUsd || 0) + (fix.costUsd || 0) };
      git(repo, ["add", "-A"]);
    }
  }
  const diff = git(repo, ["diff", "--cached"]);
  const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n");
  const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1)).join("\n");
  const check = await import(pathToFileURL(join(t.dir, "check.mjs")).href);
  const implemented = added.trim().length > 0 && check.implemented(added, removed, diff);
  const shipped = implemented ? check.shipped(added, removed, diff) : null;
  // Optional per-task check: did the change name the prior decision it is about to undo? Only this
  // corpus has one, because only this reviewer claims to read the repository's history.
  const cited = typeof check.cites === "function" ? check.cites(res.text || "", diff) : null;
  let verdicts = [], last = null;
  for (const m of (res.text || "").matchAll(verdictRe)) { verdicts.push(m[1]); last = m[1]; }
  rmSync(repo, { recursive: true, force: true });
  return { agent: agentName, task: t.id, arm, run: runIdx, implemented, shipped, cited, rounds, defect: check.defect, reviewed: verdicts.length > 0, verdicts, lastVerdict: last, durationMs: res.durationMs, usage: res.usage, costUsd: res.costUsd, model: res.model, exit: res.exit, diff, text: (res.text || "").slice(0, 20000), stderr: res.stderr, at: new Date().toISOString() };
}

for (const agentName of agents) {
  if (!AUTHORS[agentName]) { console.error(`unknown agent ${agentName}`); process.exit(2); }
  const file = join(RAW, `${agentName}.jsonl`);
  const done = new Set(existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error).map((r) => `${r.task}|${r.arm}|${r.run}`) : []);
  const jobs = [];
  // Run-major, deliberately. The report will only publish an agent whose arms are whole --
  // attempts === runs * tasks -- so the order decides what a half-finished sweep is worth. Finishing
  // task by task leaves some tickets at five runs and the rest at none, which is never whole and is
  // therefore worth nothing to a reader. Finishing round by round leaves every ticket and every arm
  // at the same lower n, which is a complete, publishable result the moment the round lands.
  for (let r = 1; r <= n; r++) for (const t of tasks) for (const arm of arms) if (!done.has(`${t.id}|${arm}|${r}`)) jobs.push({ t, arm, r });
  console.log(`[${agentName}] ${jobs.length} runs to make (${done.size} already done), concurrency=${concurrency}`);
  let i = 0, finished = 0;
  // One quota refusal means every remaining job in this pass will be refused too. Attempting them
  // anyway costs an hour and writes hundreds of error stubs that say nothing except "the window was
  // shut". Stop the pass on the first one and let the worker wait for the window to reopen; the
  // records already on disk are kept, so the next pass resumes rather than restarts.
  let quotaHit = null;
  const started = Date.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (i < jobs.length && !quotaHit) {
      const { t, arm, r } = jobs[i++];
      let rec;
      try { rec = await job(agentName, t, arm, r); } catch (err) { rec = { agent: agentName, task: t.id, arm, run: r, error: err.message, at: new Date().toISOString() }; }
      if (rec.error && /usage limit|quota/i.test(rec.error)) { quotaHit = rec.error; break; }
      appendFileSync(file, JSON.stringify(rec) + "\n");
      finished++;
      const eta = Math.round(((Date.now() - started) / finished) * (jobs.length - finished) / 1000);
      const status = rec.error ? `ERROR ${rec.error.slice(0, 80)}` : !rec.implemented ? "not implemented" : rec.shipped ? "DEFECT SHIPPED" : "clean";
      console.log(`[${agentName}] ${finished}/${jobs.length} ${arm.padEnd(7)} ${t.id.padEnd(26)} run${r} ${status}${rec.rounds?.length ? ` (gate: ${rec.rounds.map((x) => x.level || "none").join(" then ")})` : rec.reviewed ? ` (reviewed: ${rec.lastVerdict})` : ""} ${Math.round((rec.durationMs || 0) / 1000)}s (eta ${eta}s)`);
    }
  }));
  // Print the refusal verbatim. The worker reads its reset time out of this line so it can
  // sleep until the window actually reopens instead of guessing at a fixed interval.
  if (quotaHit) console.log(`[${agentName}] QUOTA ${quotaHit.replace(/\s+/g, " ").slice(0, 300)}`);
}
console.log("Next: node benchmarks/author-report.mjs");
