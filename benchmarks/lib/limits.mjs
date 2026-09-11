// SPDX-FileCopyrightText: 2026 Sandeep Bazar
// SPDX-License-Identifier: Apache-2.0
// Was this run refused, or did it finish and merely talk about being refused?
//
// The distinction is not academic here. A refusal must abort the pass, because every remaining job
// would be refused too. But these benchmarks ask agents to write retry loops, mailers and HTTP error
// handling, so a *successful* reply routinely contains "rate limit", "too many requests" and "429".
// Treating the reply the same way as the CLI's own output threw away finished work and ended passes
// after a handful of runs.
//
// So: two speakers, two standards. stderr is the CLI, where any of these phrasings means what it
// says. stdout is the agent, where only an unambiguous refusal counts -- unless the process also
// failed, in which case the looser reading is fair again.

export const LIMIT_CLI = /hit your (session|usage) limit|usage limit|rate limit|turn\.failed|quota (reached|exceeded)|upgrade your subscription|too many requests|\b429\b/i;
export const LIMIT_REFUSAL = /you'?ve hit your (session|usage) limit|(session|usage) limit reached|quota (reached|exceeded)|upgrade your subscription/i;

export function isRefusal({ text = "", stderr = "", exit = 0 } = {}) {
  if (LIMIT_CLI.test(stderr)) return true;
  if (LIMIT_REFUSAL.test(text)) return true;
  return exit !== 0 && LIMIT_CLI.test(text);
}
