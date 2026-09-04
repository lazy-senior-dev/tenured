// Parser for rules/grump.md, the single source of truth every adapter is rendered from.
// It reads plain markdown: level-2 headings become sections, the numbered list under
// "The checklist" becomes checklist items, and the commands table becomes command rows.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PERSONA = JSON.parse(readFileSync(join(ROOT, "persona.json"), "utf8"));
export const RULES_PATH = join(ROOT, PERSONA.rules || "rules/grump.md");
export const VERDICTS = ["APPROVE", "REQUEST_CHANGES", "BLOCK"];
export const MODES = ["nag", "gate", "off"];

export function parseRuleset(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const title = (lines.find((l) => l.startsWith("# ")) || "").slice(2).trim();
  if (!title) throw new Error("ruleset: missing level-1 title");

  const sections = {};
  const order = [];
  let current = null;
  const preamble = [];
  for (const line of lines) {
    if (line.startsWith("# ")) continue;
    const m = /^## (.+)$/.exec(line);
    if (m) {
      current = m[1].trim();
      order.push(current);
      sections[current] = [];
      continue;
    }
    (current ? sections[current] : preamble).push(line);
  }
  for (const k of order) sections[k] = sections[k].join("\n").trim();

  const description = preamble
    .filter((l) => l.startsWith("> "))
    .map((l) => l.slice(2).trim())
    .join(" ");
  const catchphrase = (preamble.find((l) => /^\*[^*]+\*$/.test(l.trim())) || "").trim().replace(/^\*|\*$/g, "");

  const checklist = [];
  for (const line of (sections["The checklist"] || "").split("\n")) {
    const m = /^(\d+)\.\s+\*\*(.+?)\.\*\*\s+(.+)$/.exec(line);
    if (m) checklist.push({ n: Number(m[1]), title: m[2], text: m[3] });
  }

  const modes = [];
  for (const line of (sections["Modes"] || "").split("\n")) {
    const m = /^- `(\w+)`(?: \((.+?)\))?: (.+)$/.exec(line);
    if (m) modes.push({ name: m[1], note: m[2] || "", text: m[3] });
  }

  const commands = [];
  for (const line of (sections["Commands"] || "").split("\n")) {
    const m = /^\| `(.+?)` \| (.+?) \|$/.exec(line);
    if (m) commands.push({ usage: m[1].replace(/\\\|/g, "|"), name: m[1].split(" ")[0].replace("/", ""), text: m[2] });
  }

  const verdictExample = /```\n([\s\S]+?)\n```/.exec(sections["The verdict"] || "");

  return {
    title,
    description,
    catchphrase,
    sections,
    sectionOrder: order,
    checklist,
    modes,
    commands,
    verdicts: VERDICTS,
    verdictExample: verdictExample ? verdictExample[1] : "",
  };
}

export function loadRuleset(path = RULES_PATH) {
  return parseRuleset(readFileSync(path, "utf8"));
}

export function validateRuleset(rs) {
  const problems = [];
  if (rs.checklist.length !== 10) problems.push(`expected 10 checklist items, found ${rs.checklist.length}`);
  rs.checklist.forEach((item, i) => {
    if (item.n !== i + 1) problems.push(`checklist item ${i + 1} is numbered ${item.n}`);
  });
  for (const m of MODES) if (!rs.modes.some((x) => x.name === m)) problems.push(`mode ${m} missing`);
  for (const v of Object.values(PERSONA.verdicts || { a: "APPROVE", c: "REQUEST_CHANGES", b: "BLOCK" })) if (!(rs.sections["The verdict"] || "").includes("`" + v + "`")) problems.push(`verdict ${v} not documented`);
  for (const s of ["Character", "The checklist", "The verdict", "Non-negotiables", "Modes", "Self-review protocol", "Commands"]) {
    if (!rs.sections[s]) problems.push(`section "${s}" missing`);
  }
  if (rs.commands.length < 6) problems.push(`expected at least 6 commands, found ${rs.commands.length}`);
  if (!rs.catchphrase) problems.push("catchphrase missing");
  if (!rs.description) problems.push("description missing");
  return problems;
}
