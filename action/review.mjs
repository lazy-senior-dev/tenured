#!/usr/bin/env node
// grumpy-reviewer GitHub Action: review a pull request as the Grump and post one review.
//
// Environment (set by action.yml):
//   GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH, GITHUB_API_URL
//   INPUT_MODE (nag|gate), INPUT_PROVIDER (anthropic|openai), INPUT_MODEL, INPUT_MAX_FILES, INPUT_IGNORE
//   ANTHROPIC_API_KEY or OPENAI_API_KEY
//
// Everything below `main` is exported and testable with an injected fetch.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { lastVerdict, severityRank } from "../hooks/lib/verdict.mjs";
import { anchorLine, numberedPatch } from "./lib/diff.mjs";
import { parseGlobs, isIgnored } from "./lib/glob.mjs";
import { makeProvider } from "./lib/providers.mjs";
import { GitHub } from "./lib/github.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const P = JSON.parse(readFileSync(join(HERE, "..", "persona.json"), "utf8"));
const V = P.verdicts;
export const MARKER = `<!-- ${P.slug} -->`;
const FORK_MARKER = `<!-- ${P.slug}:fork -->`;
const DEFAULT_IGNORE = ["**/*.lock", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock", "**/*.min.js", "**/*.min.css", "**/*.map", "**/dist/**", "**/vendor/**", "**/*.snap", "**/*.svg", "**/*.png"];

export function personaCard() {
  return readFileSync(join(HERE, "..", "hooks", "persona.md"), "utf8");
}

export function systemPrompt() {
  return `${personaCard()}

You are reviewing one file of a pull request at a time. You cannot see the rest of the repository; review what is in the patch and say so when a finding depends on code you cannot see. Line numbers in findings refer to the new file and must be lines that appear in the patch. Print only the verdict block. Nothing before it, nothing after it.`;
}

export function filePrompt(file) {
  return `File: ${file.filename} (${file.status}, +${file.additions} -${file.deletions})

Patch, with new-file line numbers in the left column:

\`\`\`diff
${numberedPatch(file.patch)}
\`\`\`

Print the verdict block for this file.`;
}

// Choose which files to review: drop ignored and patch-less files, keep the largest `maxFiles`.
export function selectFiles(files, { maxFiles, ignore }) {
  const globs = [...DEFAULT_IGNORE, ...ignore];
  const skipped = [];
  const candidates = [];
  for (const f of files) {
    if (isIgnored(f.filename, globs)) skipped.push({ filename: f.filename, why: "ignored" });
    else if (!f.patch) skipped.push({ filename: f.filename, why: f.status === "removed" ? "removed" : "no text patch (binary or too large)" });
    else candidates.push(f);
  }
  candidates.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
  const reviewed = candidates.slice(0, maxFiles);
  for (const f of candidates.slice(maxFiles)) skipped.push({ filename: f.filename, why: `over the ${maxFiles} file limit` });
  return { reviewed, skipped };
}

export async function reviewFiles(files, provider, { concurrency = 3, log = () => {} } = {}) {
  const system = systemPrompt();
  const results = new Array(files.length);
  const usage = { input: 0, output: 0 };
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      const file = files[i];
      try {
        const res = await provider.complete(system, filePrompt(file));
        usage.input += res.usage.input;
        usage.output += res.usage.output;
        const verdict = lastVerdict(res.text);
        results[i] = { file, verdict, text: res.text, error: verdict ? null : "no verdict block in the model output" };
        log(`${file.filename}: ${verdict ? verdict.verdict : "unparseable"}`);
      } catch (err) {
        results[i] = { file, verdict: null, text: "", error: err.message };
        log(`${file.filename}: error ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return { results, usage };
}

// A file that could not be reviewed is never silently approved: it counts as REQUEST_CHANGES.
export function overallVerdict(results) {
  let rank = 0;
  for (const r of results) rank = Math.max(rank, r.verdict ? severityRank(r.verdict.verdict) : 1);
  return ["APPROVE", "REQUEST_CHANGES", "BLOCK"][rank];
}

// Turn per-file verdicts into inline comments and a summary body.
export function composeReview({ results, skipped, verdict, mode, usage, model, runUrl }) {
  const comments = [];
  const unanchored = [];
  let total = 0;
  for (const r of results) {
    if (!r.verdict) continue;
    for (const f of [...r.verdict.findings, ...r.verdict.malformed]) {
      total++;
      const line = f.line ? anchorLine(r.file.patch, f.line) : null;
      const body = f.complete
        ? `${MARKER}\n**${r.verdict.verdict === "BLOCK" ? V.block : "Finding"}.** ${f.failure}\n\n**Smallest fix:** ${f.fix}`
        : `${MARKER}\n${f.raw}`;
      if (line) comments.push({ path: r.file.filename, line, side: "RIGHT", body });
      else unanchored.push(`- \`${r.file.filename}${f.line ? ":" + f.line : ""}\` ${f.complete ? `${f.failure} (fix: ${f.fix})` : f.raw}`);
    }
  }

  const opening = {
    APPROVE: P.approveWord,
    REQUEST_CHANGES: total
      ? `${total} finding${total === 1 ? "" : "s"}. Each one names the line, what breaks in production, and the smallest fix. Fix them; I will read it again.`
      : "I could not read every file, and I do not approve what I have not read. See below, then re-run.",
    BLOCK: `${total} finding${total === 1 ? "" : "s"}, and at least one is a ${V.block}: the class of failure this reviewer never lets through. That does not merge, whatever the schedule says.`,
  }[verdict];
  const word = { APPROVE: V.approve, REQUEST_CHANGES: V.changes, BLOCK: V.block }[verdict];

  const lines = [MARKER, `### ${P.verdictPrefix}: ${word}`, "", opening, ""];
  if (unanchored.length) lines.push("Findings on lines outside the diff:", "", ...unanchored, "");
  const errors = results.filter((r) => r.error);
  if (errors.length) lines.push(`Files ${P.asName || P.name} could not review (no verdict came back):`, "", ...errors.map((r) => `- \`${r.file.filename}\`: ${r.error}`), "");
  if (skipped.length) lines.push("Not reviewed:", "", ...skipped.map((s) => `- \`${s.filename}\`: ${s.why}`), "");
  lines.push(
    "<sub>",
    `Reviewed ${results.length} file${results.length === 1 ? "" : "s"} · mode \`${mode}\` · model \`${model}\` · ${usage.input.toLocaleString()} in / ${usage.output.toLocaleString()} out tokens`,
    runUrl ? ` · [run](${runUrl})` : "",
    ` · [${P.slug}](https://github.com/lazy-senior-dev/${P.slug})`,
    "</sub>",
  );
  const event = mode === "gate" && verdict !== "APPROVE" ? "REQUEST_CHANGES" : "COMMENT";
  return { body: lines.join("\n"), comments, event, total };
}

// Post exactly one review. On re-runs: remove our old inline comments, update or
// replace the old summary, never leave two live reviews behind.
export async function publish(gh, number, headSha, review, { log = () => {} } = {}) {
  const [reviews, comments] = await Promise.all([gh.reviews(number), gh.reviewComments(number)]);
  const stale = comments.filter((c) => typeof c.body === "string" && c.body.includes(MARKER));
  for (const c of stale) {
    try {
      await gh.deleteReviewComment(c.id);
    } catch (err) {
      log(`could not delete stale comment ${c.id}: ${err.message}`);
    }
  }
  const previous = reviews.filter((r) => typeof r.body === "string" && r.body.includes(MARKER) && r.state !== "DISMISSED").sort((a, b) => b.id - a.id)[0];

  const wantsChanges = review.event === "REQUEST_CHANGES";
  if (previous && (previous.state === "CHANGES_REQUESTED") === wantsChanges) {
    await gh.updateReview(number, previous.id, review.body);
    for (const c of review.comments) await gh.createReviewComment(number, { ...c, commit_id: headSha });
    log(`updated review ${previous.id} with ${review.comments.length} inline comments`);
    return { action: "updated", id: previous.id };
  }
  if (previous && previous.state === "CHANGES_REQUESTED") {
    await gh.dismissReview(number, previous.id, `${P.name} read it again. Superseded by the review below.`);
    log(`dismissed review ${previous.id}`);
  } else if (previous) {
    await gh.updateReview(number, previous.id, `${MARKER}\n_Superseded by a newer review below._`);
  }
  const created = await gh.createReview(number, { commit_id: headSha, body: review.body, event: review.event, comments: review.comments });
  log(`created review ${created?.id} (${review.event}) with ${review.comments.length} inline comments`);
  return { action: "created", id: created?.id };
}

export function readInputs(env = process.env) {
  const mode = (env.INPUT_MODE || "nag").toLowerCase();
  if (!["nag", "gate"].includes(mode)) throw new Error(`mode must be nag or gate, got "${mode}"`);
  const provider = (env.INPUT_PROVIDER || "anthropic").toLowerCase();
  const apiKey = provider === "openai" ? env.OPENAI_API_KEY : provider === "bob" ? env.BOB_API_KEY : env.ANTHROPIC_API_KEY;
  return {
    mode,
    provider,
    model: env.INPUT_MODEL || "",
    maxFiles: Math.max(1, Number(env.INPUT_MAX_FILES || 25) || 25),
    ignore: parseGlobs(env.INPUT_IGNORE),
    apiKey,
    token: env.INPUT_GITHUB_TOKEN || env.GITHUB_TOKEN,
    repo: env.GITHUB_REPOSITORY,
    apiUrl: env.GITHUB_API_URL || "https://api.github.com",
    eventPath: env.GITHUB_EVENT_PATH,
    runUrl: env.GITHUB_SERVER_URL && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : "",
  };
}

export async function run({ inputs, event, fetchImpl = fetch, sleep, log = console.log }) {
  const pr = event.pull_request;
  if (!pr) {
    log("Not a pull_request event; nothing to review.");
    return { status: "skipped" };
  }
  const gh = new GitHub({ token: inputs.token, repo: inputs.repo, apiUrl: inputs.apiUrl, fetchImpl, sleep });
  const number = pr.number;
  const isFork = pr.head?.repo?.full_name && pr.base?.repo?.full_name && pr.head.repo.full_name !== pr.base.repo.full_name;

  if (!inputs.apiKey) {
    if (isFork) {
      const existing = (await gh.issueComments(number)).find((c) => typeof c.body === "string" && c.body.includes(FORK_MARKER));
      const body = `${FORK_MARKER}\n${P.name} cannot see secrets on pull requests from forks, so this one was not reviewed automatically. A maintainer can run the review from a branch in this repository.`;
      if (!existing) await gh.createIssueComment(number, body);
      log("fork without secrets: posted a note and exited 0");
      return { status: "fork" };
    }
    throw new Error(`No API key. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY with provider: openai, BOB_API_KEY with provider: bob) in the workflow env.`);
  }

  const provider = makeProvider({ provider: inputs.provider, model: inputs.model, apiKey: inputs.apiKey, fetchImpl, sleep });
  const files = await gh.files(number);
  const { reviewed, skipped } = selectFiles(files, { maxFiles: inputs.maxFiles, ignore: inputs.ignore });
  log(`reviewing ${reviewed.length} of ${files.length} files with ${provider.name}/${provider.model}`);

  if (!reviewed.length) {
    log("nothing reviewable");
    return { status: "empty" };
  }

  const { results, usage } = await reviewFiles(reviewed, provider, { log });
  const verdict = overallVerdict(results);
  const review = composeReview({ results, skipped, verdict, mode: inputs.mode, usage, model: provider.model, runUrl: inputs.runUrl });
  const word = { APPROVE: V.approve, REQUEST_CHANGES: V.changes, BLOCK: V.block }[verdict];
  const posted = await publish(gh, number, pr.head.sha, review, { log });

  const failed = inputs.mode === "gate" && verdict !== "APPROVE";
  log(`${P.verdictPrefix}: ${word} (${review.total} findings)${failed ? " -> failing the check (gate mode)" : ""}`);
  return { status: "reviewed", verdict, findings: review.total, posted, failed, usage };
}

async function main() {
  const inputs = readInputs();
  const event = JSON.parse(readFileSync(inputs.eventPath, "utf8"));
  const out = await run({ inputs, event });
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${out.verdict || ""}\nfindings=${out.findings ?? 0}\n`);
  }
  if (out.failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`::error::${err.message}`);
    process.exitCode = 1;
  });
}
