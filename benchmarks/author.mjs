#!/usr/bin/env node
// Author tier runner: the agent ships a change for a ticket, with and without the persona loaded,
// and the shipped diff is scored by the task's fixed checks. Records go to
// benchmarks/results/author/raw/<agent>.jsonl and a rerun resumes whatever is missing.
//   node benchmarks/author.mjs [--agents claude,codex,bob] [--arms bare,generic,grump] [--n 2] [--concurrency 3] [--tasks a,b]
import { mkdtempSync, cpSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AUTHORS, ARMS, availableAuthors, loadTasks } from "./lib/authors.mjs";
import { BENCH_ROOT } from "./lib/cases.mjs";

const P = JSON.parse(readFileSync(join(BENCH_ROOT, "..", "persona.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const agents = opt("--agents", (await availableAuthors()).join(",")).split(",").filter(Boolean);
const arms = opt("--arms", "bare,generic,grump").split(",");
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
  const repo = mkdtempSync(join(tmpdir(), "lsd-author-"));
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
  const res = await agent.write({ prompt, cwd: repo, model: agent.defaultModel || "" });
  git(repo, ["add", "-A"]);
  const diff = git(repo, ["diff", "--cached"]);
  const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n");
  const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1)).join("\n");
  const check = await import(pathToFileURL(join(t.dir, "check.mjs")).href);
  const implemented = added.trim().length > 0 && check.implemented(added, removed);
  const shipped = implemented ? check.shipped(added, removed) : null;
  let verdicts = [], last = null;
  for (const m of (res.text || "").matchAll(verdictRe)) { verdicts.push(m[1]); last = m[1]; }
  rmSync(repo, { recursive: true, force: true });
  return { agent: agentName, task: t.id, arm, run: runIdx, implemented, shipped, defect: check.defect, reviewed: verdicts.length > 0, verdicts, lastVerdict: last, durationMs: res.durationMs, usage: res.usage, costUsd: res.costUsd, model: res.model, exit: res.exit, diff, text: (res.text || "").slice(0, 20000), stderr: res.stderr, at: new Date().toISOString() };
}

for (const agentName of agents) {
  if (!AUTHORS[agentName]) { console.error(`unknown agent ${agentName}`); process.exit(2); }
  const file = join(RAW, `${agentName}.jsonl`);
  const done = new Set(existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.task}|${r.arm}|${r.run}`; }) : []);
  const jobs = [];
  for (const t of tasks) for (const arm of arms) for (let r = 1; r <= n; r++) if (!done.has(`${t.id}|${arm}|${r}`)) jobs.push({ t, arm, r });
  console.log(`[${agentName}] ${jobs.length} runs to make (${done.size} already done), concurrency=${concurrency}`);
  let i = 0, finished = 0;
  const started = Date.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (i < jobs.length) {
      const { t, arm, r } = jobs[i++];
      let rec;
      try { rec = await job(agentName, t, arm, r); } catch (err) { rec = { agent: agentName, task: t.id, arm, run: r, error: err.message, at: new Date().toISOString() }; }
      appendFileSync(file, JSON.stringify(rec) + "\n");
      finished++;
      const eta = Math.round(((Date.now() - started) / finished) * (jobs.length - finished) / 1000);
      const status = rec.error ? `ERROR ${rec.error.slice(0, 80)}` : !rec.implemented ? "not implemented" : rec.shipped ? "DEFECT SHIPPED" : "clean";
      console.log(`[${agentName}] ${finished}/${jobs.length} ${arm.padEnd(7)} ${t.id.padEnd(26)} run${r} ${status}${rec.reviewed ? ` (reviewed: ${rec.lastVerdict})` : ""} ${Math.round((rec.durationMs || 0) / 1000)}s (eta ${eta}s)`);
    }
  }));
}
console.log("Next: node benchmarks/author-report.mjs");
