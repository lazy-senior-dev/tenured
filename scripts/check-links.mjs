#!/usr/bin/env node
// Check every link in the markdown and HTML files of one or more directories.
// Relative links must exist on disk; http(s) links must answer 2xx/3xx.
//   node scripts/check-links.mjs [dir ...]   (default: the repo root)
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = process.argv.slice(2).length ? process.argv.slice(2).map((d) => resolve(d)) : [ROOT];
const SKIP_DIRS = new Set([".git", "node_modules", "raw", "pilot"]);
const files = [];
function walk(d) {
  for (const name of readdirSync(d)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(md|html)$/.test(name)) files.push(p);
  }
}
dirs.forEach(walk);

const links = new Map(); // url -> [file]
const MD = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HTML = /(?:href|src)="([^"]+)"/g;
for (const f of files) {
  const text = readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  for (const re of [MD, HTML]) for (const m of text.matchAll(re)) {
    const u = m[1].trim();
    if (!u || u.startsWith("#") || u.startsWith("mailto:") || u.startsWith("data:") || u.startsWith("${")) continue;
    if (!links.has(u)) links.set(u, []);
    links.get(u).push(f);
  }
}

const problems = [];
const external = [];
for (const [u, where] of links) {
  if (/^https?:\/\//.test(u)) { external.push(u); continue; }
  const base = u.split("#")[0].split("?")[0];
  if (!base) continue;
  const ok = where.some((f) => existsSync(resolve(dirname(f), base)));
  if (!ok) problems.push(`${u}  (in ${where.map((f) => f.replace(ROOT + "/", "")).join(", ")})`);
}

const SOFT = [/img\.shields\.io/, /linkedin\.com/]; // rate-limited or bot-blocked; report but do not fail
async function head(u) {
  try {
    let r = await fetch(u, { method: "HEAD", redirect: "follow", headers: { "user-agent": "grumpy-reviewer-linkcheck" } });
    if (r.status === 405 || r.status === 403 || r.status === 404) r = await fetch(u, { method: "GET", redirect: "follow", headers: { "user-agent": "grumpy-reviewer-linkcheck" } });
    return r.status;
  } catch (e) {
    return "ERR " + e.message;
  }
}
const results = await Promise.all(external.map(async (u) => [u, await head(u)]));
let soft = 0;
for (const [u, status] of results) {
  const okStatus = typeof status === "number" && status < 400;
  if (okStatus) continue;
  if (SOFT.some((re) => re.test(u)) && status !== 404) { console.log(`soft ${status} ${u}`); soft++; continue; }
  problems.push(`${status} ${u}  (in ${links.get(u).map((f) => f.replace(ROOT + "/", "")).slice(0, 2).join(", ")})`);
}
console.log(`${files.length} files, ${links.size} links (${external.length} external), ${soft} soft warnings`);
if (problems.length) {
  console.error("Broken links:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("all links resolve");
