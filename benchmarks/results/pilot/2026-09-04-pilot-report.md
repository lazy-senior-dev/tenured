# Benchmark results, 2026-09-04

**What is measured.** 12 small diffs, each with exactly one seeded defect, plus 4 clean diffs, plus a needle tier: 4 four-file pull requests of about 150 lines with one of those defects buried among clean changes. Each diff is shown to a headless agent three ways: with no skill, with a generic "review this carefully" prompt, and with grumpy-reviewer's persona card. Every arm gets the same ticket line and the same diff.

**Scores.** *Caught* means the reviewer flagged the change (a FAIL, REQUEST_CHANGES, or BLOCK verdict) and named the seeded defect (its file plus the defect's key terms). *False positives* are clean diffs that were flagged. *BLOCK precision* is, of the diffs the Grump marked BLOCK, the share whose seeded defect is a BLOCK-class defect (secrets, injection, auth, data loss, destructive or privileged operations). Medians are across runs; the per-diff table shows hits over runs.

## Claude Code

Model per arm is listed in the table. 120 calls, 0 errors (errors are excluded from the scores).

| Arm | Model | Runs | Defects caught (median of 12) | Mean | False positives (median of 4) | BLOCK precision | Unparseable replies | Median input tokens | Median output tokens | Median latency |
|---|---|---|---|---|---|---|---|---|---|---|
| no skill | `claude-sonnet-5` | 2 | **12** | 11.5 | 4 | n/a | 0 | 5714 | 370 | 6.6 s |
| generic review prompt | `claude-sonnet-5` | 2 | **12** | 12.0 | 4 | n/a | 1 | 5820 | 794 | 11.4 s |
| tenured | `claude-sonnet-5` | 2 | **12** | 12.0 | 0 | 50% (20 blocks) | 0 | 7618 | 700 | 9.7 s |

### Needle tier: one defect in a four-file pull request

| Arm | Model | Runs | Defects found (median of 4) | Mean | Unparseable | Median input tokens | Median latency |
|---|---|---|---|---|---|---|---|
| no skill | `claude-sonnet-5` | 2 | **3** | 3.0 | 0 | 6850 | 12.0 s |
| generic review prompt | `claude-sonnet-5` | 2 | **4** | 4.0 | 0 | 6959 | 54.8 s |
| tenured | `claude-sonnet-5` | 2 | **4** | 4.0 | 0 | 8755 | 25.0 s |

Needle cases are built from the seeded and clean sets (`benchmarks/lib/cases.mjs`): the defect's file must be named for a catch to count.

Overhead of the persona card: about 1905 input tokens per review over the no-skill arm.

### Per diff (hits / runs)

| Diff | Category | Expected | no skill | generic review prompt | tenured |
|---|---|---|---|---|---|
| `t01-resurrected-unbounded-retry` | resurrection | BLOCK | 2/2 | 2/2 | 2/2 |
| `t02-reverted-before-flag-default` | reverted-before | BLOCK | 2/2 | 2/2 | 2/2 |
| `t03-warning-comment-ignored` | warnings | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t04-deprecated-api` | deprecated | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t05-copied-config-missing-tls` | copied-config | BLOCK | 2/2 | 2/2 | 2/2 |
| `t06-half-migration-old-side` | half-migration | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t07-owner-rejected-before` | ownership | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t08-metric-name-collision` | naming-collision | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t09-postmortem-match-cache-stampede` | postmortem | BLOCK | 2/2 | 2/2 | 2/2 |
| `t10-dependency-removed-for-cve` | resurrection | BLOCK | 1/2 | 2/2 | 2/2 |
| `t11-adr-sync-call-in-request-path` | warnings | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t12-deleted-cron-readded` | resurrection | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `u01-new-feature-with-note` | clean | no flag | 2/2 | 1/2 | 0/2 |
| `u02-respects-deprecation` | clean | no flag | 2/2 | 2/2 | 0/2 |
| `u03-bounded-retry-kept` | clean | no flag | 2/2 | 2/2 | 0/2 |
| `u04-new-metric-new-name` | clean | no flag | 2/2 | 2/2 | 0/2 |
| `n01-t01-resurrected-unbounded-retry` | needle: resurrection | BLOCK | 2/2 | 2/2 | 2/2 |
| `n02-t04-deprecated-api` | needle: deprecated | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `n03-t07-owner-rejected-before` | needle: ownership | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `n04-t10-dependency-removed-for-cve` | needle: resurrection | BLOCK | 0/2 | 2/2 | 2/2 |

For clean diffs the cell counts false positives, so lower is better.

## Codex CLI

Model per arm is listed in the table. 120 calls, 0 errors (errors are excluded from the scores).

| Arm | Model | Runs | Defects caught (median of 12) | Mean | False positives (median of 4) | BLOCK precision | Unparseable replies | Median input tokens | Median output tokens | Median latency |
|---|---|---|---|---|---|---|---|---|---|---|
| no skill | `codex-default` | 2 | **12** | 11.5 | 4 | n/a | 0 | 14117 | 168 | 7.0 s |
| generic review prompt | `codex-default` | 2 | **12** | 12.0 | 4 | n/a | 0 | 43239 | 870 | 21.7 s |
| tenured | `codex-default` | 2 | **12** | 12.0 | 0 | 53% (17 blocks) | 0 | 15384 | 126 | 6.4 s |

### Needle tier: one defect in a four-file pull request

| Arm | Model | Runs | Defects found (median of 4) | Mean | Unparseable | Median input tokens | Median latency |
|---|---|---|---|---|---|---|---|
| no skill | `codex-default` | 2 | **4** | 4.0 | 0 | 14766 | 14.1 s |
| generic review prompt | `codex-default` | 2 | **4** | 4.0 | 0 | 14807 | 21.2 s |
| tenured | `codex-default` | 2 | **4** | 4.0 | 0 | 16041 | 10.0 s |

Needle cases are built from the seeded and clean sets (`benchmarks/lib/cases.mjs`): the defect's file must be named for a catch to count.

Overhead of the persona card: about 1268 input tokens per review over the no-skill arm.

### Per diff (hits / runs)

| Diff | Category | Expected | no skill | generic review prompt | tenured |
|---|---|---|---|---|---|
| `t01-resurrected-unbounded-retry` | resurrection | BLOCK | 2/2 | 2/2 | 2/2 |
| `t02-reverted-before-flag-default` | reverted-before | BLOCK | 2/2 | 2/2 | 2/2 |
| `t03-warning-comment-ignored` | warnings | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t04-deprecated-api` | deprecated | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t05-copied-config-missing-tls` | copied-config | BLOCK | 2/2 | 2/2 | 2/2 |
| `t06-half-migration-old-side` | half-migration | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t07-owner-rejected-before` | ownership | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t08-metric-name-collision` | naming-collision | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t09-postmortem-match-cache-stampede` | postmortem | BLOCK | 2/2 | 2/2 | 2/2 |
| `t10-dependency-removed-for-cve` | resurrection | BLOCK | 1/2 | 2/2 | 2/2 |
| `t11-adr-sync-call-in-request-path` | warnings | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t12-deleted-cron-readded` | resurrection | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `u01-new-feature-with-note` | clean | no flag | 2/2 | 2/2 | 0/2 |
| `u02-respects-deprecation` | clean | no flag | 1/2 | 2/2 | 0/2 |
| `u03-bounded-retry-kept` | clean | no flag | 2/2 | 2/2 | 0/2 |
| `u04-new-metric-new-name` | clean | no flag | 2/2 | 2/2 | 0/2 |
| `n01-t01-resurrected-unbounded-retry` | needle: resurrection | BLOCK | 2/2 | 2/2 | 2/2 |
| `n02-t04-deprecated-api` | needle: deprecated | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `n03-t07-owner-rejected-before` | needle: ownership | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `n04-t10-dependency-removed-for-cve` | needle: resurrection | BLOCK | 2/2 | 2/2 | 2/2 |

For clean diffs the cell counts false positives, so lower is better.

## IBM Bob Shell

Model per arm is listed in the table. 120 calls, 4 errors (errors are excluded from the scores).

| Arm | Model | Runs | Defects caught (median of 12) | Mean | False positives (median of 4) | BLOCK precision | Unparseable replies | Median input tokens | Median output tokens | Median latency |
|---|---|---|---|---|---|---|---|---|---|---|
| no skill | `bob-default` | 2 | **12** | 11.5 | 4 | n/a | 0 | 0 | 0 | 13.4 s |
| generic review prompt | `bob-default` | 2 | **12** | 11.5 | 2 | n/a | 4 | 0 | 0 | 14.1 s |
| tenured | `bob-default` | 2 | **12** | 11.5 | 1 | 53% (19 blocks) | 3 | 0 | 0 | 6.3 s |

### Needle tier: one defect in a four-file pull request

| Arm | Model | Runs | Defects found (median of 4) | Mean | Unparseable | Median input tokens | Median latency |
|---|---|---|---|---|---|---|---|
| no skill | `bob-default` | 2 | **4** | 4.0 | 0 | 0 | 19.7 s |
| generic review prompt | `bob-default` | 2 | **4** | 3.5 | 0 | 0 | 22.5 s |
| tenured | `bob-default` | 2 | **4** | 4.0 | 0 | 0 | 17.8 s |

Needle cases are built from the seeded and clean sets (`benchmarks/lib/cases.mjs`): the defect's file must be named for a catch to count.

Overhead of the persona card: about 0 input tokens per review over the no-skill arm.

### Per diff (hits / runs)

| Diff | Category | Expected | no skill | generic review prompt | tenured |
|---|---|---|---|---|---|
| `t01-resurrected-unbounded-retry` | resurrection | BLOCK | 2/2 | 2/2 | 2/2 |
| `t02-reverted-before-flag-default` | reverted-before | BLOCK | 1/1 | 2/2 | 2/2 |
| `t03-warning-comment-ignored` | warnings | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t04-deprecated-api` | deprecated | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t05-copied-config-missing-tls` | copied-config | BLOCK | 2/2 | 2/2 | 2/2 |
| `t06-half-migration-old-side` | half-migration | REQUEST_CHANGES | 2/2 | 1/1 | 1/2 |
| `t07-owner-rejected-before` | ownership | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t08-metric-name-collision` | naming-collision | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t09-postmortem-match-cache-stampede` | postmortem | BLOCK | 2/2 | 2/2 | 2/2 |
| `t10-dependency-removed-for-cve` | resurrection | BLOCK | 2/2 | 2/2 | 2/2 |
| `t11-adr-sync-call-in-request-path` | warnings | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `t12-deleted-cron-readded` | resurrection | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `u01-new-feature-with-note` | clean | no flag | 2/2 | 0/2 | 0/2 |
| `u02-respects-deprecation` | clean | no flag | 2/2 | 0/2 | 0/2 |
| `u03-bounded-retry-kept` | clean | no flag | 2/2 | 2/2 | 2/2 |
| `u04-new-metric-new-name` | clean | no flag | 1/1 | 2/2 | 0/2 |
| `n01-t01-resurrected-unbounded-retry` | needle: resurrection | BLOCK | 2/2 | 2/2 | 2/2 |
| `n02-t04-deprecated-api` | needle: deprecated | REQUEST_CHANGES | 2/2 | 1/1 | 2/2 |
| `n03-t07-owner-rejected-before` | needle: ownership | REQUEST_CHANGES | 2/2 | 2/2 | 2/2 |
| `n04-t10-dependency-removed-for-cve` | needle: resurrection | BLOCK | 2/2 | 2/2 | 2/2 |

For clean diffs the cell counts false positives, so lower is better.

## Antigravity CLI

Model per arm is listed in the table. 12 calls, 0 errors (errors are excluded from the scores).

| Arm | Model | Runs | Defects caught (median of 12) | Mean | False positives (median of 4) | BLOCK precision | Unparseable replies | Median input tokens | Median output tokens | Median latency |
|---|---|---|---|---|---|---|---|---|---|---|
| no skill | `agy-default` | 1 | **5** | 5.0 | 0 | n/a | 0 | 19509 | 1848 | 40.8 s |
| generic review prompt | `agy-default` | 1 | **4** | 4.0 | 0 | n/a | 0 | 19572 | 5239 | 46.8 s |
| tenured | `agy-default` | 1 | **3** | 3.0 | 0 | 100% (2 blocks) | 0 | 20932 | 30977 | 80.7 s |

Overhead of the persona card: about 1423 input tokens per review over the no-skill arm.

### Per diff (hits / runs)

| Diff | Category | Expected | no skill | generic review prompt | tenured |
|---|---|---|---|---|---|
| `t01-resurrected-unbounded-retry` | resurrection | BLOCK | 1/1 | 1/1 | 1/1 |
| `t02-reverted-before-flag-default` | reverted-before | BLOCK | 1/1 | 1/1 | 1/1 |
| `t03-warning-comment-ignored` | warnings | REQUEST_CHANGES | 1/1 | 1/1 | - |
| `t04-deprecated-api` | deprecated | REQUEST_CHANGES | 1/1 | 1/1 | 1/1 |
| `t05-copied-config-missing-tls` | copied-config | BLOCK | 1/1 | - | - |
| `t06-half-migration-old-side` | half-migration | REQUEST_CHANGES | - | - | - |
| `t07-owner-rejected-before` | ownership | REQUEST_CHANGES | - | - | - |
| `t08-metric-name-collision` | naming-collision | REQUEST_CHANGES | - | - | - |
| `t09-postmortem-match-cache-stampede` | postmortem | BLOCK | - | - | - |
| `t10-dependency-removed-for-cve` | resurrection | BLOCK | - | - | - |
| `t11-adr-sync-call-in-request-path` | warnings | REQUEST_CHANGES | - | - | - |
| `t12-deleted-cron-readded` | resurrection | REQUEST_CHANGES | - | - | - |
| `u01-new-feature-with-note` | clean | no flag | - | - | - |
| `u02-respects-deprecation` | clean | no flag | - | - | - |
| `u03-bounded-retry-kept` | clean | no flag | - | - | - |
| `u04-new-metric-new-name` | clean | no flag | - | - | - |
| `n01-t01-resurrected-unbounded-retry` | needle: resurrection | BLOCK | - | - | - |
| `n02-t04-deprecated-api` | needle: deprecated | REQUEST_CHANGES | - | - | - |
| `n03-t07-owner-rejected-before` | needle: ownership | REQUEST_CHANGES | - | - | - |
| `n04-t10-dependency-removed-for-cve` | needle: resurrection | BLOCK | - | - | - |

For clean diffs the cell counts false positives, so lower is better.

## Method

- Cases live in `benchmarks/seeded/<id>/` (`diff.patch` plus a hidden `answer.json` with the file, lines, defect class, and the key terms a finding must name) and `benchmarks/clean/<id>/`. They are original and written for this benchmark.
- Arms are defined in `benchmarks/lib/arms.mjs`. The Grump arm uses `hooks/persona.md`, the exact text the hooks inject, as the system prompt. Nothing else differs between arms.
- Agents run headless with tools disabled and a single turn: `claude -p --safe-mode --tools ""`, `codex exec --sandbox read-only --ignore-user-config`, `agy -p --mode plan`, or the Messages API directly. The runner is `benchmarks/run.mjs`; the scorer is `benchmarks/lib/score.mjs` and is unit-tested against a fixture.
- Every raw reply is kept in `benchmarks/results/raw/<agent>.jsonl`, so any number here can be re-derived: `npm run bench:report`.

## Limitations

- Thirty seeded defects is a small set; a difference of one or two catches between arms is noise. Read the direction, not the decimals.
- The key-term matcher is deliberately strict: a reviewer that flags the right line but describes the defect in unexpected words scores as "flagged, missed the defect". That penalises every arm equally, but it means the absolute numbers are a floor.
- Diffs are shown without the surrounding repository. Some defects (an unchecked user id, a missing authorisation check) are easier to spot with the codebase in view; others (a needless dependency) are harder. Real reviews have more context and more noise.
- Agents are non-deterministic and change between releases. The model and CLI version are recorded per run; numbers from different dates are not comparable.
- The Grump arm is asked for a fixed verdict block; the other arms are asked for a PASS/FAIL line. Both are one line of instruction; neither says what to look for.

Reproduce: `npm run bench` then `npm run bench:report`. Add `--agents claude` or `--only s01` to `npm run bench --` to narrow a run.
