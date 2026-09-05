# Agent portability

One ruleset, `rules/grump.md`, rendered by `npm run build` into the file each host reads. This page says which file that is, what the host can enforce, how to install, and how to remove it. Nothing here is hand-written twice: if a row disagrees with the repo, the repo wins and this page has a bug.

Hosts fall into three tiers:

- **Gate hosts** run lifecycle hooks. Tenured is injected every turn and the `PreToolUse` gate can deny a write or a commit until a verdict is printed.
- **MCP clients** connect to the stdio server in `mcp/` and call its tools. Any client that speaks the Model Context Protocol works without a file in this repository, which covers the editors and desktop apps that have no adapter here.
- **Instruction hosts** load a rules file. Tenured reviews in the conversation; nothing is enforced.

## What each host reads

| Host | Tier | Files the host reads | Slash commands | Verified against | Checked |
|---|---|---|---|---|---|
| Claude Code | gate | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/*/SKILL.md`, `hooks/hooks.json` | `/tenured:grumpy`, `:grumpy-review`, `:grumpy-pr`, `:grumpy-fix`, `:grumpy-scorecard`, `:grumpy-help` | [plugins reference](https://code.claude.com/docs/en/plugins-reference), [hooks](https://code.claude.com/docs/en/hooks), [skills](https://code.claude.com/docs/en/skills) | 2026-09-04 |
| Codex | gate | `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, `skills/*/SKILL.md`, `hooks/hooks.json` | skills via `$grumpy-review` and friends | [plugins](https://developers.openai.com/codex/plugins/build), [hooks](https://developers.openai.com/codex/hooks) | 2026-09-04; the `${CLAUDE_PLUGIN_ROOT}` placeholder in `hooks/hooks.json` is not documented for Codex (see notes) |
| GitHub Copilot CLI | gate | `.github/plugin/plugin.json`, `.github/plugin/marketplace.json` (Copilot also reads `.claude-plugin/marketplace.json`), `skills/`, `hooks/copilot-hooks.json` | skills | [marketplace](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace), [hooks reference](https://docs.github.com/en/copilot/reference/hooks-configuration) | 2026-09-04; plugin `hooks` path resolution unverified (see notes) |
| Gemini CLI format (served by Antigravity CLI) | instruction + commands | `gemini-extension.json`, `GEMINI.md`, `commands/*.toml` | `/tenured-review`, `/tenured-pr`, `/tenured-fix`, `/tenured`, `/tenured-scorecard`, `/tenured-help` | [extensions reference](https://geminicli.com/docs/extensions/reference/), [custom commands](https://geminicli.com/docs/cli/custom-commands/), [hooks](https://geminicli.com/docs/hooks/); exercised through Antigravity, which imports this exact format | 2026-09-04; hooks optional via `examples/gemini-settings-hooks.json` |
| OpenCode | gate (two-phase) | `.opencode/plugins/grumpy.mjs`, `.opencode/command/*.md`, `AGENTS.md` | `/tenured-review` and friends | [plugins](https://opencode.ai/docs/plugins/), [plugin types](https://github.com/sst/opencode/blob/dev/packages/plugin/src/index.ts) | 2026-09-04; command frontmatter beyond `description` unverified |
| Cursor | gate | `.cursor/rules/grumpy.mdc`, `examples/cursor-hooks.json` (`alwaysApply: true`), `AGENTS.md` | none | [rules](https://cursor.com/docs/context/rules), [hooks](https://cursor.com/docs/agent/hooks) | 2026-09-04; Cursor has a `preToolUse` hook, not shipped in this release |
| Windsurf / Devin Desktop | instruction | `.windsurf/rules/grumpy.md` (`trigger: always_on`, 12,000 char limit), `AGENTS.md` | none | [rules](https://docs.devin.ai/desktop/cascade/memories) | 2026-09-04 |
| Cline | instruction | `.clinerules/grumpy.md` | none | [rules](https://docs.cline.bot/customization/cline-rules) | 2026-09-04; Cline hooks are documented only for the SDK, not shipped |
| Kiro | instruction | `.kiro/steering/grumpy.md` (`inclusion: always`), `AGENTS.md` | none | [steering](https://kiro.dev/docs/steering/), [hooks](https://kiro.dev/docs/hooks/) | 2026-09-04; Kiro `PreToolUse` hooks can block but the stdin schema is undocumented, so not shipped |
| OpenClaw | instruction (skill) | `.openclaw/skills/tenured/SKILL.md` | `$tenured` | [skills](https://github.com/openclaw/openclaw/blob/main/docs/tools/skills.md) | 2026-09-04 |
| Devin CLI | instruction | `.devin-plugin/plugin.json`, `skills/`, `AGENTS.md` | skills | [plugins](https://docs.devin.ai/cli/extensibility/plugins/overview), [rules](https://docs.devin.ai/cli/extensibility/rules) | 2026-09-04; Devin `hooks.json` events documented, schema not, so not shipped |
| Qoder | instruction | `.qoder-plugin/plugin.json`, `.qoder/rules/grumpy.md`, `skills/`, `AGENTS.md` | skills | [rules](https://docs.qoder.com/user-guide/rules), [plugins](https://docs.qoder.com/cli/plugins-reference) | 2026-09-04; `trigger` frontmatter in `.qoder/rules/*.md` unverified (Qoder documents the four trigger types, not the file syntax) |
| Antigravity CLI | gate (imported) | Imports this repo through the Gemini extension format: `gemini-extension.json`, `GEMINI.md`, `commands/*.toml`, `skills/`, `hooks/` | `/tenured-help` and friends | Tested locally: `agy plugin install <clone>` imported 6 skills, 6 commands, 1 hook set, and `agy -p "/tenured-help"` printed the command table (agy 1.1.22). Google now serves individual Gemini CLI users through Antigravity, so this is the live path for the Gemini adapter | 2026-09-04; no public schema document, so behaviour of the imported hook is unverified |
| IBM Bob (Bob Shell) | gate | `AGENTS.md`, `.bob/rules/grumpy.md`, `.bob/skills/tenured/SKILL.md`, `.bob/commands/grumpy-*.md`, hooks in `.bob/settings.json` | `/tenured-review` and friends | [custom rules](https://bob.ibm.com/docs/shell/configuration/bobshell-custom-rules), [skills](https://bob.ibm.com/docs/shell/features/skills), [slash commands](https://bob.ibm.com/docs/shell/features/slash-commands), [lifecycle hooks](https://bob.ibm.com/docs/shell/configuration/lifecycle-hooks); tool names taken from Bob Shell 2.0.2's bundle | 2026-09-04; hook stdin is `{event, session_id, tool, input}` and exit 2 blocks, which the gate speaks with `--host bob`; headless benchmarking needs `BOB_API_KEY` |
| Any AGENTS.md host | instruction | `AGENTS.md` | none | [agents.md](https://agents.md) | 2026-09-04 |

## Install

| Host | Command |
|---|---|
| Claude Code | `/plugin marketplace add lazy-senior-dev/tenured` then `/plugin install tenured@lazy-senior-dev` |
| Codex | Clone the repo, then point `~/.agents/plugins/marketplace.json` at it (see the [Codex install steps](../README.md#codex)) and enable it from `/plugins` |
| GitHub Copilot CLI | `copilot plugin marketplace add lazy-senior-dev/tenured` then `copilot plugin install tenured@lazy-senior-dev` |
| Gemini CLI | `gemini extensions install https://github.com/lazy-senior-dev/tenured` |
| OpenCode | Copy `.opencode/plugins/grumpy.mjs` into your project's `.opencode/plugins/` (or `~/.config/opencode/plugins/`), and `AGENTS.md` into the project root |
| Cursor | Copy `.cursor/rules/grumpy.mdc` into your project, and `examples/cursor-hooks.json` to `.cursor/hooks.json` for the write gate |
| GitHub Copilot code review | Copy `.github/skills/tenured/SKILL.md` into your repository |
| Windsurf / Devin Desktop | Copy `.windsurf/rules/grumpy.md` into your project |
| Cline | Copy `.clinerules/grumpy.md` into your project's `.clinerules/` |
| Kiro | Copy `.kiro/steering/grumpy.md` into your project |
| OpenClaw | Copy `.openclaw/skills/tenured/` into your workspace `skills/` |
| Devin CLI | `devin plugins install lazy-senior-dev/tenured` |
| Qoder | `/plugin marketplace add lazy-senior-dev/tenured` then `/plugins install tenured` |
| Antigravity CLI | `git clone https://github.com/lazy-senior-dev/tenured ~/.tenured && agy plugin install ~/.tenured` |
| IBM Bob | `npx github:lazy-senior-dev/tenured install bob` |
| Anything else | Copy `AGENTS.md` into your project root, or `npx github:lazy-senior-dev/tenured install agents` |

## Uninstall

| Host | Command or file to remove |
|---|---|
| Claude Code | `/plugin uninstall tenured@lazy-senior-dev` |
| Codex | Disable in `/plugins`, then remove the entry from `~/.agents/plugins/marketplace.json` |
| GitHub Copilot CLI | `copilot plugin uninstall tenured` |
| Gemini CLI | `gemini extensions uninstall tenured` |
| OpenCode | Delete `.opencode/plugins/grumpy.mjs` and the `.opencode/command/grumpy-*.md` files |
| Cursor | Delete `.cursor/rules/grumpy.mdc` and the hooks entries from `.cursor/hooks.json` |
| Windsurf / Devin Desktop | Delete `.windsurf/rules/grumpy.md` |
| Cline | Delete `.clinerules/grumpy.md` |
| Kiro | Delete `.kiro/steering/grumpy.md` |
| OpenClaw | Delete `skills/tenured/` from the workspace |
| Devin CLI | `devin plugins uninstall tenured` |
| Qoder | `/plugins uninstall tenured` |
| Antigravity CLI | `agy plugin uninstall tenured` |
| IBM Bob | `npx github:lazy-senior-dev/tenured uninstall bob` |
| Any AGENTS.md host | Delete `AGENTS.md` (or Tenured section of it) |
| Everywhere | `rm -rf ~/.config/tenured` removes the mode setting and scorecards |
| Any MCP client | mcp | none; the client runs `npx -y github:lazy-senior-dev/tenured mcp` | tools `tenured_review_diff`, `tenured_review_staged`, `tenured_review_pr`, `tenured_parse_verdict` | protocol test in `tests/adapters.test.mjs` | `npm test` |
| GitHub Copilot code review | instruction | `.github/skills/tenured/SKILL.md` | none; the reviewer runs on the pull request | Agent Skills frontmatter, read-only | `npm run check` |

## Notes on what is and is not verified

- **Claude Code** is the reference host. Manifest, marketplace, hooks, and skills were checked against the documents linked above on the date shown, and `claude plugin validate .` passes in CI.
- **Codex** reads the same `hooks/hooks.json` shape and event names (`UserPromptSubmit`, `PreToolUse`) and the same `skills/` layout. Its documentation does not name a placeholder for the plugin directory, so the `${CLAUDE_PLUGIN_ROOT}` reference in the shared hooks file is unverified for Codex. If the hooks do not fire, the skills and `AGENTS.md` still apply; the gate does not.
- **Copilot CLI** hooks use their own event names and stdin shape (`toolName`, `toolArgs`) and output (`permissionDecision`). The gate script speaks that dialect with `--host copilot`. Whether a plugin's `hooks` path is resolved relative to the plugin root is not documented; `examples/copilot-repo-hooks.json` is the documented alternative, a `.github/hooks/*.json` file in your own repository that points at a clone of this one.
- **Gemini CLI** hooks live in `settings.json`, not in the extension. `examples/gemini-settings-hooks.json` shows the `BeforeAgent` and `BeforeTool` entries; the gate speaks Gemini's `decision`/`reason` dialect with `--host gemini`.
- **OpenCode** plugins cannot see the transcript, so the gate is two-phase: in `gate` mode the first write to each file is refused with the checklist, the retry goes through. Verdicts are enforced by the conversation, not by the plugin.
- **Cursor**, **Kiro**, and **Devin CLI** all document a pre-tool hook that can block. They are not shipped here because the input each one sends to the hook is not fully documented; they will be added when a maintainer can test them. Until then these hosts are instruction-only.
- **Mode** is shared across all hosts: `GRUMPY_MODE`, then `.grumpy.json` in the repository (or a parent directory), then `~/.config/tenured/config.json`. On instruction hosts the mode is advisory; the agent honours it, nothing enforces it.

## The gate, in one paragraph

On a `PreToolUse` event for `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `apply_patch`, or a `Bash` command containing `git commit`/`push`/`merge`/`rebase`, the gate reads the session transcript (when the host provides its path), finds the `TENURED:` block that applies to this write (the previous completed assistant message, or an earlier one in the turn that names the file), and decides: `DO_NOT_REPEAT` denies in every mode; `SEEN_BEFORE` denies only in `gate`; `NEW` and `OVERRIDE` allow; no verdict denies in `gate` (twice, then lets the write through with a note so a session can never brick) and allows with a reminder in `nag`. Every decision is appended to `~/.config/tenured/scorecard/<session>.jsonl`, which `/tenured-scorecard` prints.
