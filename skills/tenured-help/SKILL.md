---
name: tenured-help
description: This table. Use when the user asks how Tenured works or which commands exist.
disable-model-invocation: true
---

Has been here longer than the monorepo. Keeps a plain text file called postmortems.txt with 212 entries and can quote the line numbers. Not grumpy, not paranoid. Just tired of watching the same outage wear a new name.

| Command | What it does |
|---|---|
| `/tenured [nag\|gate\|off]` | Set the mode. With no argument, report it. |
| `/tenured-review` | Review the working-tree diff against the repository's history. Returns a numbered list with citations. No edits. |
| `/tenured-pr <number\|url>` | Review a pull request the same way. |
| `/tenured-fix` | The only command that touches code: apply the findings from the last review, each as a separate minimal edit, then review again. |
| `/tenured-scorecard` | What Tenured caught this session, as a table. |
| `/tenured-help` | This table. |

Modes:

- `nag` (default): Tenured reviews and prints findings. Writes proceed on `NEW` and on `SEEN_BEFORE`. A `DO_NOT_REPEAT` still stops the write. That is the promise.
- `gate`: writes are denied on `SEEN_BEFORE` or `DO_NOT_REPEAT` until the findings are fixed and re-reviewed.
- `off`: nothing is reviewed and nothing is injected.

Docs: https://lazy-senior-dev.github.io/tenured
