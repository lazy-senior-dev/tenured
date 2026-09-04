# Security

## What this project touches

tenured runs inside your coding agent and, as a GitHub Action, inside your workflow. The hook scripts read the tool call the agent is about to make and the session transcript the host hands them, and they write a small config and scorecard under `~/.config/tenured/`. They open no network connections. The Action sends pull request diffs to the model provider you configured with your own key, and nothing else, nowhere else.

## Threat model

What Tenured can and cannot do to you, so you can decide where to run him.

| Surface | What it reads | What it writes | Network | Failure mode |
|---|---|---|---|---|
| Hook scripts (`hooks/`) | The tool call the host passes on stdin; the session transcript path the host provides; a `.grumpy.json` in the repository | `~/.config/tenured/` (mode, per-session state, scorecard) | none | Any internal error exits 0 with no output in `nag`; in `gate`, unreadable input is refused rather than guessed. A denied write is the only side effect, and `off` mode disables it. |
| Skills, rules, commands | Nothing; they are text the host injects | Nothing | none | Worst case is a worse review. They cannot run code. |
| `grumpy` CLI | The working-tree or PR diff via `git`/`gh`; Tenured's ruleset | Nothing (`install` writes only the files it lists, never outside the current directory) | Only through the agent you already run (`claude`, `codex`, `agy`, `bob`) or the Messages API with your key | Refuses diffs over 400 KB; exits 2 on any read error. |
| GitHub Action | The pull request diff through the GitHub API with the job's token | One review and its inline comments; updates them in place | The provider you chose, with your key, and `api.github.com` | On forks without secrets it posts one neutral note and exits 0. Every third-party action is pinned to a commit SHA. |
| Adapters generated into your repo | Nothing | Nothing | none | Regenerated from one file; CI fails when they drift. |

No telemetry, no analytics, no phone-home. The only outbound traffic is the diff going to the model provider you configured.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: **Security tab, "Report a vulnerability"** on this repository. Do not open a public issue for security problems.

You will get an acknowledgement within 72 hours and a fix or a clear answer within 14 days for anything that affects the hooks, the Action, or the adapters. Credit goes in the release notes unless you ask otherwise. Maintainer: [Sandeep Bazar](https://www.linkedin.com/in/sandeepbazar/).

## Scope

In scope: the hook scripts, the Action, the generated adapters, the benchmark runner, and this repository's workflows. Out of scope: the behaviour of the underlying model, and the agent hosts themselves, which have their own programmes.

## Supported versions

The latest minor release. Older releases get fixes only if the fix is trivial to backport.
