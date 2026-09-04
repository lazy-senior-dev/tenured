// Thin provider switch: one function, one request, plain text back.
// Each provider returns { text, usage: { input, output } }.

const DEFAULT_MODEL = { anthropic: "claude-sonnet-5", openai: "gpt-5" };

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

export function makeProvider({ provider, model, apiKey, fetchImpl = fetch, sleep }) {
  if (!["anthropic", "openai"].includes(provider)) throw new Error(`unknown provider "${provider}"; use anthropic or openai`);
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

  const call = provider === "anthropic" ? anthropic : openai;
  return {
    name: provider,
    model: resolvedModel,
    complete: (system, user, { maxTokens = 2000 } = {}) => withRetry(() => call(system, user, maxTokens), { sleep }),
  };
}
