#!/usr/bin/env node
// Record the loop the plugin exists for: an agent writes a change for a ticket, the review refuses
// it with findings, the agent fixes it, and the review approves. Everything here is a real run in a
// scratch copy of an author-tier task; nothing is scripted.
//   node scripts/capture-gate.mjs --agent claude [--task api-key-auth] [--out assets/recordings/gate-claude.json]
import { mkdtempSync, cpSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = JSON.parse(readFileSync(join(ROOT, "persona.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const agent = opt("--agent", "claude");
const tasksDir = join(ROOT, "benchmarks", "author", "tasks");
const taskId = opt("--task", null) || readFileSync(join(ROOT, "benchmarks", "author", "PREFERRED_GATE_TASK"), "utf8").trim();
const out = opt("--out", join(ROOT, "assets", "recordings", `gate-${agent}.json`));
const taskDir = join(tasksDir, taskId);
if (!existsSync(taskDir)) { console.error(`no task ${taskId}`); process.exit(2); }

const { AUTHORS, ARMS } = await import(join(ROOT, "benchmarks", "lib", "authors.mjs"));
const author = AUTHORS[agent];
if (!author) { console.error(`unknown agent ${agent}`); process.exit(2); }

const repo = mkdtempSync(join(tmpdir(), "lsd-gate-"));
const git = (a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
git(["init", "-q"]);
cpSync(join(taskDir, "scaffold"), repo, { recursive: true });
git(["add", "-A"]);
git(["-c", "user.name=demo", "-c", "user.email=demo@example.com", "commit", "-q", "-m", "scaffold"]);

const task = readFileSync(join(taskDir, "TASK.md"), "utf8").trim();
const steps = [];
const started = Date.now();

process.stderr.write(`writing the change with ${author.label}\n`);
let res = await author.write({ prompt: ARMS.grump.prompt(task), cwd: repo, model: author.defaultModel || "" });
steps.push({ kind: "write", label: `${author.label} writes the change`, seconds: Math.round(res.durationMs / 1000) });
git(["add", "-A"]);

for (let round = 1; round <= 2; round++) {
  const review = spawnSync(process.execPath, [join(ROOT, "bin", `${P.command}.mjs`), "review", "--staged", "--agent", agent], { cwd: repo, encoding: "utf8", env: process.env, maxBuffer: 20 * 1024 * 1024 });
  const text = (review.stdout || "").trim();
  const level = (new RegExp(`${P.verdictPrefix}:\\s*([A-Z_]+)`).exec(text) || [])[1] || null;
  steps.push({ kind: "review", label: `${P.name} reads the staged diff`, verdict: level, text, blocked: level && level !== P.verdicts.approve });
  process.stderr.write(`  review ${round}: ${level}\n`);
  if (!level || level === P.verdicts.approve) break;
  const fix = await author.write({ prompt: `Your change was reviewed before it could be committed and the review refused it. Fix every finding in the change you already made, then stop.\n\n${text}`, cwd: repo, model: author.defaultModel || "" });
  steps.push({ kind: "fix", label: `${author.label} fixes the findings`, seconds: Math.round(fix.durationMs / 1000) });
  git(["add", "-A"]);
}

const diff = git(["diff", "--cached"]);
rmSync(repo, { recursive: true, force: true });
mkdirSync(dirname(out), { recursive: true });
const record = { persona: P.name, prefix: P.verdictPrefix, agent, agentLabel: author.label, task: taskId, ticket: task.split("\n")[0], steps, diffLines: diff.split("\n").length, durationMs: Date.now() - started, recordedAt: new Date().toISOString() };
writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
const denied = steps.filter((s) => s.blocked).length;
console.log(`${agent}: ${steps.length} steps, ${denied} refused, ${Math.round(record.durationMs / 1000)} s -> ${out.replace(ROOT + "/", "")}`);
