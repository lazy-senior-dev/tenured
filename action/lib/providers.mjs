// Thin provider switch: one function, one request, plain text back.
// Each provider returns { text, usage: { input, output } }.

import { spawn } from "node:child_process";

const DEFAULT_MODEL = { anthropic: "claude-sonnet-5", openai: "gpt-5", bob: "bob-default" };

export function defaultModel(provider) {
  return DEFAULT_MODEL[provider];
}

async function withRetry(fn, { attempts = 4, baseMs = 1500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!err.retryable || i === attempts - 1) throw err;
      const wait = err.retryAfterMs ?? baseMs * 2 ** i;
      await sleep(Math.min(wait, 60_000));
    }
  }
  throw last;
}

function httpError(status, body, headers) {
  const err = new Error(`provider HTTP ${status}: ${String(body).slice(0, 300)}`);
  err.status = status;
  err.retryable = status === 429 || status === 529 || status >= 500;
  const ra = headers?.get?.("retry-after");
  if (ra && !Number.isNaN(Number(ra))) err.retryAfterMs = Number(ra) * 1000;
  return err;
}

// The Bob CLI streams one JSON object per line; assistant text arrives as many small "message"
// events and the run ends with a "result" event carrying the session cost.
export function parseBobStream(stdout) {
  let text = "";
  let cost;
  let status;
  for (const line of String(stdout).split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (ev.type === "message" && ev.role === "assistant") text += typeof ev.content === "string" ? ev.content : (ev.content || []).map((c) => c.text || "").join("");
    if (ev.type === "result") { status = ev.status; cost = ev.stats?.session_costs; }
  }
  return { text: text.trim(), cost, status };
}

export function makeProvider({ provider, model, apiKey, fetchImpl = fetch, sleep, spawnImpl = spawn, env = process.env }) {
  if (!["anthropic", "openai", "bob"].includes(provider)) throw new Error(`unknown provider "${provider}"; use anthropic, openai, or bob`);
  if (!apiKey) throw new Error(`no API key for provider ${provider}`);
  const resolvedModel = model || defaultModel(provider);

  async function anthropic(system, user, maxTokens) {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: resolvedModel, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw httpError(res.status, await res.text(), res.headers);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return { text, usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 }, model: data.model || resolvedModel };
  }

  async function openai(system, user, maxTokens) {
    const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: resolvedModel, max_completion_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!res.ok) throw httpError(res.status, await res.text(), res.headers);
    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
      model: data.model || resolvedModel,
    };
  }

  // IBM Bob: the whole change is in the prompt, every tool group is off, and the CLI answers from it.
  function bob(system, user) {
    return new Promise((resolve, reject) => {
      const args = ["run", "--format", "stream-json", "--mode", "ask", "--max-turns", "2", "--disable-mcp", "--disable-subagents", "--disable-tool-groups", "read,edit,browser,command,mcp,subagent,modes", "--trust", "--accept-license"];
      if (model) args.push("--model", model);
      const child = spawnImpl("bob", args, { env: { ...env, BOB_API_KEY: apiKey }, stdio: ["pipe", "pipe", "pipe"] });
      let out = "", errText = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { errText += d; });
      child.on("error", (e) => reject(new Error(`bob could not start: ${e.message}. Install it with npm i -g bobshell`)));
      child.on("close", (code) => {
        const parsed = parseBobStream(out);
        if (!parsed.text) { const err = new Error(`bob returned no message (exit ${code}): ${(errText || out).slice(0, 300)}`); err.retryable = code !== 0; return reject(err); }
        resolve({ text: parsed.text, usage: { input: 0, output: 0 }, costUsd: parsed.cost, model: model || "bob-default" });
      });
      child.stdin.end(`${system}\n\n${user}\n\nThe complete change is above. There are no files to open; answer from the diff.`);
    });
  }

  const call = provider === "anthropic" ? anthropic : provider === "openai" ? openai : bob;
  return {
    name: provider,
    model: resolvedModel,
    complete: (system, user, { maxTokens = 2000 } = {}) => withRetry(() => call(system, user, maxTokens), { sleep }),
  };
}
