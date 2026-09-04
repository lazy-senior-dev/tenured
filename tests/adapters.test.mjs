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
