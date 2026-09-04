#!/usr/bin/env node
// Draw assets/benchmark.svg from benchmarks/results/latest.json: for each agent, three
// metrics (defects caught, false alarms, replies without a verdict) for each arm.
// Renders a PNG next to it when headless Chrome is available.
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(ROOT, "benchmarks", "results", "latest.json");
if (!existsSync(src)) {
  console.log("no benchmarks/results/latest.json yet; run npm run bench and npm run bench:report first");
  process.exit(0);
}
const data = JSON.parse(readFileSync(src, "utf8"));
const agents = Object.entries(data.agents).filter(([, a]) => a.arms?.grump && a.arms?.bare);
const arms = [
  { key: "bare", label: "no skill", fill: "#bdb6aa" },
  { key: "generic", label: "generic prompt", fill: "#7a746b" },
  { key: "grump", label: JSON.parse(readFileSync(join(ROOT, "persona.json"), "utf8")).slug, fill: "#ff8a65" },
];
const metrics = [
  { key: "caughtMedian", label: "defects caught, 30 small diffs", sub: "higher is better", max: data.seeded, better: "higher" },
  ...(data.needle && agents.some(([, a]) => a.needle && a.needle.grump) ? [{ key: "needle", label: "found in a 150-line PR, of 10", sub: "higher is better", max: data.needle, better: "higher" }] : []),
  { key: "falsePositivesMedian", label: "false alarms, 10 clean diffs", sub: "lower is better", max: data.clean, better: "lower" },
  { key: "noVerdict", label: "replies without a verdict", sub: "lower is better", max: data.seeded + data.clean, better: "lower" },
];
const value = (s, m, a, armKey) => (m.key === "noVerdict" ? (s.runs ? s.unparseable / s.runs : 0) : m.key === "needle" ? (a.needle && a.needle[armKey] ? a.needle[armKey].caughtMedian ?? 0 : 0) : s[m.key] ?? 0);

const colW = 230, left = 210, gapX = 26, barH = 16, gapY = 4, groupH = arms.length * (barH + gapY) + 34, top = 110;
const W = left + metrics.length * (colW + gapX), H = top + agents.length * (groupH + 18) + 30;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif">
<rect width="${W}" height="${H}" fill="#f4efe6"/>
<text x="24" y="38" font-size="22" font-weight="700" fill="#1f1f1f" font-family="Georgia, serif">Same diffs, same agent, same model. Only the reviewer changes.</text>
<text x="24" y="60" font-size="12" fill="#7a746b">Medians over runs. ${data.seeded} seeded defects, ${data.clean} clean diffs. ${data.date}.</text>`;
metrics.forEach((m, mi) => {
  const x = left + mi * (colW + gapX);
  svg += `<text x="${x}" y="${top - 22}" font-size="12" font-weight="700" fill="#4a4641">${m.label}</text><text x="${x}" y="${top - 8}" font-size="11" fill="#7a746b">${m.sub}</text>`;
});
agents.forEach(([, a], ai) => {
  const gy = top + ai * (groupH + 18);
  svg += `<text x="24" y="${gy + 14}" font-size="14" font-weight="700" fill="#1f1f1f">${a.label}</text>`;
  svg += `<text x="24" y="${gy + 30}" font-size="11" fill="#7a746b">${String(a.arms.grump.model).slice(0, 26)}, n=${a.arms.grump.runs}</text>`;
  metrics.forEach((m, mi) => {
    const x0 = left + mi * (colW + gapX);
    arms.forEach((arm, j) => {
      const s = a.arms[arm.key];
      if (!s) return;
      const v = value(s, m, a, arm.key);
      const y = gy + j * (barH + gapY);
      const w = Math.max(2, (v / m.max) * (colW - 60));
      svg += `<rect x="${x0}" y="${y}" width="${w}" height="${barH}" rx="3" fill="${arm.fill}"/>`;
      svg += `<text x="${x0 + w + 6}" y="${y + 12}" font-size="12" font-weight="700" fill="#1f1f1f">${Number(v).toFixed(v % 1 ? 1 : 0)}</text>`;
      if (mi === 0) svg += `<text x="${x0 - 8}" y="${y + 12}" font-size="11" fill="#4a4641" text-anchor="end">${arm.label}</text>`;
    });
  });
});
svg += `</svg>\n`;
const out = join(ROOT, "assets", "benchmark.svg");
writeFileSync(out, svg);
console.log("wrote assets/benchmark.svg");

const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "chromium", "chromium-browser"].find((c) => {
  try { execFileSync("sh", ["-c", `command -v "${c}"`], { stdio: "ignore" }); return true; } catch { return false; }
});
if (chrome) {
  const html = join(ROOT, "assets", ".chart.html");
  writeFileSync(html, `<html><body style="margin:0"><img src="benchmark.svg" width="${W}" height="${H}" style="display:block"></body></html>`);
  try {
    execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${W},${H}`, `--screenshot=${join(ROOT, "assets", "benchmark.png")}`, `file://${html}`], { stdio: "ignore" });
    console.log("wrote assets/benchmark.png");
  } catch (err) {
    console.log("PNG render skipped: " + err.message);
  } finally {
    try { unlinkSync(html); } catch {}
  }
} else console.log("no headless Chrome found; SVG only");
