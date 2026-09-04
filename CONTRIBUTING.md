# Contributing

Tenured gets better one missed defect at a time. The most useful thing you can send is a diff he should have caught and did not.

## Report a defect that slipped past him

Open a [Slipped past him](https://github.com/lazy-senior-dev/tenured/issues/new?template=slipped-past-him.yml) issue with the diff (anonymised is fine), the verdict he printed, and what actually broke. If it is a good case it becomes a seeded diff in `benchmarks/seeded/` and, if a rule change fixes it, a line in `rules/grump.md`.

## Propose a rule

Open a [Rule proposal](https://github.com/lazy-senior-dev/tenured/issues/new?template=rule-proposal.yml). A rule needs a real failure it would have prevented. "It would be cleaner" is not a rule; Tenured does not block on taste, and neither does this repo.

## Change the rules or the adapters

1. Edit `rules/grump.md`. It is the only hand-written copy of the ruleset.
2. Run `npm run build` to regenerate every adapter, then `npm test` and `npm run check`.
3. Keep the ruleset short. Rules files are injected into every turn on some hosts and Windsurf caps a rules file at 12,000 characters; the tests enforce that.
4. Commit the regenerated files with your change. CI fails on stale adapters.

## Add a host

Add a renderer in `scripts/lib/render.mjs`, a row in `docs/agent-portability.md` with the documentation URL you verified and the date, and an install and uninstall line in the README. If you could not verify the host's format against its docs, say so in the table; an honest "unverified" beats a confident guess.

## Add a benchmark case

Create `benchmarks/seeded/<id>/diff.patch` (first line `Ticket: KEY "what was asked"`, then a unified diff of 20 to 60 lines with exactly one defect) and `answer.json` with `file`, `lines`, `category`, `verdict` (`DO_NOT_REPEAT` or `SEEN_BEFORE`), `defect`, and `match` (regex alternations that a finding must all satisfy). Clean diffs go in `benchmarks/clean/` with `"clean": true`. Cases must be original; do not paste code from other projects.

## Style

Plain conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`). No emoji. Node 20 or newer, no runtime dependencies. `npm run check` runs the attribution guard; it fails on co-author trailers and stray email addresses, so commit as yourself.

## Running things

```
npm test            # node --test
npm run build       # regenerate adapters from rules/grump.md
npm run check       # adapters fresh, manifests valid, attribution clean
npm run bench       # benchmark against whatever headless agent is installed
npm run bench:report
```

## Fake secrets in benchmark cases

Seeded secrets must look real to a reviewer without matching a real provider format: use invented prefixes (`psk-live-`, `chatbot-`) rather than the prefixes scanners recognise, or GitHub push protection will refuse the commit that carries them.
