# Deploying the test site

The account-side setup only a human can do, in order, once. Everything after
that is automatic — nobody runs a deploy command by hand.

## 1. What the test site is

`pickle-test` is a Cloudflare Worker running the same Next.js app as
production, built with OpenNext (`@opennextjs/cloudflare`) instead of a
Node server. It reaches a small Postgres database — any provider — through
Cloudflare Hyperdrive, and starts from seed data: the same events, people
and hours you see locally, plus a password every seeded account shares
(`SEED_PASSWORD`) so real sign-in works without email being configured.

It deploys itself. Every merge to `main` runs the **"Deploy test site"**
GitHub Actions workflow, which applies migrations, seeds the database if
it's still empty, builds the app, deploys it, and pushes the Worker's
secrets — in that order. Until the custom domain is attached (§3) the site
is reachable at `https://pickle-test.<account subdomain>.workers.dev`;
after that, at `https://pickle-test.xchc.co.nz`.

**Deploys only ever happen from GitHub Actions, never from a laptop.**
OpenNext's build bakes whatever `.env` is on disk into the bundle, and every
laptop has a real one — a build from your Mac would ship your local secrets,
and possibly a stale `DATABASE_URL`, into a Worker the whole team can reach.
A GitHub Actions checkout has no `.env` at all, which is the point.
`npm run cf:deploy` exists and works, but treat it as an emergency-only
escape hatch, not a normal way to ship.

## 2. One-time setup, in order

**1. Turn on Workers Paid.** On the Cloudflare account that already holds
the R2 bucket: **Workers & Pages → Plans → Workers Paid → Subscribe**
(US$5/month minimum). Why: the Free plan caps CPU at 10 ms per request, and
one scrypt password check (`src/lib/password.ts`) costs roughly 200 ms of
CPU — Free would fail every password sign-in.
([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/))

**2. Get an account ID and an API token.**

- **Account ID** — dashboard → **Workers & Pages** → the Account details
  panel shows it, with a click-to-copy button.
  ([Finding your account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/))
- **API token** — click your profile icon (top right) → **My Profile** →
  **API Tokens** → **Create Token** → start from the **Edit Cloudflare
  Workers** template, then add one more permission: **Account → Hyperdrive
  → Edit**. Scope it to this one account, then **Continue to summary →
  Create Token**, and copy it immediately — Cloudflare shows it once.

  Why both: `wrangler deploy` and `wrangler secret bulk` are covered by the
  Workers template, but Hyperdrive is a separate Developer Platform product
  with its own permission group (`Hyperdrive Edit`, account-scoped) that a
  Workers-only token doesn't include. If the first deploy (step 6 below)
  fails with an authentication error mentioning the Hyperdrive binding, this
  is the permission to check first.
  ([GitHub Actions guide — token template](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/),
  [API token permission reference — Hyperdrive Edit/Read](https://developers.cloudflare.com/fundamentals/api/reference/permissions/))

**3. Create a test Postgres database.** Recommended: a free-tier
**[Neon](https://neon.com/docs)** project in the
**Sydney** region (`aws-ap-southeast-2` — Neon's closest region to Ōtautahi
Christchurch, and Hyperdrive performs best pooling close to the database
it's in front of). Neon's free tier gives 0.5 GB storage and about 100
compute-hours a month per project, autosuspending after 5 minutes idle —
comfortably enough for a test site.
([Neon regions](https://neon.com/docs/introduction/regions),
[Neon free plan limits](https://neon.com/docs/introduction/plans))

Two alternatives, one line each: **PlanetScale Postgres**, created straight
from the Cloudflare dashboard and billed daily through your Cloudflare
invoice from creation to deletion — no free tier
([Cloudflare's PlanetScale guide](https://developers.cloudflare.com/hyperdrive/planetscale/));
or **Prisma Postgres**, which has its own free tier and a direct `postgres://`
connection string that works with Hyperdrive the same way Neon's does
([connecting Prisma Postgres to Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/prisma-postgres/)).

Whichever you pick, copy the **direct** connection string, not a pooled one
— in Neon's connection details panel, uncheck **Connection pooling** first
([Cloudflare's Neon guide says the same](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/)).
Hyperdrive is itself a connection pooler; pointing it at another pooler adds
a hop it doesn't need. Make sure the string ends with `sslmode=require`.

**4. Create the Hyperdrive config.**

```bash
npx wrangler login
npx wrangler hyperdrive create pickle-test --connection-string="<the direct URL from step 3>"
```

(Or dashboard: **Storage & Databases → Hyperdrive → Create configuration**,
paste the connection string, **Create** — Cloudflare test-connects before it
lets you save.
[Hyperdrive get started](https://developers.cloudflare.com/hyperdrive/get-started/).)
Either way, copy the `id` it prints. It is **not a secret** — the database
credentials live encrypted behind it on Cloudflare's side and are never
shown again — so it's safe to store as a plain GitHub variable, next.

**5. Set up the GitHub environment and variables.** Repo → **Settings →
Environments → New environment** → name it exactly `test` (the workflow
expects that name). This is free on a public repo — GitHub only charges for
environments on private repos below a paid plan.
([GitHub environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment))

The secrets go on that environment. The two variables (`HYPERDRIVE_ID`,
`APP_URL`) are **repository** variables instead — **Settings → Secrets and
variables → Actions → Variables → New repository variable** — because the
workflow decides whether to run at all from `HYPERDRIVE_ID`, and a job can
only see repository variables before it starts. Until `HYPERDRIVE_ID` exists,
every run of the workflow is a single skipped job called "Not configured
yet"; setting it is what switches deploys on.

Add them either by hand or with `gh`:

```bash
gh secret set NAME --env test -R xchc-events/pickle
gh variable set NAME -R xchc-events/pickle --body "value"
```

The "required" rows below make the workflow's first step refuse to run at
all, naming the exact one missing (see §4 for what that looks like).
"Optional" rows just switch a feature off quietly when left blank.

| Name                                                           | Kind                          | What it is                                                         | How to make it                                                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`                                         | secret, required              | the token from step 2                                              | paste it                                                                                                                                                                       |
| `CLOUDFLARE_ACCOUNT_ID`                                        | secret, required              | the account ID from step 2                                         | paste it                                                                                                                                                                       |
| `DATABASE_URL`                                                 | secret, required              | direct URL of the test Postgres (step 3)                           | paste it — this is what migrate and seed run against from the Actions runner, separately from Hyperdrive                                                                       |
| `SEED_PASSWORD`                                                | secret, required              | the password every seeded account gets                             | 15+ characters, and not a seeded person's own name — `src/lib/password-policy.ts` refuses that; a few unrelated words is the easiest way there                                 |
| `PAYMENT_KEY`                                                  | secret, required              | seals bank/IRD fields on the test site                             | `openssl rand -base64 32` — a fresh one, not production's (see §5)                                                                                                             |
| `AUTH_RESEND_KEY`                                              | secret, optional              | sends real sign-in emails                                          | from the existing Resend account behind send.minim.nz — the From: address is already committed in `wrangler.jsonc`; leave this blank and the test site still works by password |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`    | secret, optional              | file storage access                                                | the same values already in your local `.env`; leave them blank and uploads say storage isn't configured, same as locally                                                       |
| `EPOSNOW_API_KEY`, `EPOSNOW_API_SECRET`, `EPOSNOW_LOCATION_ID` | secret, optional              | Bar's read-only Epos Now access                                    | the same values already in your local `.env`, if you want Bar to read a real till                                                                                              |
| `HYPERDRIVE_ID`                                                | repository variable, required | the id from step 4 — setting it switches the workflow on           | paste it — not secret                                                                                                                                                          |
| `APP_URL`                                                      | repository variable, optional | overrides the committed `AUTH_URL` before the custom domain exists | leave unset for now — set in step 6                                                                                                                                            |

**6. Deploy it for the first time.** **Actions → "Deploy test site" → Run
workflow**, tick **reseed**, run.
(Merging anything to `main` deploys too, just without a forced reseed.)

The URL appears as a `::notice::Deployed: https://...` line near the end of
the "Deploy to Cloudflare Workers" step's log. The repo's **Deployments**
panel (home page's right sidebar, or **Settings → Environments → test**)
also links to this environment, but that link falls back to
`https://pickle-test.xchc.co.nz` — not live yet — until you finish this
step, so read the address from the log for now.

Copy that `workers.dev` address, set the `APP_URL` variable (step 5) to it,
and run the workflow once more — no need to reseed this time. Why twice:
`AUTH_URL` is what every emailed link — sign-in links, invitations, artist
access links — is built from (`linkBase` in `src/lib/auth-rules.ts`), so
until it matches the site's real address those links point at a host that
does not answer. It also decides that the session cookie is Secure, which
any https address satisfies. The workflow passes
`--var AUTH_URL:<APP_URL>` whenever `APP_URL` is set, overriding the
`https://pickle-test.xchc.co.nz` committed in `wrangler.jsonc` until §3 is
done.

Sign in at that URL as `sl@xchc.test` with the `SEED_PASSWORD` you set. The
seed (`prisma/seed.ts`) creates these accounts, all `<id>@xchc.test`, all
sharing that password:

| Email          | Person       | Role                                               |
| -------------- | ------------ | -------------------------------------------------- |
| `sl@xchc.test` | Sione Latu   | Super admin                                        |
| `mt@xchc.test` | Mere Tapu    | Event coordinator                                  |
| `tw@xchc.test` | Tui Ware     | Design & comms                                     |
| `jr@xchc.test` | Jonty Rewi   | Technical production                               |
| `ak@xchc.test` | Ana Kelliher | Bar & duty manager                                 |
| `kr@xchc.test` | Awhina Reid  | External coordinator (Kōura Records) — a promoter  |
| `hx@xchc.test` | Devon Marsh  | External coordinator (Hex Collective) — a promoter |

The last two are external accounts, scoped server-side to their own events
only — useful for checking that scoping actually holds on the test site.

## 3. Putting it on xchc.co.nz

A Worker custom domain needs the `xchc.co.nz` DNS zone itself active on
Cloudflare — Cloudflare won't attach even one subdomain while the parent
zone's DNS lives elsewhere
([custom domains require "an active Cloudflare zone"](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)).
So this step moves DNS for the **whole domain, mail included** — not just
`pickle-test` — and deserves doing on purpose. XCHC's web presence may move
off `xchc.co.nz` entirely around launch (it's why sign-in email already
sends from send.minim.nz, not xchc.co.nz), so this is the one step in this
document that is slow to undo. Do it when you're ready to commit to it, not
just because it's next on this list.

1. Cloudflare dashboard → **Add a site** → `xchc.co.nz` → the Free plan is
   fine for plain DNS. Cloudflare scans and imports the existing records.
2. **Before changing anything else**, check what it imported against the
   current 1st Domains zone: the MX records for the Google Mail on
   `events@xchc.co.nz`, the SPF/DKIM/DMARC TXT records, the current
   website's A or CNAME, and any other verification TXT records. Set every
   one of these to **DNS only** (grey cloud, not orange) so nothing about
   how mail or the existing site behaves actually changes.
3. At 1st Domains: log in → **Manage Domains & Services** → select
   `xchc.co.nz` → **Configure Name Servers** → turn Parking Status **off**
   → enter the two nameservers Cloudflare assigned when you added the site.
   ([1st Domains: changing nameservers](https://faq.1stdomains.nz/content/2/3/en/how-do-i-change-the-name-servers-dns-for-my-domain-name.html) —
   if that menu has moved, their support line is 0800 2000 24, Mon–Fri
   8am–6pm.)
4. Wait for the zone to show **Active** on Cloudflare's overview page for
   `xchc.co.nz`. 1st Domains' own guidance allows up to 24 hours.
5. Uncomment the `routes` block in `wrangler.jsonc`, set the `APP_URL`
   GitHub variable to `https://pickle-test.xchc.co.nz` (or delete that
   variable entirely — without it, the workflow falls back to the
   `AUTH_URL` already committed in `wrangler.jsonc`, which is that same
   address), merge to `main`, and confirm the custom domain resolves.

## 4. Day to day

**Reseeding** — Actions → "Deploy test site" → Run workflow → tick
**reseed**. This wipes and reinstalls everything (events, hours, shifts —
not just user accounts), so only do it to throw away a test database that's
accumulated clicking-around you don't need any more. There's no undo.
Leaving **reseed** unticked is safe on every other deploy: the workflow runs
the seed with `SEED_ONLY_IF_EMPTY=1`, so it counts the `User` table, finds
it isn't empty, logs `seed skipped: N users already present
(SEED_ONLY_IF_EMPTY)`, and stops without touching anything.

**Reading logs** — `npx wrangler login` once, then:

```bash
npx wrangler tail pickle-test
```

streams live requests, or use the dashboard's **Workers & Pages →
pickle-test → Observability** tab.

**Rotating a secret** — update it on **Settings → Environments → test**,
then re-run the "Deploy test site" workflow (no reseed needed). A changed
GitHub secret doesn't reach the Worker until the workflow runs again and
re-uploads everything with `wrangler secret bulk`.

**The workflow's guards** — while the `HYPERDRIVE_ID` repository variable is
unset, every run is one skipped job, "Not configured yet", with a warning
saying so: nothing deploys and nothing fails. Once it is set, the deploy
job's first step checks every required secret and variable (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`,
`PAYMENT_KEY`, `SEED_PASSWORD`, `HYPERDRIVE_ID`) before touching anything
live, and fails with `::error::Secret NAME is not set...` or
`::error::Variable NAME is not set...`, naming exactly which one, rather
than deploying something half-configured. A later step re-checks
`HYPERDRIVE_ID` once it's written into `wrangler.jsonc`, in case the
substitution itself failed. Optional secrets and `APP_URL` only ever produce
a `::notice::` and are skipped quietly when blank.

A `SEED_PASSWORD` that's present but fails the house password policy gets
past that first check — which only confirms it's set, not that it's valid —
and fails later, at the seed step itself, with `SEED_PASSWORD fails the
password policy for <email>: <reason>`, before a single row in the database
is touched.

**Hyperdrive's query limit** — unlimited once the account is on Workers
Paid (step 1), which this project needs anyway. On the Free plan it caps at
100,000 queries a day, resetting at 00:00 UTC. Either way, usage shows on
**Hyperdrive → pickle-test → Metrics** in the dashboard (last 24 hours by
default, 31 days of history).
([Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/),
[Hyperdrive metrics](https://developers.cloudflare.com/hyperdrive/observability/metrics/))

**Running the Worker on your Mac** — the closest thing to the deployed site
without deploying it. It needs a throwaway database (never the shared
`pickle` one) migrated and seeded with a `SEED_PASSWORD` so there is a
password to type, and a `.dev.vars` file (gitignored) holding a
`PAYMENT_KEY` and an `AUTH_URL` that matches the preview's own origin —
without that override the cookie is set as `__Host-` and Secure, which plain
http never sends back, so sign-in silently fails:

```bash
printf 'PAYMENT_KEY=%s\nAUTH_URL=http://localhost:8788\n' "$(openssl rand -base64 32)" > .dev.vars
npm run cf:build
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='postgresql://pickle:pickle@localhost:5432/pickle_cf' \
  npx opennextjs-cloudflare preview -- --port 8788
```

Flags after `--` go to `wrangler dev`. Delete `.open-next/` afterwards: the
build copied your real `.env` into it, which is the reason deploys never
start from a laptop.

**The two Prisma clients** — `prisma/schema.prisma` has had two generators
since the Cloudflare work: the ordinary client in `src/generated/prisma`, and
a workerd one in `src/generated/prisma-workerd` that loads Prisma's query
compiler the only way Cloudflare allows. `npm run cf:build` swaps the second
in through `next.config.ts`; nothing else ever imports it. After pulling that
change, regenerate once — `rm -rf src/generated && npm run db:generate` — so
the old generator's files do not sit beside the new ones.

**If the first deploy fails** — two shapes to know. An error naming
`WORKER_SELF_REFERENCE` or "service not found" means Cloudflare would not
bind a brand-new Worker to itself: comment out the `services` block in
`wrangler.jsonc`, deploy once, put it back. Every page failing with
`CompileError: Wasm code generation disallowed by embedder` in the logs
means the bundle was built without `npm run cf:build`, which is what sets
the Prisma target — the workflow always uses it, so this only happens to a
hand-built one.

## 5. Don't

- **Don't** run `npm run cf:deploy` from a laptop with a `.env` file
  present — it bundles whatever is in it into the Worker. Use the "Deploy
  test site" workflow instead.
- **Don't** point the Worker at the local `pickle` database on
  `localhost:5432`. Cloudflare's edge cannot reach your Mac, and that
  database is shared by every other worktree working on this repo.
- **Don't** reuse the production `PAYMENT_KEY` here — the test site's is
  disposable. Losing it only means test payment details need re-entering,
  not real ones.
- **Don't** treat file uploads on the test site as disposable: `R2_BUCKET`
  is `pickle-files`, the same bucket local development uses today and the
  natural one for production later, so anything uploaded through Files or a
  payment attachment lands alongside real venue files. Give the test site
  its own bucket (change the committed `R2_BUCKET` in `wrangler.jsonc`) if
  that ever matters.
- **Don't** commit anything the workflow reads from a secret — API tokens,
  `SEED_PASSWORD`, `PAYMENT_KEY`, R2 keys. They belong in the `test` GitHub
  environment only.
- **Don't** move the 1st Domains nameservers until you've checked the
  records Cloudflare imported against the real zone (§3). It's the slow one
  to undo, and the whole domain's mail rides on it.
