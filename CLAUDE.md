@AGENTS.md

# PicklePicklePickle

Event management platform for XCHC, Ōtautahi Christchurch. Replaces a
spreadsheet-and-group-chat workflow with one event record every department works
off: enquiry → negotiation → confirmation → design/promo → on sale → rostering →
show week → payout.

**The claim the product has to keep:** one record of an event, one record of a
person, one record of an hour. Every figure shown anywhere resolves back to
hours logged against events and prices set on the event record. Nothing is typed
twice.

## Commands

```bash
npm run check       # format:check + lint + typecheck + test — run this before saying you're done
npm run dev         # Next dev server on :3000
npm run db:migrate  # create + apply a migration (prompts)
npm run db:studio   # browse the database
```

The devcontainer brings up Postgres; outside it you need one on :5432 matching
`.env.example`.

## Non-obvious things

- **Prisma 7 moved the connection URL out of the schema.** It lives in
  `prisma.config.ts` for migrations, and the app connects through the driver
  adapter in `src/lib/db.ts`. Don't add `url` back to `schema.prisma`.
- **`prisma` is pinned exact at 7.10.0** because npm's `latest` tag currently
  points at an 8.0 release candidate with a different CLI. Don't run
  `npm update prisma`.
- **`src/lib/finance.ts` is a specification, not an implementation.** It is
  ported line-for-line from the handoff. Do not tidy the constants or reorder
  the P&L lines without a decision recorded against a real settlement. Any
  change needs a test.
- **Never hard-code a colour, size or radius.** Everything comes from
  `src/styles/tokens.css`.
- **Permissions are server-side.** Hiding a module from a sidebar is not access
  control. External promoters must be scoped in the query, not the view.
- **The activity table is append-only.** Every mutation writes to it; nothing
  updates or deletes it.

## Conventions

- Trunk-based: short-lived branches off `main`, small PRs, merged often.
- Branches: `feat/`, `fix/`, `chore/` + a few words.
- Never commit or push unless asked.
- A PR is meant to land without Connor touching it. See "Opening a PR".
- `docs/design-handoff/` was the source of truth for initial design, but it is
  no longer always the most relevant source of truth. The rest of the docs in that
  folder should be consulted and the most recent taken as the most important.
  Raise any conflicts between different documents before implementing on them.

## Opening a PR

Every PR should merge on its own once CI is green. GitHub only accepts an
auto-merge request while a check is still pending, so do all of this in the
same step as `gh pr create`, before CI can finish:

1. Enable auto-merge with the merge-commit method:
   `gh pr merge <n> --auto --merge`. The app's auto-merge tool defaults to
   squash, so pass `merge` there. Auto-merge is on by default for this repo.
2. Turn on the app's CI monitor for the PR: auto-fix (so the session is woken on
   failing checks, merge conflicts and review comments) and archive-on-close.
3. If GitHub refuses with "Pull request is in clean status", the checks already
   passed. Confirm with
   `gh pr view <n> --json mergeStateStatus,statusCheckRollup,headRefOid`
   (`CLEAN`, both checks `SUCCESS`), then merge directly:
   `gh pr merge <n> --merge --match-head-commit <sha>`. Never `--admin`.

`main` requires a branch to be up to date before it merges. The "Update open PR
branches" workflow merges `main` into every open PR after each push to `main`,
which re-runs CI and lets auto-merge fire, so don't update branches by hand. A
conflict-free update can still fail CI (a type made required on `main`, a
fixture added on the branch), which is what the auto-fix wake-up is for. Keep
the session open until the PR has merged.

## Working style

Fully test driven development. Tests should show up with clear naming conventions
and pass/fail indicators in terminal when a server is deployed either locally or in production.
If there are any legacy functions or critical components that do not have tests written for them
then tests will be written as they are found lacking.

For anything touching money, hours or permissions: plan first, and write the
test before the implementation.
