#!/usr/bin/env node
// Run the benchmark: every case x every arm x n runs, per agent, resumable.
//
//   npm run bench -- [--agents claude,codex,agy,api] [--arms bare,generic,grump] [--n 3]
//                    [--concurrency 3] [--model.claude sonnet] [--model.codex ...] [--only s01,s02] [--limit 5]
//
// Records go to benchmarks/results/raw/<agent>.jsonl, one JSON line per call. Re-running
// skips (arm, case, run) triples already present, so an interrupted run resumes.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCases, BENCH_ROOT } from "./lib/cases.mjs";
import { ARMS, buildPrompt } from "./lib/arms.mjs";
import { AGENTS, availableAgents } from "./lib/agents.mjs";
import { scoreResponse } from "./lib/score.mjs";

function parseArgs(argv) {
  const out = { n: 3, concurrency: 3, arms: Object.keys(ARMS), models: {}, only: null, limit: 0, agents: null, tiers: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--agents") out.agents = next().split(",");
    else if (a === "--arms") out.arms = next().split(",");
    else if (a === "--n") out.n = Number(next());
    else if (a === "--concurrency") out.concurrency = Number(next());
    else if (a === "--only") out.only = next().split(",");
    else if (a === "--tiers") out.tiers = next().split(",");
    else if (a === "--limit") out.limit = Number(next());
    else if (a.startsWith("--model.")) out.models[a.slice(8)] = next();
    else if (a === "--help") {
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 9).join("\n"));
      process.exit(0);
    }
  }
  return out;
}

function loadDone(path) {
  const done = new Set();
  if (!existsSync(path)) return done;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (!r.error) done.add(`${r.arm}|${r.case}|${r.run}`);
    } catch {
      // skip
    }
  }
  return done;
}

async function runAgent(agentName, cases, opts) {
  const agent = AGENTS[agentName];
  const model = opts.models[agentName] ?? agent.defaultModel;
  const outDir = join(BENCH_ROOT, "results", "raw");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${agentName}.jsonl`);
  const done = loadDone(outPath);

  const jobs = [];
  for (let run = 1; run <= opts.n; run++) for (const c of cases) for (const arm of opts.arms) {
    if (!done.has(`${arm}|${c.id}|${run}`)) jobs.push({ arm, c, run });
  }
  console.log(`[${agentName}] ${jobs.length} calls to make (${done.size} already done), model=${model || "default"}, concurrency=${opts.concurrency}`);

  let next = 0;
  let finished = 0;
  let failed = 0;
  const started = Date.now();
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const { system, user } = buildPrompt(job.arm, job.c);
      const record = { ts: new Date().toISOString(), agent: agentName, model, arm: job.arm, case: job.c.id, run: job.run, clean: job.c.clean, tier: job.c.tier };
      try {
        const res = await agent.run({ system, user, model });
        Object.assign(record, {
          model: res.model || model,
          text: res.text,
          usage: res.usage,
          costUsd: res.costUsd,
          durationMs: res.durationMs,
          score: scoreResponse(job.c, res.text),
        });
      } catch (err) {
        record.error = err.message;
        failed++;
      }
      appendFileSync(outPath, JSON.stringify(record) + "\n");
      finished++;
      const s = record.score;
      const tag = record.error ? `ERROR ${record.error.slice(0, 80)}` : job.c.clean ? (s.falsePositive ? "false positive" : "clean ok") : s.caught ? "caught" : s.flagged ? "flagged, missed the defect" : "missed";
      const eta = Math.round(((Date.now() - started) / finished) * (jobs.length - finished) / 1000);
      console.log(`[${agentName}] ${finished}/${jobs.length} ${job.arm.padEnd(7)} ${job.c.id.padEnd(30)} run${job.run} ${tag} (eta ${eta}s)`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, jobs.length) }, worker));
  console.log(`[${agentName}] done: ${finished} calls, ${failed} errors, ${Math.round((Date.now() - started) / 1000)}s`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let cases = opts.tiers ? loadCases({ tiers: opts.tiers }) : loadCases();
  if (opts.only) cases = cases.filter((c) => opts.only.some((id) => c.id.startsWith(id)));
  if (opts.limit) cases = cases.slice(0, opts.limit);
  const agents = opts.agents || (await availableAgents());
  if (!agents.length) {
    console.error("No headless agent found. Install claude, codex, or agy, or set ANTHROPIC_API_KEY / OPENAI_API_KEY.");
    process.exit(1);
  }
  console.log(`cases: ${cases.length} (${cases.filter((c) => !c.clean).length} seeded, ${cases.filter((c) => c.clean).length} clean); arms: ${opts.arms.join(", ")}; n=${opts.n}; agents: ${agents.join(", ")}`);
  await Promise.all(agents.map((a) => runAgent(a, cases, opts)));
  console.log("\nNext: npm run bench:report");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
