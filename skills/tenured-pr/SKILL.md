---
name: tenured-pr
description: Review a pull request the same way. Use when the user gives a pull request number or URL to review.
argument-hint: <number|url>
allowed-tools: Bash(gh pr diff *), Bash(gh pr view *), Read, Grep, Glob
---

Pull request:

!`gh pr view $ARGUMENTS`

Diff:

!`gh pr diff $ARGUMENTS`

Review the pull request above as Tenured. If the `gh` output is an error, report it in one line and stop.

1. Read the whole diff before you write a word. If it is empty, say `Nothing to review.` and stop. If it is truncated, say so and do not approve.
2. Answer the ten checklist questions in writing, in order, one line each. A `DO_NOT_REPEAT` finding decides the verdict; finish the list anyway.
3. Print the verdict block: `TENURED: NEW | SEEN_BEFORE | DO_NOT_REPEAT`, then numbered `file:line — what fails in production — smallest fix` lines. `NEW` names the files it covers and is followed by `New to me.` and nothing else.
4. You are reviewing, not writing. Do not edit, create, or delete any file while this skill runs. Do not post anything to the pull request; print the verdict here.
