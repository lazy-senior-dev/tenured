// Headless agent runners. Each returns { text, usage: {input, output}, costUsd, durationMs, model }.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeProvider } from "../../action/lib/providers.mjs";

const TIMEOUT_MS = 300_000;

function which(bin) {
  return new Promise((resolve) => {
    const p = spawn("sh", ["-c", `command -v ${bin}`], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => resolve(code === 0 && out.trim() ? out.trim() : null));
  });
}

function exec(cmd, args, { input, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      if (signal === "SIGKILL") return reject(new Error(`${cmd} timed out after ${TIMEOUT_MS / 1000}s`));
      resolve({ code, stdout, stderr, durationMs });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

const scratch = () => mkdtempSync(join(tmpdir(), "grumpy-bench-"));

// Claude Code reports every model it touched, including a small auxiliary call; the
// one that did the work is the one with the most tokens.
function mainModel(usage) {
  let best = null;
  for (const [name, u] of Object.entries(usage || {})) {
    const total = (u.inputTokens || 0) + (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0) + (u.outputTokens || 0);
    if (!best || total > best.total) best = { name, total };
  }
  return best ? best.name : null;
}

export const AGENTS = {
  claude: {
    label: "Claude Code",
    available: () => which("claude"),
    defaultModel: "claude-sonnet-5",
    async run({ system, user, model }) {
      const args = ["-p", "--safe-mode", "--no-session-persistence", "--max-turns", "1", "--tools", "", "--output-format", "json"];
      if (model) args.push("--model", model);
      if (system) args.push("--append-system-prompt", system);
      const res = await exec("claude", args, { input: user, cwd: scratch() });
      let data;
      try {
        data = JSON.parse(res.stdout.trim().split("\n").pop());
      } catch {
        throw new Error(`claude returned no JSON (exit ${res.code}): ${(res.stderr || res.stdout).slice(0, 300)}`);
      }
      if (data.is_error) throw new Error(`claude error: ${String(data.result).slice(0, 300)}`);
      const u = data.usage || {};
      return {
        text: data.result || "",
        usage: { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0 },
        costUsd: data.total_cost_usd,
        durationMs: res.durationMs,
        model: mainModel(data.modelUsage) || model || "default",
      };
    },
  },
  codex: {
    label: "Codex CLI",
    available: () => which("codex"),
    defaultModel: "",
    async run({ system, user, model }) {
      const args = ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "--ignore-user-config", "--color", "never", "--json"];
      if (model) args.push("-m", model);
      args.push("-");
      const prompt = system ? `# Reviewer instructions\n\n${system}\n\n# Task\n\n${user}` : user;
      const res = await exec("codex", args, { input: prompt, cwd: scratch() });
      let text = "";
      let usage = { input: 0, output: 0 };
      for (const line of res.stdout.split("\n")) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "item.completed" && ev.item?.type === "agent_message") text = ev.item.text || text;
        if (ev.type === "turn.completed" && ev.usage) usage = { input: ev.usage.input_tokens || 0, output: (ev.usage.output_tokens || 0) + (ev.usage.reasoning_output_tokens || 0) };
        if (ev.type === "error" || ev.type === "turn.failed") throw new Error(`codex: ${JSON.stringify(ev).slice(0, 300)}`);
      }
      if (!text) throw new Error(`codex returned no agent message (exit ${res.code}): ${res.stderr.slice(0, 300)}`);
      return { text, usage, costUsd: undefined, durationMs: res.durationMs, model: model || "codex-default" };
    },
  },
  agy: {
    label: "Antigravity CLI",
    available: () => which("agy"),
    defaultModel: "",
    async run({ system, user, model }) {
      // Plan mode denies file reads, and a denied search ends the turn with an empty response, so the
      // prompt says the whole change is inline. An empty reply is retried once before it counts as an error.
      const note = "\n\nThe complete change is above. Do not search or open files; answer from the diff.";
      const prompt = (system ? `# Reviewer instructions\n\n${system}\n\n# Task\n\n${user}` : user) + note;
      const args = ["-p", prompt, "--output-format", "json", "--disable-slash-commands", "--mode", "plan"];
      if (model) args.push("--model", model);
      let data, res, usage = { input: 0, output: 0 }, durationMs = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        res = await exec("agy", args, { cwd: scratch() });
        durationMs += res.durationMs;
        try {
          data = JSON.parse(res.stdout.trim().split("\n").pop());
        } catch {
          throw new Error(`agy returned no JSON (exit ${res.code}): ${(res.stderr || res.stdout).slice(0, 300)}`);
        }
        if (data.status && data.status !== "SUCCESS") throw new Error(`agy status ${data.status}: ${String(data.response || "").slice(0, 200)}`);
        const u = data.usage || {};
        usage.input += u.input_tokens || 0;
        usage.output += (u.output_tokens || 0) + (u.thinking_tokens || 0);
        if (String(data.response || "").trim()) break;
      }
      if (!String(data.response || "").trim()) {
        const denied = (data.denied_actions || []).map((d) => d.display_name || d.action).join(", ");
        throw new Error(`agy returned an empty response${denied ? ` after denied actions: ${denied}` : ""}`);
      }
      return {
        text: data.response,
        usage,
        costUsd: undefined,
        durationMs,
        model: model || "agy-default",
      };
    },
  },
  bob: {
    label: "IBM Bob Shell",
    available: async () => (process.env.BOB_API_KEY ? await which("bob") : null),
    defaultModel: "",
    async run({ system, user }) {
      // The whole change is in the prompt; every tool group is disabled so Bob answers instead of reading files.
      const prompt = (system ? `# Reviewer instructions\n\n${system}\n\n# Task\n\n${user}` : user) + "\n\nThe complete change is above. There are no files to open; answer from the diff.";
      const args = ["run", "--format", "stream-json", "--mode", "ask", "--max-turns", "2", "--disable-mcp", "--disable-subagents", "--disable-tool-groups", "read,edit,browser,command,mcp,subagent,modes", "--trust", "--accept-license"];
      const res = await exec("bob", args, { input: prompt, cwd: scratch() });
      let text = "";
      let usage = { input: 0, output: 0 };
      let cost;
      for (const line of res.stdout.split("\n")) {
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "message" && ev.role === "assistant") text += typeof ev.content === "string" ? ev.content : (ev.text || (Array.isArray(ev.content) ? ev.content.map((c) => c.text || "").join("") : ""));
        if (ev.type === "result") { usage = { input: ev.stats?.input_tokens || 0, output: ev.stats?.output_tokens || 0 }; cost = ev.stats?.session_costs; if (ev.status && ev.status !== "success") throw new Error(`bob status ${ev.status}`); }
      }
      if (!text.trim()) throw new Error(`bob returned no message (exit ${res.code}): ${(res.stderr || res.stdout).slice(0, 300)}`);
      return { text, usage, costUsd: cost, durationMs: res.durationMs, model: "bob-default" };
    },
  },
  api: {
    label: "Messages API",
    available: async () => (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : null),
    defaultModel: "",
    async run({ system, user, model }) {
      const provider = process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai";
      const p = makeProvider({ provider, model: model || undefined, apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY });
      const started = Date.now();
      const res = await p.complete(system || "You are a code reviewer.", user, { maxTokens: 2500 });
      return { text: res.text, usage: res.usage, costUsd: undefined, durationMs: Date.now() - started, model: res.model };
    },
  },
};

export async function availableAgents() {
  const out = [];
  for (const [name, agent] of Object.entries(AGENTS)) if (await agent.available()) out.push(name);
  return out;
}
