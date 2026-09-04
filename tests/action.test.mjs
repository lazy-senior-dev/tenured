import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { anchorLine, rightSideLines, numberedPatch } from "../action/lib/diff.mjs";
import { globToRegExp, isIgnored, parseGlobs } from "../action/lib/glob.mjs";
import { makeProvider } from "../action/lib/providers.mjs";
import { selectFiles, composeReview, overallVerdict, run, readInputs, MARKER } from "../action/review.mjs";
const P_ = JSON.parse(readFileSync(new URL("../persona.json", import.meta.url), "utf8"));
const TF_ = P_.test || {};
// F maps the fixture file names into the persona's scope; T maps the Grump's words into the persona's.
const F = (p) => (TF_.ext ? p.replace(/\.(py|ts|go)$/, TF_.ext).replace(/^(?!\/)(?!src\/)/, TF_.dir + "/").replace(/^src\//, TF_.dir + "/").replace(/^\/repo\/src\//, "/repo/" + TF_.dir + "/") : p);
const T = (s) => {
  const pairs = [["GRUMP:", P_.verdictPrefix + ":"], ["REQUEST_CHANGES", P_.verdicts.changes], ["APPROVE", P_.verdicts.approve], ["BLOCK", P_.verdicts.block], ["Fine.", P_.approveWord]];
  for (const [a, b] of pairs) s = s.replace(new RegExp(a.replace(/[.]/g, "\\.") + (/[A-Z_]+$/.test(a) ? "\\b" : ""), "gi"), (m) => (m === m.toLowerCase() && a !== "Fine." ? b.toLowerCase() : b));
  return s.replace(/(\/?(?:repo\/)?(?:src\/)?[ab]\.(?:py|ts|go))(?=[:\s,]|$)/g, (m) => F(m));
};


const PATCH = `@@ -10,6 +10,9 @@ def get_user(request):
     session = request.session
-    user_id = session["user_id"]
+    user_id = request.json["user_id"]
+    row = db.fetch_one("select * from users where id = %s", (user_id,))
+    return jsonify(row)
     log.info("lookup")
`;

test("rightSideLines and anchorLine follow the new-file numbering", () => {
  const lines = rightSideLines(PATCH);
  assert.equal(lines.get(11), "add");
  assert.equal(lines.get(13), "add");
  assert.equal(lines.get(14), "context");
  assert.equal(lines.get(10), "context");
  assert.equal(anchorLine(PATCH, 11), 11);
  assert.equal(anchorLine(PATCH, 15), 13);
  assert.equal(anchorLine(PATCH, 40), null);
  assert.equal(anchorLine("", 1), null);
  assert.match(numberedPatch(PATCH), /^ {3}11 \+ {4}user_id = request\.json/m);
});

test("globs", () => {
  assert.ok(globToRegExp("**/*.lock").test("a/b/yarn.lock"));
  assert.ok(globToRegExp("**/*.lock").test("yarn.lock"));
  assert.ok(globToRegExp("docs/**").test("docs/a/b.md"));
  assert.ok(!globToRegExp("docs/**").test("src/docs.md"));
  assert.ok(globToRegExp("*.{png,svg}").test("x.svg"));
  assert.ok(isIgnored("vendor/x.go", parseGlobs("vendor/**, docs/**")));
  assert.deepEqual(parseGlobs("a\n# comment\nb,c"), ["a", "b", "c"]);
  assert.deepEqual(parseGlobs("**/*.{js,ts}, docs/**"), ["**/*.{js,ts}", "docs/**"]);
  assert.ok(isIgnored("src/a.ts", parseGlobs("**/*.{js,ts}")));
});

function fakeServer({ files, reviews = [], comments = [], issueComments = [], providerText, providerStatuses = [] }) {
  const calls = [];
  const state = { reviews: [...reviews], comments: [...comments], issueComments: [...issueComments], nextId: 900 };
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname + u.search, body });
    if (u.hostname === "api.anthropic.com") {
      const status = providerStatuses.shift();
      if (status) return new Response("slow down", { status, headers: { "retry-after": "0" } });
      const text = typeof providerText === "function" ? providerText(body) : providerText;
      return json(200, { model: body.model, content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 20 } });
    }
    if (u.hostname === "api.openai.com") {
      return json(200, { model: body.model, choices: [{ message: { content: providerText } }], usage: { prompt_tokens: 50, completion_tokens: 10 } });
    }
    const p = u.pathname;
    if (method === "GET" && /\/pulls\/\d+\/files$/.test(p)) return json(200, files);
    if (method === "GET" && /\/pulls\/\d+\/reviews$/.test(p)) return json(200, state.reviews);
    if (method === "GET" && /\/pulls\/\d+\/comments$/.test(p)) return json(200, state.comments);
    if (method === "GET" && /\/issues\/\d+\/comments$/.test(p)) return json(200, state.issueComments);
    if (method === "POST" && /\/pulls\/\d+\/reviews$/.test(p)) {
      const r = { id: state.nextId++, body: body.body, state: body.event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED" };
      state.reviews.push(r);
      return json(200, r);
    }
    if (method === "PUT" && /\/reviews\/\d+$/.test(p)) return json(200, { id: Number(p.split("/").pop()), body: body.body });
    if (method === "PUT" && /\/dismissals$/.test(p)) return json(200, { state: "DISMISSED" });
    if (method === "POST" && /\/pulls\/\d+\/comments$/.test(p)) {
      const c = { id: state.nextId++, body: body.body, path: body.path, line: body.line };
      state.comments.push(c);
      return json(201, c);
    }
    if (method === "DELETE" && /\/pulls\/comments\/\d+$/.test(p)) {
      state.comments = state.comments.filter((c) => c.id !== Number(p.split("/").pop()));
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && /\/issues\/\d+\/comments$/.test(p)) {
      const c = { id: state.nextId++, body: body.body };
      state.issueComments.push(c);
      return json(201, c);
    }
    return json(404, { message: `unhandled ${method} ${p}T(` });
  };
  return { fetchImpl, calls, state };
}

const FILES = [
  { filename: "src/api/users.py", status: "modified", additions: 3, deletions: 1, patch: PATCH },
  { filename: "package-lock.json", status: "modified", additions: 400, deletions: 300, patch: "@@ -1 +1 @@\n-a\n+b" },
  { filename: "assets/model.bin", status: "added", additions: 0, deletions: 0 },
  { filename: "README.md", status: "modified", additions: 1, deletions: 0, patch: "@@ -1,2 +1,3 @@\n # x\n+more\n y" },
];

const inputsFor = (over = {}) =>
  readInputs({ INPUT_MODE: "nag", INPUT_PROVIDER: "anthropic", INPUT_MAX_FILES: "25", ANTHROPIC_API_KEY: "k", GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "acme/app", GITHUB_EVENT_PATH: "/dev/null", ...over });

const event = (fork = false) => ({
  pull_request: { number: 7, head: { sha: "abc123", repo: { full_name: fork ? "someone/app" : "acme/app" } }, base: { repo: { full_name: "acme/app" } } },
});

const VERDICT_FOR = (body) =>
  body.messages[0].content.includes("users.py")
    ? T("GRUMP: BLOCK\n1. src/api/users.py:11 — user_id comes from the body, so any caller can read any user — take it from the session\n2. src/api/users.py:99 — outside the diff — none")
    : T("GRUMP: APPROVE\nFine.");

test("selectFiles drops ignored and patch-less files and keeps the largest first", () => {
  const { reviewed, skipped } = selectFiles(FILES, { maxFiles: 1, ignore: [] });
  assert.deepEqual(reviewed.map((f) => f.filename), ["src/api/users.py"]);
  assert.deepEqual(skipped.map((s) => s.why).sort(), ["ignored", "no text patch (binary or too large)", "over the 1 file limit"]);
});

test("first run: one review, anchored comments, unanchored findings in the summary, nag posts COMMENT", async () => {
  const srv = fakeServer({ files: FILES, providerText: VERDICT_FOR });
  const out = await run({ inputs: inputsFor(), event: event(), fetchImpl: srv.fetchImpl, log: () => {} });
  assert.equal(out.status, "reviewed");
  assert.equal(out.verdict, "BLOCK");
  assert.equal(out.failed, false);
  const create = srv.calls.find((c) => c.method === "POST" && c.path.endsWith("/reviews"));
  assert.equal(create.body.event, "COMMENT");
  assert.equal(create.body.commit_id, "abc123");
  assert.equal(create.body.comments.length, 1);
  assert.equal(create.body.comments[0].line, 11);
  assert.match(create.body.body, new RegExp(T("GRUMP: BLOCK")));
  assert.match(create.body.body, /outside the diff/);
  assert.ok(create.body.body.startsWith(MARKER));
  assert.equal(srv.calls.filter((c) => c.method === "POST" && c.path.endsWith("/reviews")).length, 1);
});

test("gate mode requests changes and fails the check; APPROVE passes", async () => {
  const srv = fakeServer({ files: FILES, providerText: VERDICT_FOR });
  const out = await run({ inputs: inputsFor({ INPUT_MODE: "gate" }), event: event(), fetchImpl: srv.fetchImpl, log: () => {} });
  assert.equal(out.failed, true);
  assert.equal(srv.calls.find((c) => c.method === "POST" && c.path.endsWith("/reviews")).body.event, "REQUEST_CHANGES");
  const ok = fakeServer({ files: FILES, providerText: T("GRUMP: APPROVE\nFine.") });
  const out2 = await run({ inputs: inputsFor({ INPUT_MODE: "gate" }), event: event(), fetchImpl: ok.fetchImpl, log: () => {} });
  assert.equal(out2.verdict, "APPROVE");
  assert.equal(out2.failed, false);
  assert.ok(ok.calls.find((c) => c.method === "POST" && c.path.endsWith("/reviews")).body.body.includes(P_.approveWord));
});

test("re-run updates the existing review and replaces stale inline comments", async () => {
  const srv = fakeServer({
    files: FILES,
    providerText: VERDICT_FOR,
    reviews: [{ id: 1, body: `)${MARKER}\nold`, state: "COMMENTED" }, { id: 2, body: "human review", state: "APPROVED" }],
    comments: [{ id: 50, body: `${MARKER}\nstaleT(`, path: "src/api/users.py", line: 3 }, { id: 51, body: "human comment" }],
  });
  await run({ inputs: inputsFor(), event: event(), fetchImpl: srv.fetchImpl, log: () => {} });
  assert.ok(srv.calls.some((c) => c.method === "DELETE" && c.path.endsWith("/comments/50")));
  assert.ok(!srv.calls.some((c) => c.method === "DELETE" && c.path.endsWith("/comments/51")));
  assert.ok(srv.calls.some((c) => c.method === "PUT" && c.path.endsWith("/reviews/1")));
  assert.equal(srv.calls.filter((c) => c.method === "POST" && c.path.endsWith("/reviews")).length, 0);
  const inline = srv.calls.filter((c) => c.method === "POST" && c.path.endsWith("/pulls/7/comments"));
  assert.equal(inline.length, 1);
  assert.equal(inline[0].body.commit_id, "abc123");
});

test("re-run that changes the review state dismisses the old one and creates a new one", async () => {
  const srv = fakeServer({ files: FILES, providerText: T("GRUMP: APPROVE\nFine."), reviews: [{ id: 1, body: `)${MARKER}\nold`, state: "CHANGES_REQUESTED" }] });
  await run({ inputs: inputsFor({ INPUT_MODE: "gate" }), event: event(), fetchImpl: srv.fetchImpl, log: () => {} });
  assert.ok(srv.calls.some((c) => c.method === "PUT" && c.path.endsWith("/reviews/1/dismissals")));
  assert.equal(srv.calls.filter((c) => c.method === "POST" && c.path.endsWith("/reviews")).length, 1);
});

test("fork without a key posts one neutral note and exits cleanly, once", async () => {
  const srv = fakeServer({ files: FILES, providerText: "" });
  const inputs = inputsFor({ ANTHROPIC_API_KEY: "" });
  const out = await run({ inputs, event: event(true), fetchImpl: srv.fetchImpl, log: () => {} });
  assert.equal(out.status, "fork");
  assert.equal(srv.state.issueComments.length, 1);
  assert.match(srv.state.issueComments[0].body, /cannot see secrets/);
  await run({ inputs, event: event(true), fetchImpl: srv.fetchImpl, log: () => {} });
  assert.equal(srv.state.issueComments.length, 1);
  assert.ok(!srv.calls.some((c) => c.path.includes("anthropic")));
});

test("no key on a non-fork PR is an error; non-PR events are skipped", async () => {
  const srv = fakeServer({ files: FILES, providerText: "" });
  await assert.rejects(() => run({ inputs: inputsFor({ ANTHROPIC_API_KEY: "" }), event: event(), fetchImpl: srv.fetchImpl, log: () => {} }), /No API key/);
  assert.equal((await run({ inputs: inputsFor(), event: { push: {} }, fetchImpl: srv.fetchImpl, log: () => {} })).status, "skipped");
  assert.throws(() => readInputs({ INPUT_MODE: "loud" }), /mode must be/);
});

test("provider retries on 429 and the model output without a verdict is reported", async () => {
  const srv = fakeServer({ files: [FILES[0]], providerText: "I have no opinion.", providerStatuses: [429, 529] });
  const sleeps = [];
  const out = await run({ inputs: inputsFor(), event: event(), fetchImpl: srv.fetchImpl, sleep: async (ms) => sleeps.push(ms), log: () => {} });
  assert.equal(out.verdict, "REQUEST_CHANGES", "an unreviewed file is never approved");
  assert.equal(sleeps.length, 2);
  const body = srv.calls.find((c) => c.method === "POST" && c.path.endsWith("/reviews")).body.body;
  assert.match(body, /could not review/);
  assert.match(body, /do not approve what I have not read/);
});

test("openai provider speaks chat completions", async () => {
  const srv = fakeServer({ files: [FILES[0]], providerText: T("GRUMP: APPROVE\nFine.") });
  const p = makeProvider({ provider: "openai", apiKey: "k", fetchImpl: srv.fetchImpl });
  const res = await p.complete("sys", "user");
  assert.equal(res.text, T("GRUMP: APPROVE\nFine."));
  assert.equal(p.model, "gpt-5");
  assert.equal(srv.calls[0].body.messages[0].role, "system");
  assert.throws(() => makeProvider({ provider: "other", apiKey: "k" }), /unknown provider/);
  assert.throws(() => makeProvider({ provider: "anthropic" }), /no API key/);
});

test("composeReview and overallVerdict", () => {
  const results = [
    { file: FILES[0], verdict: { verdict: "REQUEST_CHANGES", findings: [{ n: 1, file: "src/api/users.py", line: 12, failure: "f", fix: "x", complete: true }], malformed: [] }, error: null },
    { file: FILES[3], verdict: null, error: "boom" },
  ];
  assert.equal(overallVerdict(results), "REQUEST_CHANGES");
  const r = composeReview({ results, skipped: [{ filename: "a.lock", why: "ignored" }], verdict: "REQUEST_CHANGES", mode: "nag", usage: { input: 1, output: 2 }, model: "m", runUrl: "" });
  assert.equal(r.event, "COMMENT");
  assert.equal(r.comments.length, 1);
  assert.match(r.body, /1 finding\./);
  assert.match(r.body, /a\.lock/);
  assert.match(r.body, /boom/);
});

test("the bob provider reassembles streamed assistant text and reads the session cost", async () => {
  const { parseBobStream } = await import("../action/lib/providers.mjs");
  const stream = [
    JSON.stringify({ type: "message", role: "user", content: "Review this" }),
    JSON.stringify({ type: "message", role: "assistant", content: "GRUMP" }),
    JSON.stringify({ type: "message", role: "assistant", content: ": BLOCK\n1. a.py:3 — x — y" }),
    "not json",
    JSON.stringify({ type: "result", status: "success", stats: { session_costs: 0.0106, tool_calls: 0 } }),
  ].join("\n");
  const parsed = parseBobStream(stream);
  assert.equal(parsed.text, "GRUMP: BLOCK\n1. a.py:3 — x — y");
  assert.equal(parsed.cost, 0.0106);
  assert.equal(parsed.status, "success");
  assert.equal(parseBobStream("").text, "");
});

test("the bob provider runs the cli with tools off and rejects an empty reply", async () => {
  const { EventEmitter } = await import("node:events");
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    calls.push({ cmd, args, key: opts.env.BOB_API_KEY });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end: (prompt) => { calls[calls.length - 1].prompt = prompt; setImmediate(() => { child.stdout.emit("data", JSON.stringify({ type: "message", role: "assistant", content: calls.length === 1 ? "GRUMP: APPROVE — a.py\nFine." : "" }) + "\n"); child.emit("close", 0); }); } };
    return child;
  };
  const p = makeProvider({ provider: "bob", apiKey: "k", spawnImpl, env: {}, sleep: async () => {} });
  const res = await p.complete("system text", "user text");
  assert.equal(res.text, "GRUMP: APPROVE — a.py\nFine.");
  assert.equal(calls[0].cmd, "bob");
  assert.ok(calls[0].args.includes("--disable-tool-groups"));
  assert.equal(calls[0].key, "k");
  assert.ok(calls[0].prompt.startsWith("system text\n\nuser text"));
  await assert.rejects(() => p.complete("s", "u"), /no message/);
});
