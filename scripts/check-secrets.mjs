// SPDX-FileCopyrightText: 2026 Sandeep Bazar
// SPDX-License-Identifier: Apache-2.0
//
// Refuse to ship a credential. Benchmark records store an agent's raw stdout and stderr, so a key
// echoed by a tool would be committed as ordinary data; that is the leak this is written to catch,
// and it is why the scan covers the whole tree rather than only files a human edits.
import { execFileSync } from "node:child_process";

// Each pattern is anchored on a vendor's own prefix. Generic "looks like base64" rules match hashes,
// lockfile integrity fields and git object ids, and a check that cries wolf gets switched off.
const RULES = [
  [/\bbob_prod_[A-Za-z0-9_-]{20,}/g, "IBM Bob API key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, "Anthropic API key"],
  [/\bsk-(?:proj-)?[A-Za-z0-9]{32,}/g, "OpenAI API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/g, "GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AWS access key id"],
  [/\bnpm_[A-Za-z0-9]{36}\b/g, "npm token"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g, "private key"],
  // An assignment with a literal on the right, rather than a reference to the environment.
  [/(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/gi, "hardcoded credential"],
];

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });
const files = git("ls-files", "-z").split("\0").filter(Boolean);
// Benchmark fixtures plant a credential on purpose: "secret committed in code" is one of the
// defects these personas are scored on finding. The planted values are synthetic. Only these
// fixture paths are exempt, and only they, so a real key added anywhere else still fails the run.
const FIXTURE = /^benchmarks\/(?:seeded|clean|needle)\/|^benchmarks\/author\/tasks\//;
const findings = [];

for (const f of files) {
  if (FIXTURE.test(f)) continue;
  let body;
  try { body = git("show", `HEAD:${f}`); } catch { continue; }   // not yet committed
  for (const [re, what] of RULES) {
    for (const m of body.matchAll(re)) {
      const line = body.slice(0, m.index).split("\n").length;
      findings.push(`${f}:${line} ${what}: ${m[0].slice(0, 12)}…`);
    }
  }
}

if (findings.length) {
  console.error("secret scan FAILED\n" + findings.join("\n"));
  process.exit(1);
}
console.log(`no credentials in ${files.length} tracked files`);
