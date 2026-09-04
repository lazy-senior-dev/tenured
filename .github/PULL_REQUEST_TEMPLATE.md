## What the ticket asked

<!-- One line. If there is no ticket, say what problem this solves. -->

## Self-review

Answer each in a line. Tenured will ask anyway.

1. **Scope.** Does this do what was asked and nothing else? What is in here that was not asked for?
2. **Inputs.** Empty, absent, oversized, malformed, duplicated, concurrent: where does each go?
3. **Errors.** Where does each error go, and does the caller find out?
4. **Off-diff changes.** Schema, config, env, permissions, flags: listed here or in the runbook?
5. **Dependencies.** Is every new one earning its place?
6. **Trust boundaries.** Secrets out of code and logs, PII minimised, caller authorised for this resource, input parameterised?
7. **Tests.** At the boundary where it breaks, not where it is convenient?
8. **Rollback.** Revert and deploy, or does it need a migration?
9. **Observability.** Would on-call understand the new log line at 3 a.m.?
10. **Naming and dead code.** Only if 1 to 9 are clean.

## For changes to rules/ or scripts/lib/render.mjs

- [ ] `npm run build` was run and the regenerated adapters are in this PR
- [ ] `npm test` and `npm run check` pass
