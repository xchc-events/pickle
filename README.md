# PicklePicklePickle

Event management platform for [XCHC](https://xchc.co.nz), Ōtautahi Christchurch.

One record of an event, one record of a person, one record of an hour.

## Getting started

**With the devcontainer (recommended)** — open the repo in VS Code and choose
"Reopen in Container". Postgres, Node, `gh` and the migrations are all set up
for you.

**Without it:**

```bash
cp .env.example .env      # then fill in AUTH_SECRET: npx auth secret
npm ci
npm run db:migrate
npm run dev
```

You need Postgres on `:5432` matching the `DATABASE_URL` in `.env.example`.

## Before you open a PR

```bash
npm run check
```

Format, lint, typecheck and tests. CI runs the same thing plus a production
build, against a real Postgres.

## Layout

| Path                    | What's in it                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `src/app/`              | Next.js App Router — routes and server components                |
| `src/lib/finance.ts`    | Settlement mathematics. Specification-grade — see CLAUDE.md      |
| `src/styles/tokens.css` | The Nocturne design system's tokens. Nothing hard-codes a colour |
| `prisma/schema.prisma`  | Domain model                                                     |
| `docs/design-handoff/`  | The design prototype and its README. Read-only reference         |
| `.claude/`              | Shared Claude Code settings and project skills                   |

## The design handoff

`docs/design-handoff/README.md` is the specification. The HTML in
`docs/design-handoff/design/` is a working prototype to be **read and
reproduced**, not lifted — it targets a runtime that is not part of this
codebase.

To see it: open `docs/design-handoff/design/Pickle Prototype.dc.html` in a
browser and sign in as Sione Latu (Super admin).

## How the team asks for changes

Non-technical team members write feature requests in the
**PicklePicklePickle — Feature requests** sheet in the XCHC Google Drive. Rows
arrive as user stories; reference them in PRs by their `REQ-nnn` id.
