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
cp .env.example .env      # then fill in PAYMENT_KEY: openssl rand -base64 32
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
   otherwise be the finance lead. Signing in for real — a password or an emailed
   link, see below — is what satisfies this; there is no flag to flip.

Without R2 configured, every other part of both modules still works — uploads
say so rather than failing.

## Signing in

There is **no sign-up**. Nothing on the sign-in path can create an account, so
somebody arriving with a perfectly good email address gets nothing until an
administrator has added it in **Admin**. That is deliberate: this is one venue's
internal tool, and being able to receive mail is not the same as XCHC having
decided somebody works here.

Two ways in, both built in-house in `src/lib/auth.ts` — no OAuth, and no auth
library:

- **Email address and password.** Administrators never see or set a password:
  adding somebody in Admin emails them an **invitation** (a link, valid 7 days)
  to choose their own. Anyone who forgets theirs uses **"Forgotten it, or never
  set one?"** on the sign-in page. That is also how everybody who signed in by
  link before passwords existed gets their first one.
- **A link emailed to the address on the account**, folded away under the
  password form. Still useful for somebody without a password, or whose
  password is throttled.

### What keeps it safe

- **Passwords** are hashed with scrypt from `node:crypto`
  (`src/lib/password.ts`) — no native dependency — at a cost that meets OWASP's
  floor, with the parameters stored in the hash so they can be raised later.
- **The policy** (`src/lib/password-policy.ts`) follows NIST 800-63B rev. 4:
  15 characters minimum, no composition rules, and a refusal of the guessable —
  repeats, keyboard runs, the person's own name or address, the venue's name.
- **Wrong passwords** cost nothing for the first five, then double the wait each
  time up to an hour, and stop password sign-in after 100 in a row until a reset
  (`mayAttemptPassword` in `auth-rules.ts`). It never needs an administrator to
  undo, and the emailed link is never throttled by it — so typing a colleague's
  address wrongly on purpose cannot lock them out.
- **Nothing says whether an address has an account.** A wrong password, an
  unknown address and an account without a password get the same sentence after
  the same amount of work, and every "email me a link" form answers every
  address identically — with the real work done after the response.
- **Sessions are rows in the database**, not JWTs, so switching somebody off in
  Admin, resetting a password, or "sign out everywhere else" ends sessions that
  are already open. Only the SHA-256 of each session token and each emailed link
  is stored. A session lasts 30 days at most, and ends after 14 days unused.
- **Emailed links survive mail scanners.** Opening one spends nothing; the button
  on the page it opens does. Links are built from `AUTH_URL`, never from the
  request, so a reset link cannot be pointed at somebody else's server.
- **Every sign-in, failure, password change and ended session** is written to the
  append-only `AuthEvent` table.

Everybody can see and end their own sessions, and change their password, from
**Your account** (their name at the foot of the sidebar). Changing it needs the
current one, even from inside a session.

**Email setup:** resend.com → add and verify the sending domain → API keys, then
set `AUTH_RESEND_KEY` and `EMAIL_FROM`. `EMAIL_FROM` must be on that verified
domain, e.g. `XCHC <no-reply@send.minim.nz>`. Sign-in email deliberately sends
from a Minim domain rather than `xchc.co.nz`, because XCHC's web presence may
move off that domain around launch. `AUTH_URL` must be the site's public
address — in production, links are not sent without it.

Without email configured, password sign-in still works for anyone who has a
password. In development, invitations and links are **written to the dev
server's log** instead of being sent, so the whole flow can be followed locally.
In production they are refused.

Every link is a real email against a finite quota, so an account can only be sent
one a minute (`LINK_COOLDOWN_SECONDS` in `auth-rules.ts`).

The development role picker on `/sign-in` is still there for switching roles
quickly. It is unavailable in production (`stubAllowed` in `session.ts`) and the
sessions it grants are marked `authenticated: false`, so it can drive every module
but can never open a payment detail — see `canReveal` in `payments.ts` — or
change a password.

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
