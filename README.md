# PicklePicklePickle

[![CI](https://github.com/xchc-events/pickle/actions/workflows/ci.yml/badge.svg)](https://github.com/xchc-events/pickle/actions/workflows/ci.yml)

Event management for [XCHC](https://xchc.co.nz), a music and arts venue in
Ōtautahi Christchurch.

The venue runs its own shows, hosts outside promoters and hires rooms out dry.
That used to run on spreadsheets and group chats. Pickle keeps one record per
event and hangs everything else off it: the booking and its terms, artwork and
listings, ticket pricing, the tech rider, the roster, the hours people actually
work, the bar, and the settlement at the end. Nothing is entered twice, and
every dollar figure on screen traces back to hours logged against an event and
prices set on the event record. One record of an event, one record of a person,
one record of an hour.

It is an internal tool for one venue. There is no sign-up and no multi-tenancy.

## Modules

The sidebar is built from what a role is allowed to open, so different people
see different subsets of this.

| Module          | What it is for                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline        | Every event, with where each of its eight parts stands. Opens the event record.                                                                                        |
| Event record    | The hub for one show: booking status and its gates, holds on the room, artists and terms, licence, run times, department leads, the door count, and the activity feed. |
| Ticketing       | Prices (every tier derives from one standard price), audience mix, attendance scenarios, and the sold count drawn against capacity and breakeven.                      |
| Design          | The house asset set for each event, tiered hero / lead / support, with approvals, change requests and artwork uploads.                                                 |
| Promotion       | The house list of listing channels per event, pushed and tracked, plus the content beats around a show.                                                                |
| Tech production | Riders and tech specs per event, what is still missing and who to chase, and single-use links that let a touring act supply their own files and bank details.          |
| Roster          | Shifts generated per event from role windows, assigned against people's availability. Assigning a shift creates the hours.                                             |
| Hours           | Timesheets. Rostered shifts and logged task hours in one table, per person and per event, feeding the wage line in Finance.                                            |
| Bar             | A budget per night, locked when tickets go live; the bar close read against it, by hand or from the till; nights rolled up by month.                                   |
| Finance         | The settlement P&L, the finance review, deposit and invoice milestones, and payments to artists and promoters.                                                         |
| Sign-offs       | What an outside promoter sees: their own events and terms, and a form for their own payment details.                                                                   |
| Admin           | Accounts. Invitations, roles, deactivation, ending sessions, and linking an account to a person or an outside organisation.                                            |

Home is in the navigation for the roles that have it, but it has not been
built yet.

### How an event moves

An event does not sit at a single stage. It carries a status on each of eight
parts: Booking, Design, Promo, Tickets, Licence, Tech, Roster and Settlement.
Only the booking is moved by hand, from enquiry to negotiating to confirmed,
and each move is gated on named conditions (an owner, a locked date, a
confirmed act, agreed terms, and so on) that link to the screen that fixes
them. Every other part's status is derived from what its own module records,
so it cannot disagree with them. The one rule between parts is that tickets
cannot go on sale until the booking is confirmed. Putting a finished night to
bed waits for both halves of the count, door and bar. The gates live in
`src/lib/parts.ts` and are tested as a list, so none can quietly go missing.

Rooms are protected by holds. A hold on a room for a night stands until another
event wants the same night, at which point the holder has to confirm or
release. Nothing expires on a timer, and only one hold per room per night can
become the booking.

There are two booking models, curated and dry hire, and the settlement and
milestones differ between them.

### Roles

Six roles: Event coordinator, Design & comms, Technical production, Bar & duty
manager, Super admin, and External coordinator. Which modules a role can open
is stored per role in the database, seeded from the defaults in
`src/lib/constants.ts`. External coordinators are outside the venue. They see
only events their organisation brought, and never Home, Bar or Admin,
whatever their role's rows say.

## Stack

Next.js 16 (App Router, server components and server actions), React 19 and
TypeScript. Prisma 7 against Postgres 17, connected through the `pg` driver
adapter. CSS Modules over a token file, no component library. Vitest, ESLint
and Prettier. Cloudflare R2 for files, Resend for email, Epos Now for the till.

This Next.js release has breaking changes from the versions most editors and
models know. Read the guides under `node_modules/next/dist/docs/` before
writing route code.

## Getting started

You need Node 22 and a Postgres on `localhost:5432`.

The devcontainer is the easiest route: open the repo in VS Code, choose
"Reopen in Container", and you get Node, Postgres, `gh` and the migrations
applied. Without it, the same compose file gives you the database:

```bash
docker compose -p pickleevents_devcontainer -f .devcontainer/docker-compose.yml up -d db
cp .env.example .env         # then set PAYMENT_KEY: openssl rand -base64 32
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

The seed loads the design prototype's own data, which is what the finance
tests are written against. Either way, run it once; the devcontainer applies
migrations but does not seed.

Open <http://localhost:3000>. In development the sign-in page lists every
seeded account under the real form, and clicking one signs you in as them.
That is the quickest way to check a permission change, but those sessions are
marked unauthenticated and cannot open a payment detail or change a password.
To try the real flow, use "Forgotten it, or never set one?" with a seeded
address such as `sl@xchc.test`. Without email keys the link is printed in the
dev server's log rather than sent.

`docs/RUNNING.md` covers the day-to-day: which terminal, what to restart after
a migration, and the Docker Compose project-name trap.

## Commands

| Command                 | What it does                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| `npm run dev`           | Dev server on :3000                                                        |
| `npm run check`         | Format check, lint, typecheck and tests. Run this before opening a PR.     |
| `npm test`              | Tests once. `npm run test:watch` to keep them running.                     |
| `npm run db:migrate`    | Create and apply a migration (prompts)                                     |
| `npm run db:deploy`     | Apply pending migrations without prompting                                 |
| `npm run db:generate`   | Regenerate the Prisma client. Restart the dev server afterwards.           |
| `npm run db:seed`       | Load the sample data, replacing what is there                              |
| `npm run db:reset`      | Drop every table and reseed. No undo.                                      |
| `npm run db:studio`     | Browse the database                                                        |
| `npm run r2:smoke`      | Check the R2 credentials in `.env` reach the bucket. Not part of `check`.  |
| `npm run eposnow:smoke` | Check the Epos Now keys reach the account and read yesterday off the till. |

## Configuration

Copy `.env.example` to `.env`. The app reads these:

| Variable                                                                 | Needed for                                                                                                                                                  |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                           | Everything.                                                                                                                                                 |
| `AUTH_URL`                                                               | The site's public address. Every emailed link is built from it, never from the request. In production nothing is sent without it.                           |
| `PAYMENT_KEY`                                                            | Storing and revealing bank details. 32 random bytes, base64. Not recoverable: lose it and every payment detail has to be collected again.                   |
| `AUTH_RESEND_KEY`, `EMAIL_FROM`                                          | Sending invitations and sign-in links. Without them, development writes links to the log and production refuses to send. Password sign-in works regardless. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | File uploads. Optional; without them the upload pages say storage is not configured and everything else works.                                              |
| `EPOSNOW_API_KEY`, `EPOSNOW_API_SECRET`                                  | Closing the bar from the till. Optional; without them a bar is closed by hand. `EPOSNOW_LOCATION_ID` restricts the read to one site's tills.                |

Anything else in `.env.example` is not read by the app yet.

`EMAIL_FROM` must be on the domain verified in Resend. Sign-in email goes out
from a Minim domain rather than `xchc.co.nz` on purpose, because XCHC's web
presence may move around launch.

## Layout

| Path                                         | What is in it                                                                                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/(app)/`                             | The signed-in modules, one folder each. `page.tsx` loads, `actions.ts` mutates.                                                                                                  |
| `src/app/sign-in/`                           | Password and emailed-link sign-in, resets and invitations                                                                                                                        |
| `src/app/g/[token]/`                         | The one page a touring act sees from a link. No session, no navigation.                                                                                                          |
| `src/lib/`                                   | Domain rules as pure functions (`finance.ts`, `parts.ts`, `holds.ts`, `roster.ts`, `hours.ts`, `bar.ts`, ...) with a `*-data.ts` beside each doing the database reads and writes |
| `src/lib/permissions.ts`, `src/lib/scope.ts` | Access control                                                                                                                                                                   |
| `src/lib/auth*.ts`, `src/lib/session.ts`     | Sessions, links, throttling, passwords                                                                                                                                           |
| `src/lib/secrets.ts`                         | Encryption of payment details                                                                                                                                                    |
| `src/components/`                            | Shared UI                                                                                                                                                                        |
| `src/styles/tokens.css`                      | The design tokens, from the Nocturne bundle in the handoff. Nothing else hard-codes a colour, size or radius.                                                                    |
| `prisma/`                                    | Schema, migrations and the seed                                                                                                                                                  |
| `scripts/`                                   | The R2 and Epos Now smoke tests                                                                                                                                                  |
| `docs/`                                      | See the end of this file                                                                                                                                                         |

The split in `src/lib/` is the main convention. Anything that decides money,
hours or access is a pure function over plain objects with a test beside it,
and the Prisma calls sit in the `-data` files, so the rules can be tested
without Postgres and a wrong gate is found in a test rather than on the night.

## How the important parts work

### Access control

Permissions are enforced on the server. Every page and every server action
goes through `requireModule`, which reads the role's module rows and returns a
404 rather than a 403 when a module is off limits, since whether a module
exists is not something an outside promoter needs to learn. The sidebar reads
the same list, so it is a convenience rather than the control.

External accounts are scoped in the query, not the view. `eventScope` narrows
every event read to the organisation the account belongs to, keyed by id. An
external account with no organisation matches nothing.

Every mutation writes a row to the activity table, which nothing updates or
deletes.

### Signing in

Accounts are created in Admin and nowhere else. Adding somebody emails them an
invitation, valid for a week, to choose their own password. Nothing on the
sign-in path can create a user.

Two ways in, both implemented in `src/lib/auth.ts` rather than through a
library: an email address and password, or a single-use link emailed to the
address on the account. The link sign-in is folded under the password form and
is also how anyone who has forgotten their password, or never set one, gets a
new one.

- Passwords are hashed with scrypt from `node:crypto`, with the parameters
  stored in the hash so they can be raised later. The policy follows NIST
  800-63B: 15 characters minimum, no composition rules, and a refusal of
  repeats, keyboard runs, the person's own name or address and the venue's
  name.
- Wrong passwords cost nothing for the first five, then double the wait each
  time up to an hour, and stop password sign-in after 100 in a row until a
  reset. The emailed link is never throttled by this, so nobody can lock a
  colleague out by typing their address.
- Nothing reveals whether an address has an account. Wrong password, unknown
  address and no password set all get the same response after the same amount
  of work.
- Sessions are database rows, not JWTs. Deactivating someone, resetting a
  password or "sign out everywhere else" ends sessions that are already open.
  Only the SHA-256 of each session token and each emailed link is stored. A
  session lasts 30 days at most and ends after 14 days unused.
- Emailed links survive mail scanners: opening one spends nothing, pressing the
  button on the page does. Sign-in and reset links last an hour, and an account
  can be sent one a minute.
- Every sign-in, failure, password change and ended session goes to the
  append-only `AuthEvent` table.

Everyone can see and end their own sessions, and change their password, from
"Your account" at the foot of the sidebar.

The development role picker on `/sign-in` is only rendered outside production,
and `currentUser` refuses its cookie there regardless.

### Payment details

Bank account and IRD numbers are the only encrypted columns in the schema:
AES-256-GCM, sealed in `src/lib/secrets.ts` and keyed from `PAYMENT_KEY`. The
last three digits sit beside them in the clear so Finance can tell two
accounts apart without decrypting either.

Payees enter their own details rather than emailing them. Promoters have
accounts and use Sign-offs. Touring acts do not: a coordinator issues a
single-use link from Tech production, which lands on `/g/<token>` with no
session and nothing else to navigate to. The token is 32 random bytes, only
its SHA-256 is stored, and it expires after 14 days. An invalid or expired
link is a plain 404.

Revealing a stored detail needs both a real session (the development picker
cannot do it) and `PAYMENT_KEY` set. Without the key the forms decline and the
server logs it.

### Files

Riders, tech specs, press shots and artwork live in Cloudflare R2. The bytes
never pass through this application: the browser PUTs to a presigned URL and
reads back from a presigned GET, so a large print PDF is not a large request
against the Next server. The app stores the description of a file in
`StoredFile`. An uploader's filename never becomes part of the object key, and
SVG is accepted only for the venue's own brand marks.

### The bar, Epos Now and Xero

Three systems, one job each, so nothing is typed twice and nothing reaches
Xero twice:

| Fact                                         | Owned by                               | Pickle                                       |
| -------------------------------------------- | -------------------------------------- | -------------------------------------------- |
| Products, prices, cost prices, stock, orders | Epos Now                               | reads, never writes                          |
| Every bar sale                               | Epos Now                               | reads a night's sales when the bar is closed |
| Bar sales in the accounts                    | Epos Now's own Xero app, at till close | never posts them                             |
| Supplier bills                               | Xero                                   | never touches them                           |
| The bar budget, variance and months          | Pickle                                 | owns                                         |

Bar answers three questions. What did we think a night would do: a budget
locked when tickets go live, taken from the settlement's own bar line. What
did it do and why: the night's take against that budget, split into turnout,
spend per head, margin and labour, adding up exactly. And what does the run of
nights mean for the months ahead: overs and unders by month, with the nights
still to come re-priced at recent rates.

To connect Epos Now, create an API device in the Back Office (Web Integrations,
REST API), set `EPOSNOW_API_KEY` and `EPOSNOW_API_SECRET`, and run
`npm run eposnow:smoke` before anyone closes a bar off it. Compare the take it
reads for yesterday with Epos Now's own End of Day report, and the first
sale's time with when the bar opened. That is how you confirm the account
reports in NZ time, which the code assumes.

### Money

`src/lib/finance.ts` is the settlement mathematics, ported line for line from
the design handoff. Treat it as a specification: do not tidy the constants or
reorder the P&L lines without a decision recorded against a real settlement,
and any change needs a test. `src/lib/settlement.ts` lays those figures out as
the eleven display lines and computes nothing of its own.

The things it does that a spreadsheet did not: a loaded wage rate applied to
every hour, rostered or logged; a share of the weekly cost base by day of
week; org-wide labour apportioned across the month's events; and a finance
review that can flag an event, with a reason, and hold its deposit until the
numbers move.

Ticket sales and the door count are entered by hand. Gather.rsvp is the
source of truth for whether tickets are on sale, but there is no API
integration with it, and nothing posts to Xero.

## Tests and CI

Tests are Vitest, next to the code they cover. The domain modules are tested
as pure functions; the server action tests mock the database and check the
permission and refusal paths. Anything touching money, hours or permissions
gets its test written before the implementation.

CI runs on every pull request and push to `main`: `prisma validate`, the
migrations applied to an empty Postgres 17, a schema drift check
(`prisma migrate diff`), then format, lint, typecheck and tests, plus a
separate production build. Both jobs must pass before anything merges.

## Contributing

Trunk-based. Short-lived branches off `main` named `feat/`, `fix/` or
`chore/` plus a few words, small PRs, merged often. `main` requires a pull
request, both CI checks, and an up-to-date branch.

Run `npm run check` before opening a PR. The PR template asks how the change
was verified; for anything touching money, permissions or hours, that means
signing in as each affected role, not just green CI. Changes under `prisma/`,
to `src/lib/finance.ts` or to the workflows get a named reviewer through
`CODEOWNERS`.

Auto-merge is on. Once a PR is open, the "Update open PR branches" workflow
merges `main` into it after every push to `main`, which re-runs CI and lets
auto-merge fire, so there is no need to update branches by hand.

The repository is public. Never commit a real secret or staff wage data.

Non-technical team members write feature requests as user stories in the
"PicklePicklePickle — Feature requests" sheet in the XCHC Google Drive.
Reference them in PRs by their `REQ-nnn` id.

## Documentation

- `docs/RUNNING.md`: running the app locally, and what to do when it breaks.
- `docs/design-handoff/README.md`: the specification. Dated change notes are
  appended where the venue has decided something different from the original
  design; where two documents disagree, the most recent wins, and conflicts
  should be raised before building on either.
- `docs/design-handoff/design/Pickle Prototype.dc.html`: the working prototype
  the modules are reproduced from. Open it in a browser and sign in as Sione
  Latu. It targets a runtime that is not part of this codebase and is
  reference, not code to lift.
- `docs/product-gaps.md`: a September 2026 gap analysis against Prism, Opendate
  and Tripleseat. Some of what it lists as missing (holds, the finance review,
  milestones, the bar) has been built since.
- `CLAUDE.md`: conventions and the non-obvious parts of the setup, written for
  Claude Code sessions but worth a read regardless.
