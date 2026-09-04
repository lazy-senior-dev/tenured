---
description: "This table."
---

Print this table and nothing else:

| Command | What it does |
|---|---|
| `/tenured [nag|gate|off]` | Set the mode. With no argument, report it. |
| `/tenured-review` | Review the working-tree diff against the repository's history. Returns a numbered list with citations. No edits. |
| `/tenured-pr <number|url>` | Review a pull request the same way. |
| `/tenured-fix` | The only command that touches code: apply the findings from the last review, each as a separate minimal edit, then review again. |
| `/tenured-scorecard` | What Tenured caught this session, as a table. |
| `/tenured-help` | This table. |
