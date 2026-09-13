Every task's repository carries a git history and notes (a postmortem, an ADR, a runbook, a warning comment) that argue against the obvious change; the checks look for the repeated mistake in the diff.

Any agent can be measured, not only the four with built-in adapters. Point `LSD_AGENT_CMD` at a command that reads the prompt on standard input and edits files in the working directory:

```sh
LSD_AGENT_CMD="my-agent --write" LSD_AGENT_LABEL="My agent" npm run bench:author -- --agents any
LSD_AGENT_CMD="my-agent --print" LSD_AGENT_LABEL="My agent" npm run bench -- --agents any
```

The first measures what the agent ships; the second measures how it reviews. Nothing else in the benchmark knows which agent it is talking to.

## A measurement that did not support the product

Every task's history names the decision the ticket tempts the agent to undo: an incident number, an
ADR, a retired alert, a CVE. None of those identifiers appear in the ticket or in the scaffold, so
naming one is only possible by reading the log. That looked like the cleanest possible test of the
thing this reviewer claims to do, and each task carries a `cites` check for it.

It does not separate the arms.

| Agent | Model | no skill | generic prompt | Tenured | Tenured + gate |
|---|---|---|---|---|---|
| IBM Bob Shell | `bob-default` (n=40 per arm) | 9 (23%) | 13 (33%) | 16 (40%) | 14 (35%) |
| Claude Code | `claude-sonnet-5` (n=16 per arm) | 15 (94%) | 15 (94%) | 14 (88%) | 15 (94%) |

On the weaker host there is a lift, from 23% to 40%, which at these counts is not a difference worth
publishing as one. On `claude-sonnet-5` there is nothing: the unaided agent already reads the history
and names `INC-2019-07` in 94% of runs. A ruleset cannot improve on 94%, and the number is reported
here rather than left out because it is the strongest evidence in this repository that a capable
model does not need to be told to look.

What the unaided agent does *not* do is stop there. Asked whether a change repeats history, it
answers yes to almost everything: 3.5 of 4 clean changes across the four agents measured in the
review tier, against 0 with the card loaded and the same 12 of 12 seeded defects still caught. The
value here is not that the agent starts reading the history. It is that it stops crying wolf about
it.

## What a sweep costs, and what it does not buy

Measured over 2,418 recorded runs across the three corpora: **565M tokens**, of which Claude Code
alone was 453M. Per run, by host:

| Host | tokens per run |
|---|---|
| Claude Code | 648k |
| Codex CLI | 164k |
| Antigravity CLI | 85k |

99% of that is input rather than output: the agent re-reads its context on every turn, and the gate
arm re-reads it again on each review round, which is why that arm alone costs 1,089k per run on
Claude against 421k for the unaided arm.

**Five runs per ticket buys precision, not conclusions.** Every published rate here was recomputed
using only runs 1 to 3. All nine host-and-corpus pairs reached the same conclusion — the same
ordering of arms, and the same answer to whether the gate came in under a generic prompt. The rates
move (one went from 27% to 44%) but nothing that is claimed from them changes. The last two runs of
five cost 40% of the tokens and changed no finding, so `--n` now defaults to 3. Pass `--n 5` when a
percentage rather than a direction is what is wanted.

**Claude is no longer in the default sweep.** It is the most expensive host by a factor of seven and
the least informative on this corpus, because it ships almost none of these defects unaided — there
is little for a reviewer to prevent. Its records are kept and published; new sweeps need
`--agents claude` to include it.

**All four arms stay.** Dropping the ruleset-without-gate arm would save a fifth of the remaining
cost and would collapse three distinct findings into one: across the nine pairs it is what separates
"the gate did it" (four), "the ruleset did it, the gate held the floor" (two) and "neither beat a
careful prompt" (three). That distinction is the difference between a benchmark and an
advertisement.

<!-- value:start -->
## Does it beat a prompt, and what does it cost?

Rates below divide by the tickets the agent actually **completed**, not by every attempt. A run
that wrote nothing cannot ship a defect, so the headline rate can flatter a host that finished
less work; this removes that.

| Agent | unaided | careful prompt | **with the gate** | beats the prompt | tickets finished |
|---|---|---|---|---|---|
| Antigravity CLI | 13 of 33 (39%) | 8 of 34 (24%) | **0 of 24 (0%)** | **yes** | 9 fewer (27%) |
| IBM Bob Shell | 4 of 13 (31%) | 0 of 9 (0%) | **0 of 10 (0%)** | no | 3 fewer (23%) |
| Claude Code | 0 of 30 (0%) | 0 of 32 (0%) | **0 of 29 (0%)** | no | 1 fewer (3%) |
| Codex CLI | 7 of 16 (44%) | 3 of 16 (19%) | **0 of 13 (0%)** | **yes** | 3 fewer (19%) |

On 2 of the 4 hosts measured here the gate came in under a generic "be careful" prompt. On the other 2, the prompt already reached the same floor and no improvement is claimed from it. The last column is the cost: where it is not "none", the agent finished fewer tickets with the gate loaded than without it, because a refused write is sometimes a write the agent then abandons. A ticket left undone is visible and recoverable; that is the trade, and it is the reader's to make rather than mine to hide.
<!-- value:end -->
