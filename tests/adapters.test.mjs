import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadRuleset } from "../scripts/lib/ruleset.mjs";
import { renderAll, ROOT, personaCard, P } from "../scripts/lib/render.mjs";

const rs = loadRuleset();
const files = renderAll(rs);

test("every adapter on disk is byte-identical to a fresh render", () => {
  for (const [rel, content] of files) {
    assert.ok(existsSync(join(ROOT, rel)), rel + " missing; run npm run build");
    assert.equal(readFileSync(join(ROOT, rel), "utf8"), content, rel + " is stale; run npm run build");
  }
});

test("rendering is deterministic", () => {
  const again = renderAll(rs);
  assert.deepEqual([...again.entries()], [...files.entries()]);
});

test("every JSON adapter parses and carries the package version", () => {
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  for (const [rel, content] of files) {
    if (!rel.endsWith(".json")) continue;
    const parsed = JSON.parse(content);
    if (/plugin\.json$|marketplace\.json$|gemini-extension\.json$/.test(rel) && !rel.startsWith(".agents/")) {
      const v = parsed.version ?? parsed.metadata?.version ?? parsed.plugins?.[0]?.version;
      assert.equal(v, version, rel + " version");
    }
  }
});

test("rules files respect the smallest host limit (Windsurf, 12000 chars)", () => {
  for (const [rel, content] of files) {
    if (/^\.(windsurf|cursor|clinerules|kiro|qoder)\//.test(rel) || rel === "AGENTS.md" || rel === "GEMINI.md") {
      assert.ok(content.length < 12000, `${rel} is ${content.length} chars`);
    }
  }
  assert.ok(personaCard(rs).length < 7000, "persona card should stay small; it is injected every turn");
});

test("every command has a skill, a Gemini command, and an OpenCode command", () => {
  for (const c of rs.commands) {
    assert.ok(files.has(`skills/${c.name}/SKILL.md`), c.name);
    assert.ok(files.has(`commands/${c.name}.toml`), c.name);
    assert.ok(files.has(`.opencode/command/${c.name}.md`), c.name);
  }
});

test("skills have valid frontmatter and never invite code edits except grumpy-fix", () => {
  for (const c of rs.commands) {
    const skill = files.get(`skills/${c.name}/SKILL.md`);
    const fm = /^---\n([\s\S]+?)\n---\n/.exec(skill);
    assert.ok(fm, c.name + " frontmatter");
    assert.match(fm[1], new RegExp(`^name: ${c.name}$`, "m"));
    assert.match(fm[1], /^description: /m);
    if (c.name !== `${P.command}-fix`) assert.ok(!/allowed-tools: .*\bEdit\b/.test(fm[1]), c.name + " must not pre-approve Edit");
  }
});

test("the hooks manifest points at scripts that exist", () => {
  const hooks = JSON.parse(files.get("hooks/hooks.json"));
  for (const event of Object.values(hooks.hooks)) {
    for (const group of event) {
      for (const h of group.hooks) {
        const m = /hooks\/([\w-]+\.mjs)/.exec(h.command);
        assert.ok(m && existsSync(join(ROOT, "hooks", m[1])), h.command);
      }
    }
  }
  assert.match(hooks.hooks.PreToolUse[0].matcher, /Edit\|Write/);
});

test("the OpenCode plugin is valid JavaScript that exports a plugin", async () => {
  const mod = await import(join(ROOT, `.opencode/plugins/${P.command}.mjs`));
  const plugin = await mod[P.displayName.replace(/[^A-Za-z0-9]/g, "")]();
  assert.equal(typeof plugin["tool.execute.before"], "function");
  assert.equal(typeof plugin["experimental.chat.system.transform"], "function");
  const output = { system: [] };
  process.env.GRUMPY_MODE = "nag";
  await plugin["experimental.chat.system.transform"]({}, output);
  assert.match(output.system[0], /Review mode: nag/);
  process.env.GRUMPY_MODE = "gate";
  const args = { args: { filePath: "x.ts" } };
  await assert.rejects(() => plugin["tool.execute.before"]({ tool: "edit", sessionID: "s" }, args), /stopped this write/);
  await plugin["tool.execute.before"]({ tool: "edit", sessionID: "s" }, args);
  await plugin["tool.execute.before"]({ tool: "read", sessionID: "s" }, args);
  delete process.env.GRUMPY_MODE;
});

test("banned reviewer words never appear in the Grump's instructions", () => {
  for (const rel of ["AGENTS.md", "hooks/persona.md", `.cursor/rules/${P.command}.mdc`]) {
    const text = files.get(rel).toLowerCase();
    // the words are allowed only inside the sentence that bans them
    const stripped = text.replace(/you never write[^\n]+/g, "");
    for (const word of ["nice work", "great job", "looks good", "minor nit"]) assert.ok(!stripped.includes(word), `${rel}: ${word}`);
  }
});

test("the MCP server speaks the protocol and names its tools after the persona", async () => {
  const { execFileSync } = await import("node:child_process");
  const input = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: `${P.command}_parse_verdict`, arguments: { text: `${P.verdictPrefix}: ${P.verdicts.block}\n1. app/api/users.py:12 — the id comes from the body — take it from the session` } } }),
    JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } }),
  ].join("\n") + "\n";
  const out = execFileSync(process.execPath, ["mcp/server.mjs"], { input, encoding: "utf8", cwd: ROOT });
  const msgs = out.trim().split("\n").map((l) => JSON.parse(l));
  const byId = Object.fromEntries(msgs.filter((m) => m.id !== undefined).map((m) => [m.id, m]));
  assert.equal(msgs.filter((m) => m.id === undefined).length, 0, "a notification must not be answered");
  assert.equal(byId[1].result.serverInfo.name, P.slug);
  assert.ok(byId[1].result.capabilities.tools, "tools capability");
  const names = byId[2].result.tools.map((t) => t.name);
  for (const suffix of ["review_brief", "review_diff", "review_staged", "review_pr", "parse_verdict"]) {
    assert.ok(names.includes(`${P.command}_${suffix}`), `missing tool ${suffix}: ${names.join(", ")}`);
  }
  for (const tool of byId[2].result.tools) {
    assert.equal(tool.inputSchema.type, "object", `${tool.name} schema`);
    assert.ok(tool.description.length > 40, `${tool.name} needs a description a client can act on`);
  }
  const brief = byId[2].result.tools.find((x) => x.name === `${P.command}_review_brief`);
  assert.ok(brief.outputSchema, "the brief has to declare what it returns so a client can rely on it");
  assert.equal(brief.annotations.readOnlyHint, true);
  assert.match(brief.description, /No API key/, "the point of the brief is that it needs nothing installed");
  const parsed = JSON.parse(byId[3].result.content[0].text);
  assert.deepEqual(byId[3].result.structuredContent, parsed, "structured output and the text block must agree");
  assert.equal(parsed.level, "BLOCK");
  assert.equal(parsed.word, P.verdicts.block);
  assert.equal(parsed.findings.length, 1);
  assert.equal(byId[4].result.isError, true, "an unknown tool is an error, not a crash");
});
