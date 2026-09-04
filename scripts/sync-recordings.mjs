#!/usr/bin/env node
// Turn the captured CLI runs in assets/recordings/<agent>.json (see scripts/capture-run.mjs) into the
// "watch it work" gallery in README.md, between the recordings markers, and copy the rendered GIFs
// into docs/assets/recordings so the Pages site can show the same runs. Nothing here is typed by
// hand: every caption comes from the recording's own status line and verdict.
//   node scripts/sync-recordings.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = JSON.parse(readFileSync(join(ROOT, "persona.json"), "utf8"));
const LABELS = { claude: "Claude Code", codex: "Codex CLI", agy: "Antigravity CLI", bob: "IBM Bob Shell", api: "Claude API" };
const ORDER = ["claude", "codex", "agy", "bob", "api"];

// width and height from the GIF header (little-endian, bytes 6 to 9)
function gifSize(file) {
  const b = readFileSync(file);
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

export function loadRecordings(root = ROOT) {
  const dir = join(root, "assets", "recordings");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const t = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const status = (t.stderr || []).find((l) => /^\d+ s/.test(l)) || "";
      const head = new RegExp(`^\\s*\\*{0,2}${P.verdictPrefix}:\\s*([A-Z_]+)`);
      let verdict = "";
      for (const l of t.stdout || []) { const m = head.exec(l); if (m) verdict = m[1]; }
      const cost = (/\$(\d+\.\d+)/.exec(status) || [])[1];
      const findings = (t.stdout || []).filter((l) => /^\d+\.\s/.test(l)).length;
      return { agent: t.agent, label: LABELS[t.agent] || t.agent, seconds: Math.round((t.durationMs || 0) / 1000), cost: cost ? Number(cost) : null, verdict, findings, gif: existsSync(join(dir, `${t.agent}.gif`)), ...(existsSync(join(dir, `${t.agent}.gif`)) ? gifSize(join(dir, `${t.agent}.gif`)) : {}), recordedAt: (t.recordedAt || "").slice(0, 10), exitCode: t.exitCode };
    })
    .filter((r) => r.gif && r.verdict)
    .sort((a, b) => ORDER.indexOf(a.agent) - ORDER.indexOf(b.agent));
}

export function caption(r) {
  const parts = [`${P.verdictPrefix}: ${r.verdict}`, `${r.findings} finding${r.findings === 1 ? "" : "s"}`, `${r.seconds} s`];
  if (r.cost != null) parts.push(`$${r.cost.toFixed(2)}`);
  return parts.join(" · ");
}

function readmeBlock(recs) {
  const obj = P.pronoun === "she" ? "her" : P.pronoun === "they" ? "them" : "him";
  const rows = [];
  for (let i = 0; i < recs.length; i += 2) {
    const pair = recs.slice(i, i + 2);
    rows.push(`| ${pair.map((r) => `**${r.label}**`).join(" | ")} |`);
    if (i === 0) rows.push(`|${pair.map(() => "---").join("|")}|`);
    rows.push(`| ${pair.map((r) => `<img src="assets/recordings/${r.agent}.gif" alt="Terminal recording of ${P.asName || P.name} reviewing a staged diff with ${r.label}: ${P.verdictPrefix}: ${r.verdict} with ${r.findings} numbered findings" width="440">`).join(" | ")} |`);
    rows.push(`| ${pair.map((r) => caption(r)).join(" | ")} |`);
  }
  const when = [...new Set(recs.map((r) => r.recordedAt))].sort().pop();
  return `<!-- recordings:start -->
## Watch ${obj} work on every agent

The same staged diff, one CLI, ${recs.length} agents. Each recording is a real run captured with \`node scripts/capture-run.mjs --agent <name>\` and rendered frame by frame from the transcript, nothing typed by hand and nothing cut. The captions come from the recording itself. Captured ${when}.

${rows.join("\n")}

Agents that narrate the whole checklist before the verdict (Bob does) are shown from the verdict block down; the CLI prints it the same way. Re-capture any of them with \`--agent claude|codex|agy|bob\`; Bob needs \`BOB_API_KEY\`.
<!-- recordings:end -->`;
}

const recs = loadRecordings();
if (!recs.length) { console.log("no recordings with a GIF and a verdict in assets/recordings"); process.exit(0); }

// README
const readmePath = join(ROOT, "README.md");
let readme = readFileSync(readmePath, "utf8");
const block = readmeBlock(recs);
if (readme.includes("<!-- recordings:start -->")) {
  readme = readme.replace(/<!-- recordings:start -->[\s\S]*?<!-- recordings:end -->/, () => block);
} else {
  const demo = readme.indexOf('<p align="center"><img src="assets/demo.gif"');
  const heroEnd = readme.indexOf("<!-- bench:hero:end -->");
  let at = demo >= 0 ? readme.indexOf("\n", demo) + 1 : heroEnd >= 0 ? readme.indexOf("\n", heroEnd) + 1 : -1;
  if (at < 0) throw new Error("README has neither a demo line nor a bench hero block to anchor the recordings");
  readme = readme.slice(0, at) + "\n" + block + "\n" + readme.slice(at);
}
writeFileSync(readmePath, readme);

// site copy
const out = join(ROOT, "docs", "assets", "recordings");
mkdirSync(out, { recursive: true });
for (const r of recs) copyFileSync(join(ROOT, "assets", "recordings", `${r.agent}.gif`), join(out, `${r.agent}.gif`));
writeFileSync(join(ROOT, "docs", "data", "recordings.json"), JSON.stringify(recs.map((r) => ({ agent: r.agent, label: r.label, verdict: r.verdict, findings: r.findings, seconds: r.seconds, cost: r.cost, recordedAt: r.recordedAt, width: r.width, height: r.height })), null, 2) + "\n");
console.log(`README gallery: ${recs.map((r) => `${r.agent} ${r.verdict} ${r.seconds}s`).join(", ")}; ${recs.length} GIFs copied to docs/assets/recordings`);
