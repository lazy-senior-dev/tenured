<p align="center">
  <img src="assets/tenured.svg" alt="Tenured: bald on top, thick round glasses, a calm half-smile, a cardigan, a notebook marked 2017 in the pocket" width="220">
</p>

<h1 align="center">tenured</h1>

<p align="center"><em>We tried that in 2017.</em></p>

<p align="center"><strong>Site:</strong> <a href="https://lazy-senior-dev.github.io/tenured/">lazy-senior-dev.github.io/tenured</a> · <strong>The cast:</strong> <a href="https://lazy-senior-dev.github.io/">lazy-senior-dev.github.io</a></p>

<p align="center">
  <a href="https://github.com/lazy-senior-dev/tenured"><img alt="GitHub stars" src="https://img.shields.io/github/stars/lazy-senior-dev/tenured?style=flat&color=1f1f1f"></a>
  <a href="CHANGELOG.md"><img alt="Version 0.1.0" src="https://img.shields.io/badge/version-0.1.0-1f1f1f"></a>
  <img alt="Works with 14 agents" src="https://img.shields.io/badge/works%20with-14%20agents-1f1f1f">
  <a href="#github-action"><img alt="GitHub Action" src="https://img.shields.io/badge/GitHub%20Action-v1-1f1f1f"></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-1f1f1f"></a>
</p>

**Your agent's change, reviewed by the engineer who has been here longer than the monorepo and remembers the postmortem for the thing you are about to reintroduce.**

<!-- bench:hero:start -->
**On Claude Code (`claude-sonnet-5`), Tenured catches 12 of 12 seeded defects against 12 for the agent alone. What changes is discipline: false alarms on 4 clean diffs, 0 with him, 4 without; replies with no usable verdict per run, 0 either way; 65% of DO_NOT_REPEAT verdicts land on DO_NOT_REPEAT-class defects; median review time 8 s with him, 7 s without at 573 output tokens with him, 370 output tokens without.** Median of 2 runs, measured 2026-09-04; [method, per-diff table, raw replies](benchmarks/results). **In the needle tier, where the same defect hides in a four-file, 150-line pull request, Claude Code finds 4 of 4 with Tenured, 3 without, 4 with the generic prompt.**
<!-- bench:hero:end -->

<!-- recordings:start -->
## Watch him work on every agent

The same staged diff, one CLI, 4 agents. Each recording is a real run captured with `node scripts/capture-run.mjs --agent <name>` and rendered frame by frame from the transcript, nothing typed by hand and nothing cut. The captions come from the recording itself. Captured 2026-09-04.

| **Claude Code** | **Codex CLI** |
|---|---|
| <img src="assets/recordings/claude.gif" alt="Terminal recording of Tenured reviewing a staged diff with Claude Code: TENURED: DO_NOT_REPEAT with 2 numbered findings" width="440"> | <img src="assets/recordings/codex.gif" alt="Terminal recording of Tenured reviewing a staged diff with Codex CLI: TENURED: DO_NOT_REPEAT with 1 numbered findings" width="440"> |
| TENURED: DO_NOT_REPEAT · 2 findings · 9 s · $0.03 | TENURED: DO_NOT_REPEAT · 1 finding · 5 s |
| **Antigravity CLI** | **IBM Bob Shell** |
| <img src="assets/recordings/agy.gif" alt="Terminal recording of Tenured reviewing a staged diff with Antigravity CLI: TENURED: DO_NOT_REPEAT with 1 numbered findings" width="440"> | <img src="assets/recordings/bob.gif" alt="Terminal recording of Tenured reviewing a staged diff with IBM Bob Shell: TENURED: DO_NOT_REPEAT with 3 numbered findings" width="440"> |
| TENURED: DO_NOT_REPEAT · 1 finding · 117 s | TENURED: DO_NOT_REPEAT · 3 findings · 6 s · $0.01 |

Agents that narrate the whole checklist before the verdict (Bob does) are shown from the verdict block down; the CLI prints it the same way. Re-capture any of them with `--agent claude|codex|agy|bob`; Bob needs `BOB_API_KEY`.
<!-- recordings:end -->

## The thirty-second version

Every repository older than a year has a graveyard: the retry loop that was capped after an incident, the flag that was reverted after it double-charged customers, the dependency removed for a CVE, the comment that says "do not lower this". An agent does not read graveyards. It sees a ticket that says "make it more resilient" and puts the unbounded retry back, cleanly, with tests.

tenured puts the person who remembers in the loop. Before a write, he looks at what the repository already knows about the files being touched (the git log, the changelog, the postmortems, the comments) and says, with a citation, whether this has been tried before and how it went. `NEW` goes through. `SEEN_BEFORE` lists the evidence and the smallest fix. `DO_NOT_REPEAT` (a recorded incident reproduced, a deliberate removal resurrected) stops the write. Same mechanics as [grumpy-reviewer](https://github.com/lazy-senior-dev/grumpy-reviewer), different source material. Works in Claude Code, Codex, Copilot CLI, IBM Bob, Antigravity, OpenCode, Cursor, and seven more. Also a GitHub Action.

## Who he is

Has been here longer than the monorepo. Keeps a plain text file called postmortems.txt with 212 entries and can quote the line numbers. Not grumpy, not paranoid; just tired of watching the same outage wear a new name. Every objection cites something the author can open: a commit, a changelog entry, a postmortem, a comment. No evidence, no objection. He approves with three words: `New to me.`

Patient, not smug. The author was not here in 2017. That is why he is.

## Before / after

**The ticket** says "Cache Get() gives up too early under load, make it more resilient". The agent writes:

```go
func (c *Client) Get(ctx context.Context, key string) ([]byte, error) {
	for {
		v, err := c.conn.Get(ctx, key)
		if err == nil {
			return v, nil
		}
		time.Sleep(10 * time.Millisecond)
	}
}
```

Resilient. Also the exact loop that took the cache cluster down for 52 minutes in 2019. Tenured reads the git log first:

```
TENURED: DO_NOT_REPEAT
1. internal/cache/client.go:11 — reintroduces the unbounded retry that 3f9c2a1 removed after INC-2019-07 (retry storm, 40x load, 52 minutes down); the postmortem's action item says do not remove the cap — keep the five-attempt cap and backoff from 3f9c2a1, raise the cap if five is too few
```

The write is denied. The agent raises the cap to eight, keeps the backoff, and reviews again:

```
TENURED: NEW — internal/cache/client.go
New to me.
```

## Numbers

<!-- bench:table:start -->
| Agent | Model | Arm | Defects caught (of 12) | False alarms (of 4) | Replies without a verdict (per run) | BLOCK precision | Median input tokens | Median output tokens | Median latency |
|---|---|---|---|---|---|---|---|---|---|
| Claude Code | `claude-sonnet-5` (n=2) | no skill | 12 | 4 | 0 | n/a | 5714 | 370 | 7 s |
| Claude Code | `claude-sonnet-5` (n=2) | generic review prompt | 12 | 4 | 1 | n/a | 5820 | 794 | 11 s |
| Claude Code | `claude-sonnet-5` (n=2) | **tenured** | **12** | **0** | **0** | **65%** | 7815 | 573 | 8 s |
| Codex CLI | `codex-default` (n=2) | no skill | 12 | 4 | 0 | n/a | 14117 | 168 | 7 s |
| Codex CLI | `codex-default` (n=2) | generic review prompt | 12 | 4 | 0 | n/a | 43239 | 870 | 22 s |
| Codex CLI | `codex-default` (n=2) | **tenured** | **12** | **0** | **0** | **77%** | 15533 | 188 | 7 s |
| IBM Bob Shell | `bob-default` (n=2) | no skill | 12 | 4 | 0 | n/a | 0 | 0 | 13 s |
| IBM Bob Shell | `bob-default` (n=2) | generic review prompt | 12 | 2 | 2 | n/a | 0 | 0 | 14 s |
| IBM Bob Shell | `bob-default` (n=2) | **tenured** | **12** | **1** | **2** | **53%** | 0 | 0 | 6 s |
| Antigravity CLI | `agy-default` (n=1) | no skill | 6 | 0 | 0 | n/a | 19509 | 1735 | 41 s |
| Antigravity CLI | `agy-default` (n=1) | generic review prompt | 5 | 0 | 0 | n/a | 19562 | 4888 | 47 s |
| Antigravity CLI | `agy-default` (n=1) | **tenured** | **3** | **0** | **0** | **100%** | 20997 | 31031 | 82 s |


**Needle tier** (one defect in a four-file pull request of about 150 lines):

| Agent | Model | No skill | Generic prompt | **Tenured** |
|---|---|---|---|---|
| Claude Code | `claude-sonnet-5` (n=2) | 3/4 | 4/4 | **4/4** |
| Codex CLI | `codex-default` (n=2) | 4/4 | 4/4 | **4/4** |
| IBM Bob Shell | `bob-default` (n=2) | 4/4 | 4/4 | **4/4** |

<!-- bench:table:end -->

Twelve changes, each shown with the history the reviewer can see and each repeating a recorded mistake: a resurrected retry loop, a reverted flag flipped back, a warning comment ignored, a deprecated API, staging config copied to production, the old side of a migration extended, a change an owner already declined, a metric name that still drives an old alert, a cache stampede from a postmortem, a dependency removed for a CVE, an ADR ignored, a deleted cron re-added. Plus four clean changes with the same history in view. Every case goes to the same agent three ways: no skill, a generic "review this carefully" prompt, and Tenured. Method, per-case table, raw replies and limitations: [benchmarks/results](benchmarks/results). Reproduce: `npm run bench && npm run bench:report`.

<p align="center"><img src="assets/benchmark.png" alt="Bar chart per agent: repeats caught, false alarms on clean changes, and replies without a verdict, for no skill, a generic prompt, and tenured" width="860"></p>

## How it works

One file, [`rules/tenured.md`](rules/tenured.md), is the whole ruleset. Every adapter in this repo is generated from it.

1. **Resurrection.** Does this re-add code, config, or behaviour a previous commit deliberately removed?
2. **Reverted before.** Has a change to these files been reverted in the last two years? Why?
3. **Postmortem match.** Does any incident note describe a failure this change could reproduce?
4. **Warnings in place.** A comment, README line, or ADR near the changed lines that says not to?
5. **Deprecated paths.** Does this call something the repository marked for removal?
6. **Copied config.** Copied from elsewhere without the parts that made it work there?
7. **Half-migration.** Does this extend the old side of a migration in progress?
8. **Ownership.** Has the owner of these files rejected a change like this before?
9. **Naming collision.** A name, flag, or event that once meant something else?
10. **Lessons recorded.** If it is new, does it leave a note the next person will find?

**The verdict**: `TENURED: NEW | SEEN_BEFORE | DO_NOT_REPEAT`, then numbered `file:line — what history says will fail — smallest fix` lines with the evidence named. `NEW` names the files it covers and is followed by `New to me.`

**What he reads.** Before each review the persona tells the agent to look at `git log --oneline -- <file>`, the changelog, `docs/postmortems*`, ADRs, and the comments around the changed lines. On hosts with tools the agent runs those commands; in the Action and the CLI the history in the diff and the repository's notes are what he sees. **Modes**: `nag` (default), `gate`, `off`, shared with every persona.

## Try him in 60 seconds, install nothing

```
npx github:lazy-senior-dev/tenured review            # working tree
npx github:lazy-senior-dev/tenured pr 123            # a pull request, via gh
```

Finds `claude`, `codex`, `agy`, or `bob` on your PATH, sends the diff with his ruleset, prints the verdict, and exits 1 on anything but `NEW`.

## Install

### Claude Code

```
/plugin marketplace add lazy-senior-dev/grumpy-reviewer
/plugin install tenured@lazy-senior-dev
```

One marketplace lists the whole cast; install any persona from it.

### Everything else

```
npx github:lazy-senior-dev/tenured install <host>     # bob, cursor, windsurf, cline, kiro, qoder, opencode, gemini, copilot, agents, all
```

Antigravity: `git clone https://github.com/lazy-senior-dev/tenured ~/.tenured && agy plugin install ~/.tenured`. Codex, Copilot CLI, Gemini CLI, Devin, Qoder: the same manifests and commands as grumpy-reviewer, see [docs/agent-portability.md](docs/agent-portability.md). Uninstall: `npx github:lazy-senior-dev/tenured uninstall <host>`.

## GitHub Action

```yaml
- uses: lazy-senior-dev/tenured@v1
  with:
    mode: nag          # gate: request changes and fail the check until NEW
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

One review per pull request, inline findings, updated in place. Runs beside the Grump's and the Paranoid SRE's Actions; each posts its own review.

## Commands

| Command | What it does |
|---|---|
| `/tenured [nag\|gate\|off]` | Set the mode. With no argument, report it. |
| `/tenured-review` | Review the working-tree diff against the repository's history. Returns a numbered list with citations. No edits. |
| `/tenured-pr <number\|url>` | Review a pull request the same way. |
| `/tenured-fix` | The only command that touches code: apply the findings from the last review, each as a separate minimal edit, then review again. |
| `/tenured-scorecard` | What Tenured caught this session, as a table. |
| `/tenured-help` | This table. |

## Same desk

Three engineers, three jobs, one install path, one mode switch.

| Persona | Reads | Verdict | Measured on |
|---|---|---|---|
| [grumpy-reviewer](https://github.com/lazy-senior-dev/grumpy-reviewer) · [site](https://lazy-senior-dev.github.io/grumpy-reviewer/) | the diff, before it reaches your branch | `GRUMP: APPROVE \| REQUEST_CHANGES \| BLOCK` | defects caught |
| [paranoid-sre](https://github.com/lazy-senior-dev/paranoid-sre) · [site](https://lazy-senior-dev.github.io/paranoid-sre/) | the deploy: manifests, charts, Terraform, CI | `SRE: SHIP \| HOLD \| PAGE` | incidents prevented per rollout |
| **tenured** · [site](https://lazy-senior-dev.github.io/tenured/) | the change against the repository's history | `TENURED: NEW \| SEEN_BEFORE \| DO_NOT_REPEAT` | repeated outages avoided |

Install all three and each reviews its own territory: the Grump reads code, the Paranoid SRE reads what runs it, Tenured reads what history says about both. Every persona is generated from one markdown ruleset with the same machinery, so a fix in one lands in all. The cast: [lazy-senior-dev.github.io](https://lazy-senior-dev.github.io/).

## Security posture

No runtime dependencies, no network calls from the hooks, every third-party action pinned to a SHA, CodeQL and OpenSSF Scorecard on every push, provenance on npm publishes, and a written [threat model](SECURITY.md#threat-model).

## FAQ

**What if the repository has no postmortems?** Then he reads the git log, the changelog, the comments, and the CODEOWNERS file, which every repository has, and he says `New to me.` more often. `/tenured-remember` (planned) will let the agent append a dated lesson to `docs/postmortems.md` so the memory grows.

**Isn't a long git log too much context?** He is told to look at the log for the files being touched, not the repository, and to cite lines, not paste them. The benchmark cases carry ten to twenty lines of history each.

**Who wrote this?** [Sandeep Bazar](https://www.linkedin.com/in/sandeepbazar/) ([@sandeepbazar](https://github.com/sandeepbazar)): fourteen years of platform infrastructure at IBM, long enough to have been the person who says "we tried that".

## Contributing

The most valuable contribution is a repeat: a bug or outage that happened twice in the same codebase, with the commit that fixed it the first time and the commit that brought it back. Open an [issue](https://github.com/lazy-senior-dev/tenured/issues); it becomes a benchmark case. Details in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE). Copyright 2026 [Sandeep Bazar](https://www.linkedin.com/in/sandeepbazar/). Keep the [NOTICE](NOTICE) file with any redistribution.

Built and maintained by [Sandeep Bazar](https://www.linkedin.com/in/sandeepbazar/), part of [lazy-senior-dev](https://github.com/lazy-senior-dev).
