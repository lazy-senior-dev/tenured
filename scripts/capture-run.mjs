#!/usr/bin/env node
// Capture a real review run for the recording: stage a sample change in a scratch repo, run the
// CLI with one agent, and save the terminal transcript (command, stderr status line, stdout
// verdict, timing) as JSON that scripts/render-demo.py can play back frame by frame.
//   node scripts/capture-run.mjs --agent claude [--case s01-py-user-id-from-body] [--out assets/recordings/claude.json]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = JSON.parse(readFileSync(join(ROOT, "persona.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const agent = opt("--agent", "claude");
const caseId = opt("--case", null);
const out = opt("--out", join(ROOT, "assets", "recordings", `${agent}.json`));

// pick a seeded case and apply its diff to a scratch repository
const seededDir = join(ROOT, "benchmarks", "seeded");
const id = caseId || readdirSync(seededDir).filter((d) => !d.startsWith(".")).sort()[0];
const patch = readFileSync(join(seededDir, id, "diff.patch"), "utf8");
const body = patch.slice(patch.indexOf("diff --git"));
const repo = mkdtempSync(join(tmpdir(), "lsd-rec-"));
execFileSync("git", ["init", "-q"], { cwd: repo });
execFileSync("git", ["-c", "user.name=demo", "-c", "user.email=demo@example.com", "commit", "-q", "--allow-empty", "-m", "base"], { cwd: repo });
// Cases that carry a "Repository history" preamble (git log excerpts and note files) get that history
// replayed into the scratch repository: one commit per log line, oldest first, and each quoted note
// written to its path, so a persona that reads the log sees what the case describes.
function stageHistory(text) {
  const pre = text.slice(0, Math.max(0, text.indexOf("diff --git")));
  if (!/Repository history/.test(pre)) return;
  const lines = pre.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let m = /^\$ git log --oneline -- (\S+)/.exec(lines[i]);
    if (m) {
      const file = m[1]; const entries = [];
      for (let j = i + 1; j < lines.length && /^[0-9a-f]{7,}\s/.test(lines[j]); j++) entries.push(lines[j].replace(/^[0-9a-f]+\s+/, ""));
      mkdirSync(join(repo, dirname(file)), { recursive: true });
      entries.reverse().forEach((msg, k) => {
        writeFileSync(join(repo, file), `# ${file}: revision ${k + 1}\n`);
        execFileSync("git", ["add", "-A"], { cwd: repo });
        execFileSync("git", ["-c", "user.name=demo", "-c", "user.email=demo@example.com", "commit", "-q", "--allow-empty", "-m", msg], { cwd: repo });
      });
      continue;
    }
    m = /^(\S+\.md) \(excerpt\):/.exec(lines[i]);
    if (m) {
      const file = m[1]; const body = [];
      for (let j = i + 1; j < lines.length && lines[j].trim(); j++) body.push(lines[j].replace(/^"|"$/g, ""));
      mkdirSync(join(repo, dirname(file)), { recursive: true });
      writeFileSync(join(repo, file), body.join("\n") + "\n");
      execFileSync("git", ["add", "-A"], { cwd: repo });
      execFileSync("git", ["-c", "user.name=demo", "-c", "user.email=demo@example.com", "commit", "-q", "-m", `docs: add ${file}`], { cwd: repo });
    }
  }
}
stageHistory(patch);
// Rebuild the before and after of every file in the patch from its hunks (context and removed
// lines form the before, context and added lines form the after), padding the lines the hunks
// do not cover, so that the staged diff is exactly the case's diff.
function reconstruct(text) {
  const files = [];
  let cur = null;
  for (const line of text.split("\n")) {
    let m;
    if ((m = /^\+\+\+ (?:b\/)?(\S+)/.exec(line))) { cur = { path: m[1] === "/dev/null" ? null : m[1], hunks: [] }; files.push(cur); continue; }
    if (/^--- /.test(line) || /^diff --git/.test(line) || /^index /.test(line)) continue;
    if ((m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line))) { if (cur) cur.hunks.push({ a: Number(m[1]), c: Number(m[2]), pre: [], post: [] }); continue; }
    if (!cur || !cur.hunks.length) continue;
    const h = cur.hunks[cur.hunks.length - 1];
    if (line.startsWith("+")) h.post.push(line.slice(1));
    else if (line.startsWith("-")) h.pre.push(line.slice(1));
    else if (line.startsWith("\\")) continue;
    else { h.pre.push(line.slice(1)); h.post.push(line.slice(1)); }
  }
  const out = [];
  for (const f of files) {
    if (!f.path) continue;
    const build = (side) => {
      const lines = [];
      for (const h of f.hunks) {
        const startAt = side === "pre" ? h.a : h.c;
        while (lines.length < startAt - 1) lines.push("# ... line " + (lines.length + 1));
        lines.push(...h[side]);
      }
      return lines.length ? lines.join("\n") + "\n" : "";
    };
    const isNew = f.hunks.every((h) => h.pre.length === 0);
    out.push({ path: f.path, pre: isNew ? null : build("pre"), post: build("post") });
  }
  return out;
}
const files = reconstruct(body);
for (const f of files) if (f.pre !== null) { mkdirSync(join(repo, dirname(f.path)), { recursive: true }); writeFileSync(join(repo, f.path), f.pre); }
execFileSync("git", ["add", "-A"], { cwd: repo });
execFileSync("git", ["-c", "user.name=demo", "-c", "user.email=demo@example.com", "commit", "-q", "--allow-empty", "-m", "before"], { cwd: repo });
for (const f of files) { mkdirSync(join(repo, dirname(f.path)), { recursive: true }); writeFileSync(join(repo, f.path), f.post); }
execFileSync("git", ["add", "-A"], { cwd: repo });

const cmd = `npx github:lazy-senior-dev/${P.slug} review --staged --agent ${agent}`;
const started = Date.now();
const res = spawnSync(process.execPath, [join(ROOT, "bin", `${P.command}.mjs`), "review", "--staged", "--agent", agent], { cwd: repo, encoding: "utf8", env: process.env, maxBuffer: 20 * 1024 * 1024 });
const durationMs = Date.now() - started;
const transcript = {
  persona: P.slug, agent, case: id, command: cmd, durationMs, exitCode: res.status,
  stderr: (res.stderr || "").trim().split("\n").filter(Boolean),
  stdout: (res.stdout || "").trim().split("\n"),
  recordedAt: new Date().toISOString(),
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(transcript, null, 2) + "\n");
console.log(`${agent}: exit ${res.status}, ${Math.round(durationMs / 1000)} s, ${transcript.stdout.length} lines -> ${out.replace(ROOT + "/", "")}`);
