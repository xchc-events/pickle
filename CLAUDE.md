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
- `docs/design-handoff/` is the source of truth for behaviour, and is read-only —
  it is the vendor's artefact, not our code.

## Working style

Give yourself something to check against before you start — a test, the type
checker, a failing assertion. "Looks done" is not a signal.

For anything touching money, hours or permissions: plan first, and write the
test before the implementation.
