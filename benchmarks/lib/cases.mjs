// Load the seeded and clean cases from disk.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const BENCH_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadDir(dir, clean) {
  const root = join(BENCH_ROOT, dir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => existsSync(join(root, name, "answer.json")))
    .sort()
    .map((name) => {
      const answer = JSON.parse(readFileSync(join(root, name, "answer.json"), "utf8"));
      const diff = readFileSync(join(root, name, "diff.patch"), "utf8");
      const ticket = (diff.split("\n")[0].match(/^Ticket: (.+)$/) || [])[1] || "";
      return { ...answer, clean: Boolean(clean || answer.clean), diff, ticket };
    });
}

// Needle tier: one seeded defect buried in a four-file pull request of otherwise clean changes.
// Built deterministically from the seeded and clean sets, so the cases stay original and reproducible.
// needles.json (optional) pins the combinations; otherwise they are chosen deterministically:
// every third seeded case, each padded with three clean cases of the same language where possible.
function needlePlan(seeded, clean) {
  const pinned = join(BENCH_ROOT, "needles.json");
  if (existsSync(pinned)) return JSON.parse(readFileSync(pinned, "utf8"));
  const plan = [];
  for (let i = 0; i < seeded.length && plan.length < 10; i += 3) {
    const s = seeded[i];
    const same = clean.filter((c) => c.language === s.language);
    const pool = same.length >= 3 ? same : clean;
    const picks = [0, 1, 2].map((k) => pool[(i / 3 + k) % pool.length].id);
    plan.push([s.id, picks]);
  }
  return plan;
}

function stripTicket(diff) {
  return diff.replace(/^Ticket: .*\n\n?/, "");
}

export function buildNeedles(seeded, clean) {
  const byId = Object.fromEntries([...seeded, ...clean].map((c) => [c.id, c]));
  if (clean.length < 3) return [];
  return needlePlan(seeded, clean).map(([sid, cids], i) => {
    const s = byId[sid];
    const parts = cids.map((id) => byId[id]);
    const all = [...parts.slice(0, i % 3), s, ...parts.slice(i % 3)];
    const ticket = `Ticket: REL-${140 + i} "Release branch: ${all.map((c) => c.ticket.replace(/^[A-Z]+-\d+ /, "").replace(/^"|"$/g, "").toLowerCase()).join("; ")}"`;
    const diff = ticket + "\n\n" + all.map((c) => stripTicket(c.diff).trim()).join("\n\n") + "\n";
    return { ...s, id: `n${String(i + 1).padStart(2, "0")}-${sid}`, tier: "needle", clean: false, diff, ticket: ticket.replace(/^Ticket: /, ""), parts: all.map((c) => c.id), lines: undefined };
  });
}

export function loadCases({ tiers = ["seeded", "clean", "needle"] } = {}) {
  const seeded = loadDir("seeded", false).map((c) => ({ ...c, tier: "seeded" }));
  const clean = loadDir("clean", true).map((c) => ({ ...c, tier: "clean" }));
  const needle = buildNeedles(seeded, clean);
  return [...(tiers.includes("seeded") ? seeded : []), ...(tiers.includes("clean") ? clean : []), ...(tiers.includes("needle") ? needle : [])];
}
