// Parser for the Grump's verdict block.
//
//   GRUMP: REQUEST_CHANGES
//   1. src/api/users.py:42 — what fails — smallest fix
//
// The parser is deliberately forgiving about what surrounds the block and strict
// about what it reports: anything it cannot read lands in `malformed`, never in
// `findings`, so a hook can decide with what it actually understood.

import { persona, canonical } from "./persona.mjs";

export const VERDICTS = ["APPROVE", "REQUEST_CHANGES", "BLOCK"];

function headerRegex() {
  const p = persona();
  const words = [...new Set([...Object.values(p.verdicts), "APPROVE", "REQUEST_CHANGES", "BLOCK"])].map((w) => w.replace(/_/g, "[ _]")).concat(["OVERRIDE"]);
  return new RegExp(`^[ \\t]*(?:>?\\s*)?${p.verdictPrefix}:[ \\t]*(${words.join("|")})\\b[ \\t]*(?:[—–-]+[ \\t]*(.*))?$`, "gim");
}
const HEADER = headerRegex();
const FINDING = /^[ \t]*(\d+)[.)][ \t]+(.+?)[ \t]*$/;
const SEPARATOR = /[ \t]+(?:—|–|--)[ \t]+/;
const LOCATION = /^`?([^\s`:]+(?:\.[A-Za-z0-9_]+)?(?:\/[^\s`:]+)*):(\d+)(?:-(\d+))?`?$/;

export function parseFinding(line) {
  const m = FINDING.exec(line);
  if (!m) return null;
  const n = Number(m[1]);
  const parts = m[2].split(SEPARATOR);
  const finding = { n, raw: m[2], file: null, line: null, failure: null, fix: null, complete: false };
  if (parts.length >= 3) {
    const loc = LOCATION.exec(parts[0].trim());
    if (loc) {
      finding.file = loc[1];
      finding.line = Number(loc[2]);
    } else {
      finding.file = parts[0].trim();
    }
    finding.failure = parts[1].trim();
    finding.fix = parts.slice(2).join(" — ").trim();
    finding.complete = Boolean(finding.file && finding.failure && finding.fix);
  } else if (parts.length === 2) {
    finding.file = parts[0].trim();
    finding.failure = parts[1].trim();
  } else {
    finding.failure = m[2];
  }
  return finding;
}

// Parse every verdict block in `text`, in order of appearance.
export function parseVerdicts(text) {
  if (typeof text !== "string" || !text) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/^[ \t]*>[ \t]?/, ""));
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    HEADER.lastIndex = 0;
    const m = HEADER.exec(lines[i]);
    if (!m) continue;
    const label = m[1].toUpperCase().replace(" ", "_");
    const verdict = canonical(label) || label;
    const result = {
      verdict,
      label,
      override: verdict === "OVERRIDE",
      reason: (m[2] || "").trim(),
      findings: [],
      malformed: [],
      approvedWord: null,
      startLine: i,
    };
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) {
        if (result.findings.length || result.malformed.length) break;
        continue;
      }
      HEADER.lastIndex = 0;
      if (HEADER.test(line)) break;
      const finding = parseFinding(line);
      if (finding) {
        (finding.complete ? result.findings : result.malformed).push(finding);
        continue;
      }
      if (verdict === "APPROVE" && result.approvedWord === null) {
        result.approvedWord = line.trim();
        continue;
      }
      if (/^```/.test(line.trim())) break;
      if (result.findings.length || result.malformed.length) break;
      result.malformed.push({ n: null, raw: line.trim(), file: null, line: null, failure: null, fix: null, complete: false });
    }
    results.push(result);
  }
  return results;
}

// The verdict the hooks act on: the last one printed.
export function lastVerdict(text) {
  const all = parseVerdicts(text);
  return all.length ? all[all.length - 1] : null;
}

export function severityRank(verdict) {
  return { APPROVE: 0, OVERRIDE: 0, REQUEST_CHANGES: 1, BLOCK: 2 }[verdict] ?? -1;
}

export function formatVerdict(result) {
  const p = persona();
  const word = result.verdict === "OVERRIDE" ? "OVERRIDE" : p.verdicts[{ APPROVE: "approve", REQUEST_CHANGES: "changes", BLOCK: "block" }[result.verdict]] || result.verdict;
  const head = `${p.verdictPrefix}: ${word}${result.reason ? ` — ${result.reason}` : ""}`;
  if (result.verdict === "APPROVE") return `${head}\n${p.approveWord}`;
  const body = result.findings.map((f) => `${f.n}. ${f.file}${f.line ? `:${f.line}` : ""} — ${f.failure} — ${f.fix}`);
  return [head, ...body].join("\n");
}
