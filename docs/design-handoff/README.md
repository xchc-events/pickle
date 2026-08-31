# Handoff: PicklePicklePickle — event management platform

## Overview

A single-tenant event management platform for **PicklePicklePickle** (XCHC, Ōtautahi Christchurch) — a music/arts venue running its own shows, hosting external promoters, and hiring rooms out dry. It replaces a spreadsheet-and-group-chat workflow with one event record that every department works off: enquiry → negotiation → confirmation → design/promo → on sale → rostering → show week → payout.

The platform's central claim: **one record of an event, one record of a person, one record of an hour.** Every number shown anywhere (a projected surplus, a wage line, a profit share) resolves back to hours logged against events and prices set on the event record. Nothing is typed twice.

Twelve modules, role-gated:

| Module | Key | What it is for |
| --- | --- | --- |
| Home | `home` | Personal "needs you" queue, next event, my hours |
| Pipeline | `pipeline` | All events by stage, with stage gates; opens the event record |
| Ticketing | `ticketing` | Tiers, allocations, sales curve, door list |
| Design | `design` | Asset checklist by tier (hero/lead/support), artist file collection |
| Promotion | `promo` | Channel spread, platform push status, content rules |
| Tech production | `tech` | Rig presets, gear/labour add-ons, patch and requirements |
| Roster | `roster` | Shifts per event by role, assignment against availability |
| Bar | `bar` | Live take, spend/head, margin by product, stock cost |
| Hours | `hours` | Timesheets: rostered shifts + logged task hours, per person |
| Finance | `finance` | Settlement P&L, booking-model milestones, **finance review**, wages run, Xero posting |
| Admin | `admin` | Role/module permission matrix, users, people records, reset |
| Sign-offs | `portal` | External promoter portal — their events only, deal terms, file requests |

## About the design files

The files in `design/` are **design references created in HTML** — a working prototype that demonstrates intended look, structure, data model and behaviour. They are **not production code to lift**. `Pickle Prototype.dc.html` is a single-file component written against a bespoke streaming-template runtime (`support.js`); it exists to be *read and reproduced*, not deployed.

Your task is to **recreate these designs in the target codebase's own environment** — React/Next, Vue, Rails+Hotwire, whatever is established — using its routing, data layer, component library and auth. If there is no codebase yet, choose the framework that best suits a multi-user, permissioned, data-heavy internal tool (a React or Vue SPA against a real API with a relational database is the obvious fit) and implement the designs there.

Two things in the prototype are deliberately fake and must become real:

1. **Persistence** is `localStorage` under key `p3-prototype-v1`, schema `v: 13`. Production needs a real database and API.
2. **Auth** is a role picker on a login screen. Production needs real accounts, invitations, deactivation, and per-space permissions.

Everything else — the numbers, the models, the flows, the copy — is intended as specified.

## Fidelity

**High-fidelity.** Final colours, typography, spacing, copy and interaction behaviour. Recreate the UI closely, but source the visual values from the design system (below) rather than from hard-coded literals: the prototype writes tokens inline (`var(--color-neutral-500)`, `13px`, etc.) because it has no stylesheet layer — your implementation should map those onto the codebase's own token/theme layer.

The information architecture, the finance mathematics, and the gate logic are **specification-grade**: reproduce them exactly. Pixel spacing is guidance; density is not — this is intentionally a dense tool.

---

## Design system

**Nocturne** — a quiet, compact dark interface. Bundled at `design/_ds/nocturne-…/` (`styles.css` is the whole token + component layer; `readme.md` is the system's own guide — read it).

Core tokens actually used:

| Token | Value | Used for |
| --- | --- | --- |
| `--color-bg` | `#161826` | Page ground |
| `--color-surface` | (from styles.css) | Cards, dialogs, toast, palette |
| `--color-text` | `#e9e9ed` | Body text |
| `--color-accent` | `#9184d9` | Section headings, primary outlines, key figures |
| `--color-neutral-100…900` | OKLCH ramp | Text hierarchy: 100 = brightest, 400–500 = secondary, 600–700 = tertiary/muted, 800–900 = borders/tracks |
| `--color-accent-100…900` | OKLCH ramp | Accent text on tints (100–300), tints and hovers (700–900) |
| `--color-divider` | (from styles.css) | 1px rules, card borders |
| `--radius-md` / `--radius-lg` | 8px scale | Cards, chips, panels |
| `--shadow-sm/md/lg` | tuned to ground | Elevation — never stack shadows |
| `--font-heading` / `--font-body` | Inter 500 / Inter 400 | Headings never bolder than 500 |

Three **status colours** are declared inline on the app root and are local to this product (they are not in Nocturne):

```css
--st-warn:      oklch(0.734 0.125 68);   --st-warn-dim: oklch(0.30 0.055 68);
--st-good:      oklch(0.734 0.115 152);  --st-good-dim: oklch(0.29 0.05 152);
--st-stop:      oklch(0.700 0.140 25);   --st-stop-dim: oklch(0.30 0.07 25);
```

Promote these to real tokens in your theme. `good` = done/healthy/paid, `warn` = pending/thin/attention, `stop` = loss/blocked/red-flagged.

**Icons:** Phosphor Icons (regular weight), loaded from `@phosphor-icons/web@2.1.1`. Icon names appear throughout the prototype as `ph-<name>`. **Type:** Inter 400/500/600 from Google Fonts.

Nocturne conventions to keep: outlined primary buttons (accent border on transparent, never filled); rules that fade to transparent at one end (`linear-gradient(to right, var(--color-divider), transparent)`) — this is the signature of every section heading; low chroma outside the accent; `:focus-visible` = 2px accent outline, offset 2px.

### Repeating layout patterns

- **Section heading:** 12px, `letter-spacing: 0.13em`, uppercase, `--color-accent`, followed by a 1px fading rule filling remaining width, optionally a 11.5px `--color-neutral-600` note at the right. Used dozens of times; make it a component.
- **Metric strip:** `display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--color-divider)` with `--color-bg` cells — the 1px gap *is* the divider. Label 10.5px neutral-600, value 24px heading font, `font-variant-numeric: tabular-nums`.
- **Row list:** full-width `<button>` rows, transparent background, `border-top: 1px solid color-mix(in srgb, var(--color-divider) 55%, transparent)`, hover `color-mix(in srgb, var(--color-neutral-100) 4%, transparent)`.
- **Chip filters:** 11px, `padding: 3px 10px`, `border-radius: 11px`, 1px border; selected state swaps border to accent and background to a 14% accent mix.
- **Avatar:** 22–24px circle, initials in heading font at 9–9.5px.
- All money and hour figures use `font-variant-numeric: tabular-nums`.

---

## Screens / views

The app is one shell with a module switcher. Layout: **sidebar 232px fixed** (brand, search button, module nav, integrations panel, current-user footer) + **main region, flex 1, scrolling**. Header blocks are `padding: 26px 28px 20px` with a bottom divider; content bodies `padding: 22px 28px 40px`.

### Login
Role picker, not a credential form — `max-width: 460px`, centred. Brand lockup (three-circle pickle mark in accent ramp + "PicklePicklePickle" / "XCHC · Ōtautahi Christchurch"), `<h1>` "Sign in" at 27px, then one row per user in `USERS`. Copy: *"Pick a role to explore. What you can see and do changes with it."* Footnote states persistence is browser-local with a reset in Admin.

In production: replace with real auth; keep the idea that role determines the visible module set.

### Home
Greeting + subline. Four-cell metric strip. Two columns: **"Needs you"** action queue (rows: icon, title, sub, age in a status colour — clicking routes to the thing) and a 296px aside with **"Next through the door"** (event name, when, days-out counter at 27px accent, one-line status, primary button "Open the event") and **"Your hours this month"** (figure, loaded cost, progress bar).

### Pipeline
Header with title/kicker/sub and a primary "New enquiry" button (hidden for roles that can't create). Filter row: stage chips + a divider + space chips. Events grouped by stage with `STAGES` names and playful internal nicknames (`NICK`: Fresh, Brining, Sealed, Labelling, On the Shelf, Crewing, Cracked, Tasting Notes) and per-stage target counts (`STAGE_TARGET`). Each row: name (224px), meta line with icon, stage progress bar, days-out, projection ("proj. $X" / "took $X" / "modelling"), owner avatar. Below: 4-cell metric strip and a **"Where the labour goes"** breakdown.

### Event record
The hub. Back link, title, badges (stage, space, booking model), and tabbed/stacked sections: the enquiry facts (owner, date, space, kind of night), artists with fee floor/ceiling and status (`enquired`/`pencilled`/`confirmed`/`declined`) and file checkboxes (`RIDERS`: promo pics, bio, EPK, hospitality rider, tech rider), **Terms & split** (split slider, deal state `agreed`/`queried`/`sent`), licence state (`LICENCE`: not required/required/applied for/confirmed/denied), bar close time, leads per department, and an **activity feed** (initials, text, when) which everything writes into.

**Stage gates** are the load-bearing interaction: each stage transition lists named conditions with a pass/fail state, a reason, and a deep link to the screen that fixes it. An event cannot advance while a gate fails. Gate sets are defined per transition in `gates(e)` — reproduce the full list from the prototype; examples: *An owner is named*, *Date is locked*, *At least one act confirmed*, *Fee floor and ceiling agreed*, *Terms agreed with the promoter*, *Bar close decided*, *Artist bios and pics in*, *Licence filed if it is needed*.

### Ticketing
Tiers derive from one number: `std` (standard). `sub = round(std × 0.8)`, `sup = round(std × 1.2)`, plus a `door` price. A four-way `mix` (supporter/standard/subsidised/door proportions) produces the average ticket price. Shows allocation, sold count, sales curve, and door list. Source of truth is **Gather.rsvp**.

### Design
Asset checklist built from `ASSET_SET`, tiered `hero` / `lead` / `support`, each with format spec and a rationale line. Hero = two vertical video cuts (9:16); lead = the 1920×1005 event cover; support = story, A2 poster, listing copy. `CONTENT_RULES` render as a short doctrine panel: vertical video first (twice), video beats a still, almost no words on an image, real over polished, one idea per asset.

### Promotion
`PLATFORMS` list with per-platform integration mode (`api` vs `manual`) and a note on how each is handled — Gather.rsvp (source of truth), Facebook event (Graph API), Instagram (manual), Eventfinda, Eventbrite (inventory capped so it can't oversell), EventsHub (council, moderated, 2 working days), Linktree, Telegram, Discord. Plus channel spread state per event.

### Tech production
`PRESETS` are one-click rig bundles that append gear costs *and* labour hours to the event: in-house projection mapping + VJ, full band backline, livestream & multitrack, extra lighting rig, silent disco headsets. Each item is `{kind: 'gear', cost}` or `{kind: 'labour', hours}` and flows straight into the finance model. Tech roles: `Sound — Lead`, `Sound — 2IC`, `Lighting — Lead`.

### Roster
Shifts generated per event from role windows (`ROLE_WIN`, or `ROLE_WIN_EARLY` for early events; apartment and workshop events get reduced hours). Each shift: role, hours, start offset, assigned person, state, "asked" count. Assignment is checked against `AVAIL_SEED` (per-person weekly hour cap, volunteer hours, yes/no day-period preferences keyed `Fri-eve`, `Mon-day` …). **Roster ↔ Hours is two-way**: assigning a shift creates the hours; editing hours reflects back.

Roles: Duty manager, Bar staff, Sound — Lead, Sound — 2IC, Lighting — Lead, Door, Care team, Set-up crew, Clean-up crew.

### Bar
Live take ticking during show week, spend-per-head against the assumed `barHead`, margin by product modelled from the event's take and the house mix, stock cost at 40.2%, and an "Against the model" comparison panel. Bar labour can be toggled in or out of margin.

### Hours
Timesheets per person: rostered shift hours + logged task hours (`est` vs `actual`), every line attached to an event. This is the module that makes the profit share arguable — say so in the UI as the prototype does.

### Finance
The most specified screen. Event chip rail across the top (each chip: name, date, **booking model**, figure, note), then a header row with the model badge, a "Switch to dry hire / curator model" ghost button (hidden for external users), and the event identity line.

**Settlement P&L** (`finLines`) — label / value / note rows, with rules above the income and retained lines:

1. Tickets — *n* at $avg average → ticket revenue ex-GST (projection with quiet/likely/great case, or reconciled from Gather.rsvp once concluded)
2. Bar margin — $x/head at 59.8% → bar margin (or actual bar profit after stock)
3. **Income, GST exclusive** (rule above; neutral-100) — with the GST collected and held stated in the note
4. − Cost base share — *day* carries *n*% (rent, power, insurance, software)
5. − Gear, hire & promotion (incl. Wheke Sound on the sliding scale where applicable)
6. − Comps & crew tokens (at stock cost, not till price)
7. − Crew wages, loaded — *n* hours, *n* people, from rostered shifts and logged tasks
8. − Org-wide labour, share of *month* — apportioned across the events in that month
9. − Artist & promoter floors — *n* names on the bill
10. − Surplus share out — *n*% of the surplus to their people
11. **Retained by PicklePicklePickle** (rule above; accent if positive, `--st-stop` if negative) — "back into the cost base" / "this one costs us money"

Also on Finance: the **milestone pipeline** (below), the **finance review panel** (below), a **wages run** ("pay all" across everyone unpaid on the event, from hours already logged), **artist payments** (per name, reversible), and **post to Xero** (stub, but the account mapping is real: 1 invoice to 200, wage lines to 477, artist bills to 412).

### Admin
Role × module **permission matrix** as toggle rows — turning a module off removes it from that role's sidebar on next paint, verifiable by signing in as them. Users table (person, role, access, "you" marker). **"Your people"** — every name is an editable field, and changing it changes that person on every shift, timesheet, run sheet and bar view at once, because there is only one record of a person. Plus a state reset.

### Sign-offs (external promoter portal)
Scoped hard: an external user sees only their own events (`visible()` returns `myEvents()` for external users) and only the `pipeline` + `portal` modules. They see the deal terms with the venue's own model figures, can agree or query (a query records a note the venue sees), and get file requests for the riders. Model-switch and finance-review actions are hidden from them.

---

## Booking models — the core domain rule

Every event carries `model: 'dry' | 'curator'`. `MODELS = { dry: 'Dry hire', curator: 'Curator model' }`. Seed events `obc`, `wl`, `vs7` are dry hire; everything else defaults to curator. Coordinators and admins can switch a booking's model; external users cannot. Switching writes to the activity feed and raises a toast explaining the consequence.

The badge appears in the Finance header and on every Finance event chip. Dry hire = neutral outline (`--color-neutral-700` border, 5% neutral fill, neutral-300 text). Curator = accent (`--color-accent` border, 14% accent fill, accent-100 text).

### Dry hire milestones
1. **25% deposit invoice** — the first money milestone; risk sits here because a dry hire settles off the hire fee.
2. **Balance invoice** — "the rest, once the door count is in".

The **finance review sits before the deposit.** A red flag holds the invoice and goes back to the coordinator.

### Curator model milestones
1. **Booking enquiry** — on record; the model runs off the enquiry figures. Always complete.
2. **Booking confirmed** — confirmed and held in the calendar (complete at `stage >= 2`); if not yet, the sub-line reads *"not yet — finance signs off here."*
3. **Settlement invoice** — after the door count is in.

The **finance review sits at booking confirmed, step 2.** The venue carries the downside on this model, so nothing is confirmed on a flagged event until the numbers move.

Milestone rows render as: state icon (`ph-check-circle` / `ph-circle-dashed`), label, sub-line, and an action button ("Raise it" / "Reverse") where the step is actionable. Done = `--st-good` border and a 7% good-tint background; not done = divider border, transparent.

### Finance review panel

Sits above settlement on both paths. State machine: `pending → approved | flagged`, and `flagged → approved` (via "Clear the flag and approve").

```
finReview = { state: 'pending'|'approved'|'flagged', note: string, by: userInitials, when: string }
```

Seeded as `approved` (by `SL`, "at confirmation") for events at `stage >= 4` or concluded; `pending` otherwise.

Panel contents:
- **State chip** — icon `ph-seal-check` (approved) / `ph-flag` (flagged) / `ph-hourglass-medium` (pending), coloured `--st-good` / `--st-stop` / `--st-warn`. Panel border picks up the status colour when pending or flagged; background is a 6% tint of it.
- **Milestone line** — "before the 25% deposit invoice" or "at booking confirmed, step 2".
- **Projected margin indicator** — computed as `margin = income > 0 ? retained / income : 0`:
  - `retained < 0` → **loss**, `--st-stop`: *"projected to run at a loss of $X"*
  - `margin < 0.08` → **thin**, `--st-warn`: *"thin — N% on $X of income"*
  - otherwise → **healthy**, `--st-good`: *"healthy — N% on $X of income"*
- **Explanatory blurb**, different per model (verbatim copy in the prototype, `finRev.blurb`).
- **Attribution line** — "Approved by *Name* · *when*" or "Flagged by *Name* · *when*"; hidden while pending.
- **Flag reason** — shown when flagged and a note exists.
- **Actions** (hidden for external users): a reason textarea, **Approve it** / **Clear the flag and approve**, and **Red-flag it**.

**Red-flagging requires a reason.** Submitting with an empty note does not flag — it raises a warn toast: *"Say what puts it at risk — the coordinator sees your words, not a flag on its own."* On success the reason is stored on `finReview.note`, pushed to the activity feed as `"red-flagged this event: <reason>"`, surfaced to the coordinator, and the toast reads *"Red-flagged — it sits with the coordinator until the numbers move."* Approving clears the note and toasts *"Approved — the milestone can go ahead."* Both actions clear the draft textarea.

---

## Finance mathematics — implement exactly

House constants (`CFG`):

```js
rate: 30            // base hourly rate
loadPct: 0.122      // on-costs
loaded: 33.66       // loaded hourly rate — every wage figure uses this
gst: 1.15           // NZ GST divisor
weekBase: 2457.37479261539   // weekly fixed cost base
barMargin: 0.598    // bar gross margin
tokenPrice: 15      // crew token face value
stockCost: 0.402    // cost of goods
capMusic: 220, capSeated: 150, capApt: 40   // capacities
```

Day-of-week share of the weekly cost base (`COV`): Sun 6%, Mon 4%, Tue 5%, Wed 5%, Thu 10%, Fri 40%, Sat 70%. Unknown day falls back to 10%.

```js
tiers        = { sub: round(std*0.8), std, sup: round(std*1.2), door }
avg          = sub*mix[0] + std*mix[1] + sup*mix[2] + door*mix[3]
att          = e.att[e.scen]                        // scenario 0 quiet / 1 likely / 2 great
ticketsEx    = att * avg / gst
barMarg      = att * barHead / gst * barMargin
income       = ticketsEx + barMarg
base         = weekBase * COV[dow]
wheke        = sound === 'wheke' ? whekeFee(income) : 0
gear         = e.gear + e.adv + wheke + sum(addons.gear.cost)
comps        = crew * tok * tokenPrice * stockCost
hours        = onSiteShiftHours(assigned only) + taskHours(actual || est) + addonLabourHours
ourPeople    = hours * loaded
orgCost      = orgShareHours(e) * loaded
floor        = sum(liveArtists.low)      ceil = sum(liveArtists.high)
fixed        = base + gear + comps + ourPeople + orgCost + floor
surplus      = income - fixed
theirShare   = max(0, surplus) * e.split
ours         = surplus - theirShare      // "Retained by PicklePicklePickle"
theirTotal   = min(ceil, floor + theirShare)
perHead      = avg/gst + barHead/gst*barMargin
breakeven    = ceil(fixed / perHead)
fullPay      = ceil((fixed + (ceil-floor)/max(split,0.05)) / perHead)
```

Wheke Sound sliding-scale fee: `t = clamp((income - 3000) / 5000, 0, 1); fee = round((300 + 300*t) / 25) * 25`.

Org-wide labour (`ORG_ROLES`: venue administration, grant writing & reporting, bar admin & accounting, maintenance & working bees, marketing org-wide, governance & meetings) is pooled monthly and apportioned across the events in that month.

Once an event is concluded, actuals replace projections: `post = { tickets, ticketRev, barProfit, barTake, total: ticketRev + barProfit }` and the P&L labels change ("Tickets — n through the door", "Bar profit after stock", notes read "Gather.rsvp, reconciled" / "till read less stock cost").

`crewPayout(e)` aggregates every person's hours on the event (rostered + logged), multiplies by `loaded`, and carries a paid flag per person (`e.paid[initials]`). Artist payments are `e.aPaid[i]` against `e.artists[i]`, at their `low` (floor) figure.

---

## Interactions & behaviour

- **Role-based access.** `DEFAULT_PERMS` maps role → module keys; the Admin matrix mutates it live. A module absent from the role's list is absent from the sidebar and unreachable. Roles: `coordinator`, `design`, `tech`, `bar`, `admin`, `promoter` (labelled *"External coordinator · outside the venue"*).
- **External scoping.** `promoter` users see only events whose `promoter` matches their org, and only `pipeline` + `portal`. All venue-side actions are hidden, not merely disabled.
- **Command palette.** `⌘K` / `Ctrl+K` opens a centred 500px overlay (90px from top) searching events, screens and actions; `Esc` closes. Rows: icon, label, right-aligned hint. Empty state: *"Nothing matches that."*
- **Toasts.** Bottom-centre, surface background, `--shadow-lg`, max 460px, auto-dismiss at 3400ms. Three kinds — `good` `ph-check-circle`, `warn` `ph-warning`, `stop` `ph-warning-octagon`. Every mutation raises one, and the copy explains the *consequence*, not the action.
- **Activity feed.** Every mutation unshifts `{ who: initials, txt, when: 'just now' }` onto the event. This is the audit trail; keep it.
- **Text editing.** Inputs write to a `drafts` map on input and commit on blur (`onDraft` / `commitText`). Names edited in Admin propagate everywhere immediately.
- **Bar ticker.** A 1s interval increments a counter while the Bar screen is open, so the live take moves.
- **Hover / focus.** Row hover is a 4% neutral wash; palette row hover is a 12% accent mix; focus is Nocturne's 2px accent `:focus-visible` ring. No browser defaults anywhere.
- **Reset.** Admin offers a full state reset back to seed.

## State management

Prototype state (single component) — model your API and store on this shape:

```
user            current user id
screen          active module key
evId            selected event id
events[]        the event records — everything hangs off these
perms           { role: [moduleKey] }
avail           { personInitials: { weekly, volunteer, yes[], no[] } }
entries         logged task/hour entries
names           { personKey: overriddenName }
presets         tech rig presets (user-editable)
drafts          transient text edits, keyed e.g. 'finrev:note'
toast, paletteOpen, query, finView, pickShift, barTick   // ephemeral UI
```

Event record (abbreviated): `id, name, date, dow, days, space, kind, owner, promoter, internal, stage, concluded, scen, att[3], std, door, mix[4], sold, barHead, barClose, licence, gear, adv, sound, crew, tok, split, artists[{name, status, low, high, files{}}], shifts[{role, hours, start, person, state, asked}], tasks[{name, est, actual}], addons[{kind, name, cost|hours}], assets[{tier,…}], spread[], leads{}, deal{state, note, by}, settle{deposit, invoice, xero, closed}, paid{}, aPaid[], model, finReview{}, activity[], actual{}`.

Persistence in the prototype: `localStorage['p3-prototype-v1']`, `{v: 13, events, perms, user, screen, evId, avail, entries, names, presets}`. Saved state at `v: 12` or `v: 13` is **patched forward, not reset** — missing `model` and `finReview` are backfilled per event. Replace wholesale with a real API; keep the forward-patching instinct for schema changes.

Server-side, the pieces that must be real: authentication and role/permission enforcement (server-side, not just hidden UI), event CRUD with the stage-gate rules enforced on transition, an immutable activity log, hours records joining people ↔ shifts ↔ events, and integrations (Gather.rsvp, Facebook Graph, Eventfinda, Eventbrite, EPOS, Xero in/out, Mailchimp, Meta Ads, Slack, Telegram, Discord, Linktree) — the sidebar shows their health, and *Xero bills-in needs re-auth* is a modelled failure state worth keeping as a real one.

## Assets

No image assets. The brand mark is three inline SVG circles in accent ramp steps (`--color-accent`, `-500`, `-700`) at 19×19 in a 34px rounded accent-900 tile. Icons are the Phosphor web font. There are no photographs in this product.

## Files

- `design/Pickle Prototype.dc.html` — the full platform prototype (all twelve modules, all roles, all logic). Constants (`CFG`, `COV`, `STAGES`, `MODULES`, `ROLE_LABEL`, `DEFAULT_PERMS`, `USERS`, `PEOPLE`, `PRESETS`, `ASSET_SET`, `PLATFORMS`, …) are in the script block near line 3040; `calc()`, `gates()`, `crewPayout()` and `financeVals()` are the functions to port precisely.
- `design/Night Sheet (existing).dc.html` — the venue's existing night-sheet artefact, for context on the workflow being replaced.
- `design/support.js` — the prototype's runtime. Reference only; do not port.
- `design/_ds/nocturne-…/styles.css` — the design system's token and component layer. Take colours, type, spacing, radii and shadows from here.
- `design/_ds/nocturne-…/readme.md` — Nocturne's own usage guide.
- `design/_ds/nocturne-…/_ds_bundle.js` — the design system's component bundle (so the prototype opens correctly in a browser).

To view the prototype: open `design/Pickle Prototype.dc.html` in a browser. Sign in as **Sione Latu (Super admin)** to see everything, **Awhina Reid** or **Devon Marsh** to see the external promoter's scoped view.

## Open items

- Margin calculations across both booking models want testing against real historical settlements before launch.
- Red-flag notification delivery to coordinators is in-app only in the prototype; decide on email/Slack.
- Per-space permissions (e.g. a door supervisor who sees tonight's run sheet but not the money) are described in Admin but not implemented.
