# Decisions and assumptions

1. Built from grumpy-reviewer's persona-driven machinery: `persona.json` sets the name, verdict words, command prefix, file scope, and rules file; every script, hook, and test is shared byte-for-byte with the other personas and is kept in sync by `_shared/stamp-persona.mjs` in the org workspace.
2. Verdict words are persona-specific in the transcript and canonical inside the tooling (APPROVE, REQUEST_CHANGES, BLOCK), so the gate, the Action, and the scorer are the same code for every persona.
3. The mode setting (`GRUMPY_MODE`, `.grumpy.json`, `~/.config/grumpy-reviewer/config.json`) is shared across the cast on purpose: one switch covers every persona a developer has installed.
4. Tenured is installed from the grumpy-reviewer marketplace (`/plugin marketplace add lazy-senior-dev/grumpy-reviewer`), which lists all three personas, so a team adds one marketplace once.
5. The benchmark corpus is smaller than grumpy-reviewer's and each case is original; the needle tier is chosen deterministically from the seeded and clean sets. Numbers are medians over runs and the raw replies are committed.
6. Licensed Apache-2.0 with a NOTICE file, like every repository in the org.
