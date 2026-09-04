#!/usr/bin/env node
// Author-tier report: per agent and arm, how many tasks were implemented, how many shipped the
// seeded class of defect, how often the persona arm reviewed itself, and what it cost. Writes
// benchmarks/results/author/<date>.md and results/author/latest.json.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BENCH_ROOT } from "./lib/cases.mjs";
import { ARMS, AUTHORS, loadTasks } from "./lib/authors.mjs";

const P = JSON.parse(readFileSync(join(BENCH_ROOT, "..", "persona.json"), "utf8"));
const RAW = join(BENCH_ROOT, "results", "author", "raw");
const tasks = loadTasks();
const defectOf = (t) => (/export const defect = "(.*)";/.exec(readFileSync(join(t.dir, "check.mjs"), "utf8")) || [])[1] || "";
const HEAD = existsSync(join(BENCH_ROOT, "author", "README.md")) ? readFileSync(join(BENCH_ROOT, "author", "README.md"), "utf8").trim() : "";
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

export function summarise(rows) {
  const out = {};
  for (const arm of Object.keys(ARMS)) {
    const rs = rows.filter((r) => r.arm === arm && !r.error);
    const runs = [...new Set(rs.map((r) => r.run))].sort();
    const perRun = runs.map((run) => {
      const x = rs.filter((r) => r.run === run);
      return { implemented: x.filter((r) => r.implemented).length, shipped: x.filter((r) => r.shipped).length, reviewed: x.filter((r) => r.reviewed).length, approved: x.filter((r) => r.lastVerdict === P.verdicts.approve).length };
    });
    const perTask = {};
    for (const t of tasks) { const x = rs.filter((r) => r.task === t.id); perTask[t.id] = { runs: x.length, implemented: x.filter((r) => r.implemented).length, shipped: x.filter((r) => r.shipped).length }; }
    out[arm] = {
      label: ARMS[arm].label,
      runs: runs.length,
      records: rs.length,
      errors: rows.filter((r) => r.arm === arm && r.error).length,
      implemented: median(perRun.map((p) => p.implemented)),
      shipped: median(perRun.map((p) => p.shipped)),
      shippedMean: perRun.length ? perRun.reduce((a, p) => a + p.shipped, 0) / perRun.length : null,
      reviewed: median(perRun.map((p) => p.reviewed)),
      approved: median(perRun.map((p) => p.approved)),
      latency: median(rs.map((r) => r.durationMs)),
      output: median(rs.map((r) => r.usage?.output)),
      cost: median(rs.map((r) => r.costUsd)),
      model: rs[0]?.model || "",
      perTask,
    };
  }
  return out;
}

// Every record is rescored from its stored diff with the checks as they are now, so a check that
// is tightened or loosened after a run applies to the whole set without rerunning any agent.
const checks = {};
for (const t of tasks) checks[t.id] = await import(pathToFileURL(join(t.dir, "check.mjs")).href);
function rescore(rec) {
  const c = checks[rec.task];
  if (!c || rec.error || typeof rec.diff !== "string") return rec;
  const added = rec.diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n");
  const removed = rec.diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1)).join("\n");
  const implemented = added.trim().length > 0 && c.implemented(added, removed);
  return { ...rec, implemented, shipped: implemented ? c.shipped(added, removed) : null };
}

const agents = {};
for (const f of existsSync(RAW) ? readdirSync(RAW).filter((f) => f.endsWith(".jsonl")) : []) {
  const agent = f.replace(".jsonl", "");
  const rows = readFileSync(join(RAW, f), "utf8").trim().split("\n").filter(Boolean).map((l) => rescore(JSON.parse(l)));
  agents[agent] = { label: AUTHORS[agent]?.label || agent, calls: rows.length, errors: rows.filter((r) => r.error).length, arms: summarise(rows) };
}
if (!Object.keys(agents).length) { console.log("no author-tier records yet"); process.exit(0); }
const date = new Date().toISOString().slice(0, 10);
const fmt = (x, d = 0) => (x == null ? "n/a" : Number(x).toFixed(d));
let md = `# Author tier, ${date}\n\n**What is measured.** The agent is the author. It gets a ticket and a small repository (${tasks.length} tasks, each inviting one classic defect, listed in the per-task table) and has to ship the change itself in the agent's own headless write mode.${HEAD ? " " + HEAD : ""} Three arms: the task alone, the task with a generic "be careful" prompt, and the task with ${P.asName || P.name}'s persona card and the instruction to review the change as ${P.asName || P.name} before finishing. The shipped diff is scored by fixed checks written before any run (\`benchmarks/author/tasks/*/check.mjs\`), never by a model.\n\n**Scores.** *Implemented* is the number of tasks where the diff contains the feature. *Shipped defects* is the number of tasks whose diff contains the seeded class of defect; lower is better. A task the agent declined, or solved another way, counts as clean, which is the right outcome for a ticket that asks for the wrong thing. *Self-reviewed* is the number of runs where ${P.asName || P.name}'s verdict block appears in the transcript. Medians over runs.\n\n`;
for (const [agent, a] of Object.entries(agents)) {
  md += `## ${a.label}\n\n${a.calls} runs, ${a.errors} errors (errors are excluded).\n\n| Arm | Model | Runs | Made the change (of ${tasks.length}) | Shipped defects (of ${tasks.length}) | Self-reviewed | Median time | Median output tokens | Median cost |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const [arm, s] of Object.entries(a.arms)) {
    const b = arm === "grump" ? "**" : "";
    md += `| ${b}${s.label}${b} | \`${s.model}\` | ${s.runs} | ${b}${fmt(s.implemented)}${b} | ${b}${fmt(s.shipped)}${b} | ${arm === "grump" ? fmt(s.reviewed) : "n/a"} | ${s.latency == null ? "n/a" : Math.round(s.latency / 1000) + " s"} | ${fmt(s.output)} | ${s.cost == null ? "n/a" : "$" + fmt(s.cost, 3)} |\n`;
  }
  md += `\n### Per task (runs that shipped the defect / runs that made the change)\n\n| Task | Defect class | ${Object.values(a.arms).map((s) => s.label).join(" | ")} |\n|---|---|${Object.keys(a.arms).map(() => "---").join("|")}|\n`;
  for (const t of tasks) {
    const defect = defectOf(t);
    md += `| ${t.id} | ${defect} | ${Object.values(a.arms).map((s) => `${s.perTask[t.id].shipped}/${s.perTask[t.id].implemented}`).join(" | ")} |\n`;
  }
  md += "\n";
}
md += `## Method\n\nEach run starts from a fresh copy of the task's scaffold, committed once. The agent runs in its headless write mode (Claude Code with edits auto-accepted and shell tools off; Codex with a workspace-write sandbox; Bob in code mode) with the same footer telling it to edit files directly and not to run or install anything. The diff is taken with \`git diff --cached\` after \`git add -A\`. Checks look at the added and removed lines of the diff and are applied at report time to every stored diff, so a corrected check rescores the whole set. A task counts as implemented when the added lines contain the feature's route or function; the defect check runs only on implemented tasks. Raw transcripts and diffs are in \`raw/\`.\n\n## Limitations\n\n${tasks.length} tasks, each with one seeded class of defect; the checks are pattern-based and can miss an unusual defensive construction or an unusual way of introducing the defect (both directions are visible in \`raw/\`). Tasks are small enough to finish in one turn, which favours every arm. The persona arm loads the card through the prompt, the way every host adapter does, not through a hook that denies the write. Antigravity is not in this tier: its headless mode aborts the run when a tool needs a permission it cannot ask for, which happens on most tasks.\n`;
writeFileSync(join(BENCH_ROOT, "results", "author", `${date}.md`), md);
writeFileSync(join(BENCH_ROOT, "results", "author", "latest.json"), JSON.stringify({ date, tasks: tasks.length, agents }, null, 2) + "\n");
console.log(`wrote benchmarks/results/author/${date}.md and results/author/latest.json`);
for (const [agent, a] of Object.entries(agents)) console.log(agent, Object.entries(a.arms).map(([k, s]) => `${k}: shipped ${fmt(s.shipped)}/${fmt(s.implemented)}`).join("; "));
