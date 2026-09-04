<p align="center">
  <img src="assets/tenured.svg" alt="Tenured: bald on top, thick round glasses, a calm half-smile, a cardigan, a notebook marked 2017 in the pocket" width="220">
</p>

<h1 align="center">tenured</h1>

<p align="center"><em>We tried that in 2017.</em></p>

<p align="center"><img alt="status: in progress" src="https://img.shields.io/badge/status-in%20progress-7a746b"> <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-1f1f1f"></a></p>

**Your agent's change, reviewed by the engineer who has been here longer than the monorepo and remembers the postmortem for the thing you are about to reintroduce.**

The third persona from [lazy-senior-dev](https://github.com/lazy-senior-dev). [grumpy-reviewer](https://github.com/lazy-senior-dev/grumpy-reviewer) reads the diff for what breaks. [paranoid-sre](https://github.com/lazy-senior-dev/paranoid-sre) reads the deploy for what pages. Tenured reads the change against the repository's own history: the removals it resurrects, the reverts it repeats, the postmortems it ignores, the comments that said not to. Every objection comes with a commit hash or a file the author can open. Verdicts: `TENURED: NEW | SEEN_BEFORE | DO_NOT_REPEAT`. Measured on repeated outages avoided.

## Status

In progress. What exists today:

- [`rules/tenured.md`](rules/tenured.md): the character, the ten-question checklist, the verdict format, the non-negotiables, and the planned commands.

What comes next, in order:

1. Adapters generated from the ruleset with the grumpy-reviewer generator, plus a history-gathering step (`git log`, changelog, `docs/postmortems*`) injected before each review.
2. The gate hook, and `/tenured-remember` to grow the repository's own memory.
3. A benchmark of small repositories with real histories, each containing a change that repeats a recorded mistake. Measured on repeated outages avoided, with raw replies committed.
4. A project site and a `v0.1.0`.

## Who he is

Has been here longer than the monorepo. Keeps a plain text file called postmortems.txt with 212 entries and can quote the line numbers. Not grumpy, not paranoid; just tired of watching the same outage wear a new name. He approves with three words: `New to me.`

## License

[Apache-2.0](LICENSE). Copyright 2026 [Sandeep Bazar](https://www.linkedin.com/in/sandeepbazar/). Keep the [NOTICE](NOTICE) file with any redistribution.

Built and maintained by [Sandeep Bazar](https://www.linkedin.com/in/sandeepbazar/), part of [lazy-senior-dev](https://github.com/lazy-senior-dev).
