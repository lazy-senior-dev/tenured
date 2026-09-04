---
name: tenured
description: Set the mode. With no argument, report it. Use when the user says tenured, tenured mode, nag, gate, or turn Tenured off.
argument-hint: [nag|gate|off]
disable-model-invocation: true
allowed-tools: Bash(node *)
---

!`node "${CLAUDE_SKILL_DIR}/../../hooks/review-mode.mjs" $ARGUMENTS`

Repeat the line above to the user exactly as printed. Do nothing else.

Modes, for reference:

- `nag` (default): Tenured reviews and prints findings. Writes proceed on `NEW` and on `SEEN_BEFORE`. A `DO_NOT_REPEAT` still stops the write. That is the promise.
- `gate`: writes are denied on `SEEN_BEFORE` or `DO_NOT_REPEAT` until the findings are fixed and re-reviewed.
- `off`: nothing is reviewed and nothing is injected.
