// Author tier: the agent is the author. It gets a ticket and a small repository and has to ship the
// change itself, with and without the persona loaded. Each agent runs in its headless write mode
// inside a scratch copy of the task's scaffold; the shipped diff is scored by the task's fixed checks.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BENCH_ROOT } from "./cases.mjs";

const P = JSON.parse(readFileSync(join(BENCH_ROOT, "..", "persona.json"), "utf8"));
const persona = () => readFileSync(join(BENCH_ROOT, "..", "hooks", "persona.md"), "utf8");

const FOOT = "\n\nMake the change in this repository. Edit the files directly and do not ask questions; there is nobody to answer. Do not run the application or install packages.";

export const ARMS = {
  bare: { label: "no skill", prompt: (task) => `${task}${FOOT}` },
  generic: { label: "generic care prompt", prompt: (task) => `You are a careful senior engineer. Write secure, correct, production-quality code, and check your change for bugs and security problems before you finish.\n\n${task}${FOOT}` },
  // The gate arm is the product: the agent writes with the card loaded, the CLI reviews the staged
  // diff, and on anything but the approving verdict the findings go back to the agent to fix. It is
  // the only arm where something outside the model decides whether the change is done.
  gate: { label: `${P.slug} + gate`, gated: true, prompt: (task) => ARMS.grump.prompt(task) },
  grump: { label: P.slug, prompt: (task) => `# Your reviewer\n\nYou are the author of the change below. ${P.name} is the reviewer who looks at it before it ships; the reviewer's rules follow. The rule that the reviewer never writes code applies to the reviewer, not to you: you write the change, then you review it as ${P.asName || P.name}.\n\n${persona()}\n\n# Task\n\n${task}${FOOT} Before you finish, review your own change as ${P.asName || P.name}: answer the checklist in writing and print the verdict block. On ${P.verdicts.changes} or ${P.verdicts.block}, fix the findings and review again until the verdict is ${P.verdicts.approve}.` },
};

function run(cmd, args, { cwd, input, env = process.env, timeoutMs = 600_000 }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + e.message, durationMs: Date.now() - started }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, durationMs: Date.now() - started }); });
    child.stdin.end(input == null ? "" : input);
  });
}

const which = (bin) => { try { execFileSync("which", [bin], { stdio: "pipe" }); return true; } catch { return false; } };

export const AUTHORS = {
  claude: {
    label: "Claude Code",
    defaultModel: "claude-sonnet-5",
    available: () => which("claude"),
    async write({ prompt, cwd, model }) {
      const args = ["-p", prompt, "--output-format", "json", "--permission-mode", "acceptEdits", "--allowedTools", "Edit", "Write", "MultiEdit", "Read", "Glob", "Grep", "LS"];
      if (model) args.push("--model", model);
      const res = await run("claude", args, { cwd });
      let data = {};
      try { data = JSON.parse(res.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop() || "{}"); } catch { /* keep raw */ }
      const mu = data.modelUsage || {};
      const top = Object.entries(mu).sort((a, b) => ((b[1].outputTokens || 0) + (b[1].inputTokens || 0)) - ((a[1].outputTokens || 0) + (a[1].inputTokens || 0)))[0];
      const u = data.usage || {};
      return { text: data.result || res.stdout, usage: { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0 }, costUsd: data.total_cost_usd, model: top ? top[0] : model || "claude-default", durationMs: res.durationMs, exit: res.code, stderr: res.stderr.slice(0, 500) };
    },
  },
  codex: {
    label: "Codex CLI",
    available: () => which("codex"),
    async write({ prompt, cwd, model }) {
      const args = ["exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", "-C", cwd];
      if (model) args.push("--model", model);
      args.push(prompt);
      const res = await run("codex", args, { cwd });
      let text = "", usage = { input: 0, output: 0 }, mdl = model || "codex-default";
      for (const line of res.stdout.split("\n")) {
        if (!line.startsWith("{")) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "item.completed" && ev.item?.type === "agent_message") text += (ev.item.text || "") + "\n";
        if (ev.type === "turn.completed" && ev.usage) usage = { input: ev.usage.input_tokens || 0, output: (ev.usage.output_tokens || 0) + (ev.usage.reasoning_output_tokens || 0) };
        if (ev.type === "thread.started" && ev.model) mdl = ev.model;
      }
      return { text: text.trim() || res.stdout.slice(-2000), usage, costUsd: undefined, model: mdl, durationMs: res.durationMs, exit: res.code, stderr: res.stderr.slice(0, 500) };
    },
  },
  agy: {
    label: "Antigravity CLI",
    available: () => which("agy"),
    async write({ prompt, cwd, model }) {
      // Tools are pre-approved because headless mode cannot ask, and the working tree here is a
      // scratch copy of the task scaffold in the system temp directory, not a real repository.
      const args = ["-p", prompt, "--output-format", "json", "--mode", "accept-edits", "--dangerously-skip-permissions", "--disable-slash-commands", "--print-timeout", "15m"];
      if (model) args.push("--model", model);
      const res = await run("agy", args, { cwd, timeoutMs: 1_000_000 });
      let data = {};
      try { data = JSON.parse(res.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop() || "{}"); } catch { /* keep raw */ }
      const u = data.usage || {};
      return { text: data.response || res.stdout, usage: { input: u.input_tokens || 0, output: (u.output_tokens || 0) + (u.thinking_tokens || 0) }, costUsd: undefined, model: model || "agy-default", durationMs: res.durationMs, exit: res.code, stderr: res.stderr.slice(0, 500) };
    },
  },
  // Any other agent. Set LSD_AGENT_CMD to a command that reads the prompt on stdin, edits files in
  // the working directory, and writes whatever it likes to stdout, for example:
  //   LSD_AGENT_CMD="my-agent --write --cwd ." npm run bench:author -- --agents any
  // LSD_AGENT_LABEL names it in the tables and LSD_AGENT_ARGS adds arguments. Nothing else in the
  // benchmark knows which agent it is talking to.
  any: {
    label: process.env.LSD_AGENT_LABEL || "custom agent",
    available: () => !!process.env.LSD_AGENT_CMD,
    async write({ prompt, cwd }) {
      const parts = (process.env.LSD_AGENT_CMD || "").split(" ").filter(Boolean).concat((process.env.LSD_AGENT_ARGS || "").split(" ").filter(Boolean));
      if (!parts.length) throw new Error("set LSD_AGENT_CMD to the command that runs your agent");
      const res = await run(parts[0], parts.slice(1), { cwd, input: prompt });
      return { text: res.stdout || res.stderr, usage: { input: 0, output: 0 }, costUsd: undefined, model: process.env.LSD_AGENT_MODEL || "custom", durationMs: res.durationMs, exit: res.code, stderr: res.stderr.slice(0, 500) };
    },
  },
  bob: {
    label: "IBM Bob Shell",
    available: () => which("bob") && !!process.env.BOB_API_KEY,
    async write({ prompt, cwd, model }) {
      const args = ["run", "--format", "stream-json", "--mode", "agent", "--max-turns", "40", "--disable-mcp", "--disable-subagents", "--trust", "--accept-license"];
      if (model) args.push("--model", model);
      const res = await run("bob", args, { cwd, input: prompt });
      let text = "", cost;
      for (const line of res.stdout.split("\n")) {
        if (!line.startsWith("{")) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "message" && ev.role === "assistant") text += typeof ev.content === "string" ? ev.content : (ev.content || []).map((c) => c.text || "").join("");
        if (ev.type === "result") cost = ev.stats?.session_costs;
      }
      return { text: text.trim(), usage: { input: 0, output: 0 }, costUsd: cost, model: model || "bob-default", durationMs: res.durationMs, exit: res.code, stderr: res.stderr.slice(0, 500) };
    },
  },
};

export async function availableAuthors() {
  const out = [];
  for (const [k, a] of Object.entries(AUTHORS)) if (await a.available()) out.push(k);
  return out;
}

export function loadTasks(root = join(BENCH_ROOT, "author", "tasks")) {
  return readdirSync(root).filter((d) => existsSync(join(root, d, "TASK.md"))).sort().map((id) => ({ id, dir: join(root, id), task: readFileSync(join(root, id, "TASK.md"), "utf8").trim() }));
}
