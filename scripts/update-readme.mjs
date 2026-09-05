#!/usr/bin/env node
// Fill the benchmark block of README.md from benchmarks/results/latest.json.
// The block sits between <!-- bench:hero:start --> / <!-- bench:hero:end --> and
// <!-- bench:table:start --> / <!-- bench:table:end -->; everything else is hand-written.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = join(ROOT, "README.md");
const latestPath = join(ROOT, "benchmarks", "results", "latest.json");
let readme = readFileSync(readmePath, "utf8");
const original = readme;
const P = JSON.parse(readFileSync(join(ROOT, "persona.json"), "utf8"));
const WHO = P.asName || P.name;
const HIM = P.pronoun === "she" ? "her" : P.pronoun === "they" ? "them" : "him";

const TBD = `**Numbers: TBD.** Run \`npm run bench\` and \`npm run bench:report\` with a headless agent installed (\`claude\`, \`codex\`, or \`agy\`) or an \`ANTHROPIC_API_KEY\`; the table below fills in from \`benchmarks/results/latest.json\`.`;

const n = (x, d = 0) => (x === null || x === undefined ? "n/a" : Number(x).toFixed(d));
const secs = (ms) => (ms === null || ms === undefined ? "n/a" : (ms / 1000).toFixed(0) + " s");
const perRun = (arm) => (arm && arm.runs ? n(arm.unparseable / arm.runs, 0) : "n/a");

function block() {
  if (!existsSync(latestPath)) return { hero: TBD, table: "" };
  const d = JSON.parse(readFileSync(latestPath, "utf8"));
  const rows = Object.entries(d.agents).filter(([, a]) => a.arms?.grump && a.arms?.bare);
  if (!rows.length) return { hero: TBD, table: "" };
  const [, first] = rows[0];
  const b = first.arms.bare, g = first.arms.grump;
  const same = g.caughtMedian === b.caughtMedian;
  const vs = (x, y, unit = "") => (x === y ? `${x}${unit} either way` : `${x}${unit} with ${HIM}, ${y}${unit} without`);
  const hero = `**On ${first.label} (\`${g.model}\`), ${WHO} catches ${n(g.caughtMedian)} of ${g.seeded ?? d.seeded} seeded defects${same ? ", the same as the agent alone" : ` against ${n(b.caughtMedian)} for the agent alone`}. What changes is discipline: false alarms on ${d.clean} clean diffs, ${vs(n(g.falsePositivesMedian), n(b.falsePositivesMedian))}; replies with no usable verdict per run, ${vs(perRun(g), perRun(b))}; ${n(g.blockPrecision * 100)}% of ${P.verdicts.block} verdicts land on ${P.verdicts.block}-class defects; median review time ${vs(secs(g.latencyMedianMs), secs(b.latencyMedianMs))}${g.outputTokensMedian || b.outputTokensMedian ? ` at ${vs(n(g.outputTokensMedian), n(b.outputTokensMedian), " output tokens")}` : ""}.** Median of ${g.runs} run${g.runs === 1 ? "" : "s"}, measured ${d.date}; [method, per-diff table, raw replies](benchmarks/results).`;
  let table = `| Agent | Model | Arm | Defects caught (of ${g.seeded ?? d.seeded}) | False alarms (of ${g.clean ?? d.clean}) | Replies without a verdict (per run) | BLOCK precision | Median input tokens | Median output tokens | Median latency |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const [, a] of rows) {
    for (const arm of ["bare", "generic", "grump"]) {
      const s = a.arms[arm];
      if (!s) continue;
      const bold = arm === "grump";
      const wrap = (x) => (bold ? `**${x}**` : x);
      table += `| ${a.label} | \`${s.model}\` (n=${s.runs}) | ${wrap(s.label)} | ${wrap(n(s.caughtMedian))} | ${wrap(n(s.falsePositivesMedian))} | ${wrap(perRun(s))} | ${arm === "grump" ? wrap(s.blockPrecision == null ? "n/a" : n(s.blockPrecision * 100) + "%") : "n/a"} | ${n(s.inputTokensMedian)} | ${n(s.outputTokensMedian)} | ${secs(s.latencyMedianMs)} |\n`;
    }
  }
  const needleRows = rows.filter(([, a]) => a.needle && a.needle.grump && a.needle.bare);
  if (needleRows.length) {
    const [, fa] = needleRows[0];
    const nb = fa.needle.bare, ng = fa.needle.grump, nge = fa.needle.generic;
    const heroNeedle = ` **In the needle tier, where the same defect hides in a four-file, 150-line pull request, ${fa.label} finds ${n(ng.caughtMedian)} of ${d.needle} with ${WHO}, ${n(nb.caughtMedian)} without${nge ? `, ${n(nge.caughtMedian)} with the generic prompt` : ""}.**`;
    let needleTable = `\n\n**Needle tier** (one defect in a four-file pull request of about 150 lines):\n\n| Agent | Model | No skill | Generic prompt | **${P.short}** |\n|---|---|---|---|---|\n`;
    for (const [, a] of needleRows) needleTable += `| ${a.label} | \`${a.needle.grump.model}\` (n=${a.needle.grump.runs}) | ${n(a.needle.bare.caughtMedian)}/${d.needle} | ${a.needle.generic ? n(a.needle.generic.caughtMedian) + "/" + d.needle : "n/a"} | **${n(a.needle.grump.caughtMedian)}/${d.needle}** |\n`;
    return { hero: hero + heroNeedle, table: table + needleTable };
  }
  return { hero, table };
}

// Author tier: the agent writes the change itself; the block sits between the bench:author markers
// and is inserted above the review hero when the markers are missing, because it is the headline.
const authorPath = join(ROOT, "benchmarks", "results", "author", "latest.json");
function authorBlock() {
  if (!existsSync(authorPath)) return "";
  const d = JSON.parse(readFileSync(authorPath, "utf8"));
  // "With the plugin" is the gate arm when it has run: the plugin refuses the write and the agent
  // fixes it, which is what a user installs. Without it, the persona card alone.
  const whole = (s) => s && s.runs && s.attempts === s.runs * d.tasks;
  // A host that barely finished any task cannot be compared: its zeros mean "did not write the
  // code", not "wrote nothing wrong". It has to have made the change on at least half the tickets.
  const engaged = (a) => (a.arms?.bare?.implementedTotal || 0) >= (a.arms?.bare?.attempts || 0) / 2;
  const complete = (a) => whole(a.arms?.bare) && (whole(a.arms?.gate) || whole(a.arms?.grump)) && engaged(a);
  const rows = Object.entries(d.agents).filter(([, a]) => complete(a));
  if (!rows.length) return "";
  const [, first] = rows[0];
  const b = first.arms.bare, ge = first.arms.generic;
  const g = whole(first.arms.gate) ? first.arms.gate : first.arms.grump;
  const gated = g === first.arms.gate;
  const pct = (s) => Math.round((100 * s.shippedTotal) / (s.attempts || 1));
  const lead = `**When the agent is the author, ${WHO} changes what ships.** On ${first.label} (\`${g.model}\`), given ${d.tasks} tickets that each invite a classic defect, the agent alone shipped the defect in ${b.shippedTotal} of ${b.attempts} runs (${pct(b)}%)${ge && ge.attempts ? `, ${ge.shippedTotal} of ${ge.attempts} with a generic "be careful" prompt (${pct(ge)}%)` : ""}, and ${g.shippedTotal} of ${g.attempts} with ${WHO} ${gated ? "installed, where he refuses the write until the findings are fixed" : "loaded"} (${pct(g)}%)${gated ? "" : `, reviewing its own change before finishing in ${g.reviewedTotal} of ${g.attempts} runs`}. A task the agent declined or solved another way counts as clean. The shipped code is scored by fixed checks written before any run, never by a model. Each task was run ${g.runs} times per arm; [method, per-task table, raw diffs](benchmarks/results/author).`;
  let table = `| Agent | Model | Arm | Made the change | Shipped the defect | Self-reviewed | Median time |\n|---|---|---|---|---|---|---|\n`;
  for (const [, a] of rows) for (const arm of ["bare", "generic", "grump", "gate"]) {
    const s = a.arms[arm]; if (!s || !s.runs) continue;
    const w = (x) => (arm === (gated ? "gate" : "grump") ? `**${x}**` : x);
    table += `| ${a.label} | \`${s.model}\` (n=${s.runs}) | ${w(s.label)} | ${w(s.implementedTotal + " of " + s.attempts)} | ${w(s.shippedTotal + " of " + s.attempts + " (" + pct(s) + "%)")} | ${arm === "grump" || arm === "gate" ? w(s.reviewedTotal + " of " + s.attempts) : "n/a"} | ${secs(s.latency)} |\n`;
  }
  const pending = Object.entries(d.agents).filter(([, a]) => !whole(a.arms?.bare)).map(([, a]) => a.label);
  const thin = Object.entries(d.agents).filter(([, a]) => whole(a.arms?.bare) && !engaged(a)).map(([, a]) => a.label);
  const parts = [];
  if (pending.length) parts.push(`Still running, and added as each one finishes: ${pending.join(", ")}.`);
  if (thin.length) parts.push(`Left out because it completed the change on fewer than half the tickets, so its zeros would read as "wrote nothing" rather than "wrote nothing wrong": ${thin.join(", ")}.`);
  const note = parts.length ? `\n\nEvery agent whose four arms have finished is in the table above. ${parts.join(" ")}` : "";
  return `${lead}\n\n${table.trim()}${note}`;
}
const author = authorBlock();
if (author) {
  const wrapped = `<!-- bench:author:start -->\n## The number that matters: what ships\n\n${author}\n<!-- bench:author:end -->`;
  if (readme.includes("<!-- bench:author:start -->")) readme = readme.replace(/<!-- bench:author:start -->[\s\S]*?<!-- bench:author:end -->/, () => wrapped);
  else readme = readme.replace("<!-- bench:hero:start -->", () => wrapped + "\n\n<!-- bench:hero:start -->");
} else {
  // no complete author run yet: the block is removed rather than shown half-filled
  readme = readme.replace(/<!-- bench:author:start -->[\s\S]*?<!-- bench:author:end -->\n\n?/, () => "");
}

const { hero, table } = block();
const heroOut = readme.replace(/<!-- bench:hero:start -->[\s\S]*?<!-- bench:hero:end -->/, `<!-- bench:hero:start -->\n${hero}\n<!-- bench:hero:end -->`);
const out = heroOut.replace(/<!-- bench:table:start -->[\s\S]*?<!-- bench:table:end -->/, `<!-- bench:table:start -->\n${table || "_No results yet._"}\n<!-- bench:table:end -->`);
if (out !== original) {
  writeFileSync(readmePath, out);
  console.log("README benchmark block updated");
} else console.log("README benchmark block unchanged");
