# PicklePicklePickle

Event management platform for [XCHC](https://xchc.co.nz), Ōtautahi Christchurch.

One record of an event, one record of a person, one record of an hour.

## Getting started

**With the devcontainer (recommended)** — open the repo in VS Code and choose
"Reopen in Container". Postgres, Node, `gh` and the migrations are all set up
for you.

**Without it** — you still need Postgres, and the same compose file will give
you one on `localhost:5432`:

```bash
docker compose -f .devcontainer/docker-compose.yml up -d db
cp .env.example .env      # then fill in AUTH_SECRET: npx auth secret
npm ci
npm run db:migrate
npm run dev
```

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
| `src/app/g/[token]/`    | The one page seen by people with no account — see below          |
| `src/lib/finance.ts`    | Settlement mathematics. Specification-grade — see CLAUDE.md      |
| `src/lib/secrets.ts`    | Sealing for payment details. The only encrypted columns we have  |
| `src/styles/tokens.css` | The Nocturne design system's tokens. Nothing hard-codes a colour |
| `prisma/schema.prisma`  | Domain model                                                     |
| `docs/design-handoff/`  | The design prototype and its README. Read-only reference         |
| `.claude/`              | Shared Claude Code settings and project skills                   |

## Files and payment details

Riders, tech specs, press shots and artwork live in Cloudflare R2. The bytes
never pass through this application: the browser PUTs straight to a presigned
URL and reads back from a presigned GET, so a 300MB print PDF is not a 300MB
request against the Next server. What the app stores is the description of a
file, in `StoredFile`.

Bank and IRD numbers are the only encrypted columns in the schema — AES-256-GCM,
sealed in `src/lib/secrets.ts`, keyed from `PAYMENT_KEY`. The last three digits
sit beside them in the clear so Finance can tell two accounts apart without
decrypting either.

Artists and promoters enter their own details rather than emailing them:

- **Promoters** have accounts, and use **Sign-offs** (`/portal`).
- **Touring acts** do not. A coordinator issues a single-use link from **Tech
  production**, which reaches `/g/<token>` — no session, no sidebar, nothing to
  navigate to. Only the SHA-256 of the token is stored, so a database read
  hands over no working links.

Two things gate this in production:

1. **`PAYMENT_KEY` must be set.** Without it the forms decline politely and the
   server logs loudly. Losing the key means every detail on file has to be
   collected again — it is not recoverable from the database.
2. **A real session must back the request.** A session from the development
   role picker carries `authenticated: false`, and `canReveal` refuses every
   decrypt in production without it — anyone who can set that cookie could
   otherwise be the finance lead. Configuring a provider (see below) is what
   satisfies this; there is no flag to flip.

Without R2 configured, every other part of both modules still works — uploads
say so rather than failing.

## Signing in

There is **no sign-up**. `createUser` in `src/lib/auth.ts` throws, so somebody
arriving with a perfectly good Google account gets nothing until an
administrator has added their address in **Admin**. That is deliberate: this is
one venue's internal tool, and a provider vouching for an email is not the same
as XCHC having decided somebody works here.

Two ways in, each switched on by whether it is configured:

| Who                | Provider     | Keys                                   |
| ------------------ | ------------ | -------------------------------------- |
| Venue staff        | Google       | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` |
| External promoters | Emailed link | `AUTH_RESEND_KEY`, `EMAIL_FROM`        |

Sessions are stored in the database rather than in a JWT, so switching somebody
off in Admin ends the session they already have open. A token cannot be taken
back; a row can.

**Google setup:** console.cloud.google.com → APIs & Services → Credentials →
OAuth client ID → Web application. Authorised redirect URI is
`<your-url>/api/auth/callback/google`.

Until either provider is configured, the development role picker on `/sign-in`
stands in. It is unavailable in production (`stubAllowed` in `session.ts`) and
the sessions it grants are marked `authenticated: false`, so it can drive every
module but can never open a payment detail — see `canReveal` in `payments.ts`.

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
