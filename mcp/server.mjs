#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Sandeep Bazar
// SPDX-License-Identifier: Apache-2.0
// Model Context Protocol server, spoken over stdio as newline-delimited JSON-RPC 2.0. It exposes
// the same review the CLI and the hook use, so any MCP client (VS Code, Claude Desktop, Cursor,
// Zed, Windsurf, and the rest) gets the persona without a host-specific adapter. No dependencies:
// the protocol here is small enough to write out.
//   node mcp/server.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, availableAgents } from "../benchmarks/lib/agents.mjs";
import { lastVerdict } from "../hooks/lib/verdict.mjs";
import { withHousePolicy } from "../hooks/lib/config.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = JSON.parse(readFileSync(join(ROOT, "persona.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const SYSTEM = (cwd) => withHousePolicy(readFileSync(join(ROOT, "hooks", "persona.md"), "utf8"), cwd) + "\n\nPrint the verdict block and nothing else.";
const WHO = P.asName || P.name;

// Protocol revisions this server implements, newest first.
const SUPPORTED = ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"];

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
const text = (s) => ({ content: [{ type: "text", text: s }] });
// Structured output alongside the text block: clients that understand outputSchema read the object,
// everything else reads the same JSON as text.
const structured = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }], structuredContent: obj });
const errorText = (s) => ({ content: [{ type: "text", text: s }], isError: true });

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    level: { type: ["string", "null"], enum: ["APPROVE", "REQUEST_CHANGES", "BLOCK", null], description: "The verdict in canonical form, the same across every persona, so a script can gate on it." },
    word: { type: ["string", "null"], description: `The word this persona prints: ${P.verdicts.approve}, ${P.verdicts.changes}, or ${P.verdicts.block}.` },
    files: { type: "array", items: { type: "string" }, description: "Files the verdict covers, when it names them." },
    findings: { type: "array", items: { type: "object", properties: { n: { type: "number" }, file: { type: "string" }, line: { type: ["number", "null"] }, failure: { type: "string" }, fix: { type: "string" }, raw: { type: "string" } } } },
  },
  required: ["level", "findings"],
};

const TOOLS = [
  {
    name: `${P.command}_review_brief`,
    description: `Ask for the review yourself. Returns the change plus ${WHO}'s ruleset and the exact verdict format, for you to review with your own model. No API key, no agent installed, no second model, and no network call: everything needed to perform the review comes back in one response. Use this first; the other review tools exist for a second opinion from a different model.`,
    annotations: { title: "Get the change and the ruleset to review yourself", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        diff: { type: "string", description: "A unified diff to review. Omit it to read the repository's staged changes instead." },
        path: { type: "string", description: "Repository to read when diff is omitted. Defaults to the current directory." },
        unstaged: { type: "boolean", description: "Include unstaged changes when reading from a repository." },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        ruleset: { type: "string", description: "The persona card, including any house rules the repository adds." },
        diff: { type: "string" },
        lines: { type: "number" },
        format: { type: "string", description: "The exact shape the verdict block must take." },
        instructions: { type: "string" },
      },
      required: ["ruleset", "diff", "format", "instructions"],
    },
  },
  {
    name: `${P.command}_review_diff`,
    description: `Review a unified diff as ${WHO}. Returns the verdict block: ${P.verdictPrefix} followed by ${P.verdicts.approve}, ${P.verdicts.changes}, or ${P.verdicts.block}, then one numbered finding per line as file:line — what breaks — the smallest fix. Use this before writing or committing a change.`,
    annotations: { title: "Review a diff", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: "object", properties: { diff: { type: "string", description: "The unified diff to review." }, agent: { type: "string", description: "Headless agent to review with: claude, codex, agy, bob, or api. Defaults to the first one installed." } }, required: ["diff"] },
  },
  {
    name: `${P.command}_review_staged`,
    description: `Review the staged changes of a git repository as ${WHO}. Returns the same verdict block.`,
    annotations: { title: "Review the staged changes", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Path to the repository. Defaults to the current directory." }, unstaged: { type: "boolean", description: "Include unstaged changes as well." }, agent: { type: "string" } } },
  },
  {
    name: `${P.command}_review_pr`,
    description: `Review a pull request as ${WHO}, fetched with the GitHub CLI. Returns the same verdict block.`,
    annotations: { title: "Review a pull request", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: "object", properties: { pr: { type: "string", description: "Pull request number or URL." }, path: { type: "string", description: "Repository the gh command runs in." }, agent: { type: "string" } }, required: ["pr"] },
  },
  {
    name: `${P.command}_parse_verdict`,
    description: `Turn a verdict block into JSON: the level (${P.verdicts.approve}, ${P.verdicts.changes}, ${P.verdicts.block}), the files it covers, and each finding. Use it to gate a commit or a merge on the verdict rather than on prose.`,
    annotations: { title: "Parse a verdict block", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: VERDICT_SCHEMA,
    inputSchema: { type: "object", properties: { text: { type: "string", description: "Text containing a verdict block." } }, required: ["text"] },
  },
];

async function review(diff, label, wanted, cwd = process.cwd()) {
  if (!diff.trim()) return text("Nothing to review.");
  if (diff.length > 400_000) return errorText(`That diff is ${Math.round(diff.length / 1000)} KB. ${P.name} reads everything, but not that; review it in batches.`);
  const available = await availableAgents();
  const name = wanted && AGENTS[wanted] ? wanted : available[0];
  if (!name || (wanted && !available.includes(wanted))) return errorText(`No headless agent found${wanted ? ` for "${wanted}"` : ""}. Install and sign in to one of: claude, codex, agy, bob (with BOB_API_KEY); or set ANTHROPIC_API_KEY.`);
  const agent = AGENTS[name];
  const res = await agent.run({ system: SYSTEM(cwd), user: `Review this change as ${WHO}. It is the ${label}.\n\n${diff}\n\nEverything the review needs is above. Do not search or open files; answer from what is here.`, model: agent.defaultModel || "" });
  const v = lastVerdict(res.text);
  const head = v ? `${v.label}\n` : "";
  return text(`${head}${res.text.trim()}\n\n— reviewed with ${agent.label}${res.costUsd != null ? `, $${res.costUsd.toFixed(4)}` : ""}`);
}

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });

function stagedDiff(a) {
  const cwd = a.path || process.cwd();
  return a.unstaged ? git(cwd, ["diff"]) + git(cwd, ["diff", "--cached"]) : git(cwd, ["diff", "--cached"]);
}

async function call(name, a = {}) {
  const short = name.replace(`${P.command}_`, "");
  if (short === "review_brief") {
    let diff = String(a.diff || "");
    if (!diff.trim()) {
      try { diff = stagedDiff(a); } catch (err) { return errorText(`No diff was given and the staged changes could not be read: ${String(err.message).split("\n")[0]}`); }
    }
    if (!diff.trim()) return errorText("Nothing to review: no diff was given and there are no staged changes.");
    return structured({
      ruleset: SYSTEM(a.path || process.cwd()),
      diff,
      lines: diff.split("\n").length,
      format: `${P.verdictPrefix}: ${P.verdicts.approve} | ${P.verdicts.changes} | ${P.verdicts.block}, then one numbered finding per line as "file:line — what breaks in production — the smallest fix". ${P.verdicts.approve} names the files it covers and is followed by "${P.approveWord}" and nothing else.`,
      instructions: `Review the diff above as ${WHO}, following the ruleset exactly. Answer the checklist in writing, then print the verdict block in the format given. Then call ${P.command}_parse_verdict on your own answer if something downstream needs to gate on it.`,
    });
  }
  if (short === "review_diff") return review(String(a.diff || ""), "diff", a.agent);
  if (short === "review_staged") {
    const cwd = a.path || process.cwd();
    try {
      return review(stagedDiff(a), a.unstaged ? "working tree" : "staged changes", a.agent, cwd);
    } catch (err) { return errorText(`Could not read the diff in ${cwd}: ${String(err.message).split("\n")[0]}`); }
  }
  if (short === "review_pr") {
    try { return review(execFileSync("gh", ["pr", "diff", String(a.pr)], { cwd: a.path || process.cwd(), encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }), `pull request ${a.pr}`, a.agent); }
    catch (err) { return errorText(`Could not read pull request ${a.pr} (is gh installed and signed in?): ${String(err.message).split("\n")[0]}`); }
  }
  if (short === "parse_verdict") {
    const v = lastVerdict(String(a.text || ""));
    const word = v ? { APPROVE: P.verdicts.approve, REQUEST_CHANGES: P.verdicts.changes, BLOCK: P.verdicts.block }[v.verdict] || null : null;
    return structured(v ? { level: v.verdict, word, files: v.files || [], findings: v.findings || [] } : { level: null, word: null, files: [], findings: [] });
  }
  return errorText(`Unknown tool ${name}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const { id, method, params } = msg;
    try {
      if (method === "initialize") {
        // Answer with the revision the client asked for when we implement it, otherwise with ours.
        const asked = params?.protocolVersion;
        const version = SUPPORTED.includes(asked) ? asked : SUPPORTED[0];
        ok(id, { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: { name: P.slug, title: `${P.name}, ${P.tagline}`, version: pkg.version }, instructions: `Call ${P.command}_review_diff or ${P.command}_review_staged before writing or committing a change, and ${P.command}_parse_verdict to turn the answer into JSON you can gate on. ${P.name} reviews; he never edits.` });
      }
      else if (method === "notifications/initialized" || method === "notifications/cancelled") { /* no reply */ }
      else if (method === "ping") ok(id, {});
      else if (method === "tools/list") ok(id, { tools: TOOLS });
      else if (method === "tools/call") ok(id, await call(params?.name, params?.arguments));
      else if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
    } catch (err) {
      if (id !== undefined) fail(id, -32603, String(err && err.message ? err.message : err));
    }
  }
});
process.stdin.on("end", () => process.exit(0));
