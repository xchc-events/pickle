# Handoff: PicklePicklePickle — event management platform

## Overview

A single-tenant event management platform for **PicklePicklePickle** (XCHC, Ōtautahi Christchurch) — a music/arts venue running its own shows, hosting external promoters, and hiring rooms out dry. It replaces a spreadsheet-and-group-chat workflow with one event record that every department works off: enquiry → negotiation → confirmation → design/promo → on sale → rostering → show week → payout.

The platform's central claim: **one record of an event, one record of a person, one record of an hour.** Every number shown anywhere (a projected surplus, a wage line, a profit share) resolves back to hours logged against events and prices set on the event record. Nothing is typed twice.

Twelve modules, role-gated:

| Module          | Key         | What it is for                                                                                                    |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Home            | `home`      | Personal "needs you" queue, next event, my hours                                                                  |
| Pipeline        | `pipeline`  | All events, with a status for each part of each — see the 16 Sep 2026 note under Pipeline; opens the event record |
| Ticketing       | `ticketing` | Tiers, allocations, sales curve, door list                                                                        |
| Design          | `design`    | Asset checklist by tier (hero/lead/support), artist file collection                                               |
| Promotion       | `promo`     | Channel spread, platform push status, content rules                                                               |
| Tech production | `tech`      | Rig presets, gear/labour add-ons, patch and requirements                                                          |
| Roster          | `roster`    | Shifts per event by role, assignment against availability                                                         |
| Bar             | `bar`       | Live take, spend/head, margin by product, stock cost                                                              |
| Hours           | `hours`     | Timesheets: rostered shifts + logged task hours, per person                                                       |
| Finance         | `finance`   | Settlement P&L, booking-model milestones, **finance review**, wages run, Xero posting                             |
| Admin           | `admin`     | Role/module permission matrix, users, people records, reset                                                       |
| Sign-offs       | `portal`    | External promoter portal — their events only, deal terms, file requests                                           |

## About the design files

The files in `design/` are **design references created in HTML** — a working prototype that demonstrates intended look, structure, data model and behaviour. They are **not production code to lift**. `Pickle Prototype.dc.html` is a single-file component written against a bespoke streaming-template runtime (`support.js`); it exists to be _read and reproduced_, not deployed.

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

| Token                            | Value                 | Used for                                                                                                 |
| -------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `--color-bg`                     | `#161826`             | Page ground                                                                                              |
| `--color-surface`                | (from styles.css)     | Cards, dialogs, toast, palette                                                                           |
| `--color-text`                   | `#e9e9ed`             | Body text                                                                                                |
| `--color-accent`                 | `#9184d9`             | Section headings, primary outlines, key figures                                                          |
| `--color-neutral-100…900`        | OKLCH ramp            | Text hierarchy: 100 = brightest, 400–500 = secondary, 600–700 = tertiary/muted, 800–900 = borders/tracks |
| `--color-accent-100…900`         | OKLCH ramp            | Accent text on tints (100–300), tints and hovers (700–900)                                               |
| `--color-divider`                | (from styles.css)     | 1px rules, card borders                                                                                  |
| `--radius-md` / `--radius-lg`    | 8px scale             | Cards, chips, panels                                                                                     |
| `--shadow-sm/md/lg`              | tuned to ground       | Elevation — never stack shadows                                                                          |
| `--font-heading` / `--font-body` | Inter 500 / Inter 400 | Headings never bolder than 500                                                                           |

Three **status colours** are declared inline on the app root and are local to this product (they are not in Nocturne):

```css
--st-warn: oklch(0.734 0.125 68);
--st-warn-dim: oklch(0.3 0.055 68);
--st-good: oklch(0.734 0.115 152);
--st-good-dim: oklch(0.29 0.05 152);
--st-stop: oklch(0.7 0.14 25);
--st-stop-dim: oklch(0.3 0.07 25);
```

Promote these to real tokens in your theme. `good` = done/healthy/paid, `warn` = pending/thin/attention, `stop` = loss/blocked/red-flagged.

**Icons:** Phosphor Icons (regular weight), loaded from `@phosphor-icons/web@2.1.1`. Icon names appear throughout the prototype as `ph-<name>`. **Type:** Inter 400/500/600 from Google Fonts.

Nocturne conventions to keep: outlined primary buttons (accent border on transparent, never filled); rules that fade to transparent at one end (`linear-gradient(to right, var(--color-divider), transparent)`) — this is the signature of every section heading; low chroma outside the accent; `:focus-visible` = 2px accent outline, offset 2px.

### Repeating layout patterns

- **Section heading:** 12px, `letter-spacing: 0.13em`, uppercase, `--color-accent`, followed by a 1px fading rule filling remaining width, optionally a 11.5px `--color-neutral-600` note at the right. Used dozens of times; make it a component.
- **Metric strip:** `display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--color-divider)` with `--color-bg` cells — the 1px gap _is_ the divider. Label 10.5px neutral-600, value 24px heading font, `font-variant-numeric: tabular-nums`.
- **Row list:** full-width `<button>` rows, transparent background, `border-top: 1px solid color-mix(in srgb, var(--color-divider) 55%, transparent)`, hover `color-mix(in srgb, var(--color-neutral-100) 4%, transparent)`.
- **Chip filters:** 11px, `padding: 3px 10px`, `border-radius: 11px`, 1px border; selected state swaps border to accent and background to a 14% accent mix.
- **Avatar:** 22–24px circle, initials in heading font at 9–9.5px.
- All money and hour figures use `font-variant-numeric: tabular-nums`.

---

## Screens / views

The app is one shell with a module switcher. Layout: **sidebar 232px fixed** (brand, search button, module nav, integrations panel, current-user footer) + **main region, flex 1, scrolling**. Header blocks are `padding: 26px 28px 20px` with a bottom divider; content bodies `padding: 22px 28px 40px`.

### Login

Role picker, not a credential form — `max-width: 460px`, centred. Brand lockup (three-circle pickle mark in accent ramp + "PicklePicklePickle" / "XCHC · Ōtautahi Christchurch"), `<h1>` "Sign in" at 27px, then one row per user in `USERS`. Copy: _"Pick a role to explore. What you can see and do changes with it."_ Footnote states persistence is browser-local with a reset in Admin.

In production: replace with real auth; keep the idea that role determines the visible module set.

### Home

Greeting + subline. Four-cell metric strip. Two columns: **"Needs you"** action queue, every row a single link (icon, title, sub, age in a status colour) — a **"Nobody's on these"** list of its own below it, shown only when it has anything in it — and a 296px aside with **"Next upcoming events"** (up to the two soonest confirmed nights: name, when, days-out counter at 27px accent, one-line status, primary button) and **"Your hours this month"** (figure, the reader's own pay at their rate, progress bar, primary button to log time).

> **Built 17 Sep 2026, on the parts rather than the stages.** "Needs you" is the failing gates of each event's parts (see the note under Pipeline), each put in front of the person it waits on. The event's own business — the booking, the licence, counting the door, putting the night to bed — goes to its owner. A department's part goes to its lead. Shift gaps and closing the bar go to anyone who can open Roster or Bar, as the prototype had it. Where nobody named could act (no owner, an owner who never signs in, a lead whose role cannot open the screen), it goes to everyone who can open the part's module, and for the event's own business that is Finance. A reader only ever sees gates on screens they can open.
>
> Some things count as today's however far off the night: a part that wants attention or is blocked, artwork up for sign-off, a booking still moving, a night to settle. Other unfinished work on a confirmed booking counts once the night is inside the Pipeline's "Next 30 days", or if a coordinator has flagged it. Once a night has passed its departments are history and only settling it is, except that a booking which never reached confirmed is still asked about, since nothing else would say so. The list shows everything, sorted with anything blocked first, then whatever is due soonest (the booking's own target for the booking, the door for everything else).
>
> The four tiles are kept for anyone who can open the Pipeline: in the pipeline, the next 30 days, at risk, and — since 22 September 2026 — revenue for whoever can also open Finance, or on sale for whoever cannot. "At risk" reads the Pipeline's own flag, since the stage targets it counted went with the stages. Revenue is "Income, as settlements count it" (Connor, 22 Sep 2026): ticket sales ex GST plus bar profit, `financeVals`'s own `income`, actual over the last 4 weeks and projected over the next 4 — one figure so the two cannot disagree. It is Finance-only because permissions are module-based and a super admin always has Finance. A role that cannot open the Pipeline gets shifts to fill and bars to close instead.
>
> "Next upcoming events" shows up to the two soonest _confirmed_ nights, soonest first. Each shows where its parts stand and its own surplus, only to someone who can open the event record. "Your hours this month" is the reader's own hour entries, by the day worked (a rostered shift counts on its night, and is "still to come" until then; anything typed is worked), measured against the weekly hours on their availability.
>
> An outside account is refused Home, as it is Bar; its equivalent is Sign-offs. Home is one of the venue's own modules (`VENUE_ONLY` in `src/lib/constants.ts`), which `modulesOpenTo` in `src/lib/scope.ts` takes off an outside account whatever its role is granted, so `requireModule('home')` has already refused. `homeRefusal` in `src/lib/home.ts` stands behind that.

> **Tidied 22 Sep 2026, from Connor's walkthrough of the screen.** "Needs you" now holds only what is the reader's: a claim of `null` (a queue addressed to anyone who can open the module — fill a shift, close a bar) still belongs there, but a claim of `'unclaimed'` — reached this reader only because nobody named could act — moves to "Nobody's on these" instead, and the greeting subline counts only the former. Connor: _"if there's a super admin with zero of their own events, I don't see why it would be saying that these things need to be done by me."_ The six-row cap and its "N more after these" line are gone; both lists now show everything, `NEEDS_SHOWN` and `shownNeeds` with them. Each row's separate "Open the event →" text is gone too, now that the whole row has always been the link; `cta` left the `Need` type along with it. "Next through the door" became "Next upcoming events" (singular with one), showing up to two nights instead of one. The hours card's cap line no longer reads like a limit: "of about 19h you can do this month" is now "of the ~19h you're available this month", and the line under the bar never repeats the total as "Nh worked" — only "Nh still to come" when some is, or "nothing logged yet" for zero. "Log your time" is now a real button, reusing the next-event card's `.nextButton` class. See `src/lib/home.ts` (`splitNeeds`, `pickNext`, `myHours`) and `src/app/(app)/home/page.tsx`.

### Pipeline

Header with title/kicker/sub and a primary "New enquiry" button (hidden for roles that can't create). Filter row: stage chips + a divider + space chips. Events grouped by stage with `STAGES` names and playful internal nicknames (`NICK`: Fresh, Brining, Sealed, Labelling, On the Shelf, Crewing, Cracked, Tasting Notes) and per-stage target counts (`STAGE_TARGET`). Each row: name (224px), meta line with icon, stage progress bar, days-out, projection ("proj. $X" / "took $X" / "modelling"), owner avatar. Below: 4-cell metric strip and a **"Where the labour goes"** breakdown.

> **Changed 16 Sep 2026 — each event carries a status per part, not one stage.** The eight stages moved an event through enquiry, negotiation, confirmation, design, on sale, rostering, show week and payout in that order. That is not how a night comes together at XCHC: tickets go on sale while the artwork is still being signed off, and a promoter can send the graphics for their whole tour with the booking enquiry. So the venue decided each event carries a status on each of eight parts — **Booking** (enquiry → negotiating → confirmed), **Design**, **Promo**, **Tickets**, **Licence**, **Tech**, **Roster** and **Settlement** — and the pipeline's eight cells show where each part stands on its own, rather than ticking off the stages behind a single cursor.
>
> Only the booking is moved by hand. Every other part's status is worked out from the records its own module keeps — the asset set, the listings, Gather.rsvp, the shifts, the actuals — so it cannot disagree with them and nobody types it twice. The one order between parts that still refuses is that **tickets do not go on sale until the booking is confirmed**. Design, promotion, tech and rostering may all run ahead of the booking. The column heads count the events still to finish each part; "sorted by time stuck" became "sorted by what needs attention", since there is no single stage to be stuck in. The first three nicknames (Fresh, Brining, Sealed) and stage targets (3 and 7 days) now belong to the booking; Labelling, On the Shelf, Crewing and Tasting Notes to the parts that grew out of their stages. See `src/lib/parts.ts`.

> **Built 21 Sep 2026 — "New enquiry" opens a form, for the venue and for outside promoters.** In the prototype the button raised a toast, *"A new enquiry starts as the public event sheet — the promoter fills it, you never re-type it"*, and it was hidden from external users. That sheet was never built, so nothing in the app could create an event at all: every module worked on seeded rows. The button now opens `/events/new`, and an outside promoter sees it too, as long as their account belongs to an organisation.
>
> It is one form with two readers, and since later the same day (see the note below) both of them model the night. The venue's people also say who is bringing it (the venue itself, an organisation on file, or a name not on file yet), who owns it, the split and the brief, and can hold the room in the same step. The figures start from the prototype's own `mk()` defaults, shown in the form to be changed, never applied silently. What stays the venue's on an outside promoter's enquiry, whatever their request carries: their own organisation, the date as a preference (TBC) until a coordinator locks it, every act enquired, the house split, no owner, no brief, no hold. See `cleanEnquiry` in `src/lib/intake.ts`.
>
> An enquiry from outside arrives with nobody's name on it, which puts it under Home's "Needs you" as unclaimed for everyone who can open Finance. The event record's **Owner** is now a picker for the venue, so taking one on is how it leaves that queue. Every new event gets the five off-site task estimates the prototype gives every event (`HOUSE_TASKS`), since nothing else creates them and they feed the wage line.
>
> **Changed 21 Sep 2026, the same day — the enquirer models the night, and a night starts and ends when it does.** As first built, the form kept every figure out of an outside promoter's hands, on the reasoning in `PG-9` that nothing a promoter types should reach the P&L unconfirmed, and offered doors, bar close and everyone out from three fixed lists. Connor, on seeing it: *"This form is missing most of the fields it needs […] It needs to show live financial modelling for the event as they are booking it, so that it shows the onus is on the enquirer to make the event make financial sense,"* pointing at the venue's public Night Sheet (xchc.co.nz/our-new-events-model), and *"the time slots are bizarre and incongruent. Make it so an event can start at any time and it can end at any time, as long as it ends after it starts."*
>
> So both forms now carry the model's inputs (the deal, the standard and door prices and the four-way mix, quiet / likely / great, bar spend a head, gear and hire, promotion, sound, comps, and a fee floor and ceiling for each act) beside a live panel: income, the night's share of the week, the costs, our people, their people, the surplus and who gets it, the head counts that break even and pay everybody in full, and a verdict on the likely night. The panel is `modelOf` in `src/lib/enquiry-model.ts`, which builds a `FinanceEvent` and calls `financeVals`. It never works money out itself: same function, same figures as the event record. They differ in one place, on purpose. The panel shows the night fully crewed, from the standard roster (`shiftPlan`) and the house's off-site hours, because that is what the night costs when it runs and it is what somebody deciding whether a night adds up needs to see. The event record counts crew only as shifts are assigned (`billableHours`), and an event made here has no shifts yet, so its record reads a higher surplus than the form did until the night is rostered. Whether the record should count planned shifts too is a change to what the projection means everywhere, and is the venue's to decide. A promoter's figures are stored on the enquiry as their proposal, the prototype's "the promoter fills it, you never re-type it", and the venue corrects them with the editor under Event record. A night that loses money on a likely turnout is told so, loudly, and can still be sent: the coordinator is who says no.
>
> The website's Night Sheet is **not** ported, and it is a different model: it splits one pool 50/50 between their people and ours, pays each side up to full with XCHC's crew capped at $35 an hour, and will not take a booking whose likely night pays the crew less. `finance.ts` pays the floors and the crew's hours as costs and splits the surplus by an agreed percentage. Which is right is for the venue to decide against real settlements (`PG-5`). Its fields with no column here yet are left out: room layout, lighting and VJ operators, bar service, "provide your own" door staff, sound tech and design, and donating a share of the surplus.
>
> Run times are any time of day, still stored as the strings the licence gate, the roster and the till window read (`'8:15pm'`), and an event has an `endDate`. It has to end after it starts; the bar closes after the doors open and no later than the end. The end date fills itself in from the times (the next night when everyone is out at or before the hour the doors opened) and follows them until somebody chooses one. The three pick-lists in `event-record.ts`, which a comment there called specification, are gone. See `src/lib/run-times.ts`.
>
> Still to come: turning a name "not on file yet" into an organisation, and changing a booking's date, room or name once it is made. The public, signed-out sheet the prototype imagined is `PG-9` in `docs/product-gaps.md`. Editing the acts, the terms and the figures afterwards came the same day; see the note under Event record.

> **Changed 23 Sep 2026, from Connor's walkthrough of the screen.** The module nickname is gone for a venue user — *"We can get rid of this word, the Crock, don't need that"* — though an external user's sub-line still names their organisation, since that says whose events they are looking at; Bar's "the Cellar" and Hours' "the Ledger" went the same way. The booking cell's age and the seed's own risk note now read in words rather than a bare day count — *"This language of 'confirmed 9d' — should that actually be 'confirmed nine days ago'?"* — both via `days()` in `src/lib/format.ts`. `metaLine` now names the internal owner (or "no owner yet") and the external coordinator instead of saying "internal": *"We don't need to state 'internal'; have the internal event coordinator or event owner and the external event coordinator named in this section."* A second line under the name gives the date and the run, doors to everyone out, from a new `runLine` — *"Right here on this little card, it would be good to see the date for it, and the start and end times"* — with a spot held in it for pack-in and pack-out once that wave adds them. The right column drops to days-to-door alone, under "Door": *"We don't need the 'who owns it' over there, or 'projection'. It's better to be just a name in this section."* `projection()` goes with it. The four metric cards are gone too — *"None of these cards are useful at all. We can get rid of those cards"* — along with `pipelineMetrics`. "Where the labour goes" is untouched here; it is moving to Finance under a separate change.

> **Changed 23 Sep 2026, the same day — "Where the labour goes" moves to Finance.** *"This type of financial breakdown isn't helpful on this screen. It would be helpful to see this on the Finance module."* The block, its `loadPipeline` call and the `labourSplit` import are gone from this page. `labourSplit` itself is unchanged and stays in `src/lib/pipeline.ts` with its own tests — Finance reads it through a new `loadLabour` in `src/lib/finance-data.ts` that hands it the same `loadPipeline(user)` this page still uses for its rows.

> **Changed 23 Sep 2026 — Month and Week views join the matrix.** *"It would be really nice to have a calendar view for this, a month-long calendar view and also a weekly one. On the month one you can just see which events are booked on a date, similar to a Google Calendar view. On the week view you should be able to see the actual times booked out for each event."* A view switch — Matrix (the default) · Month · Week — sits beside the filter chips, carried in `?view=` the same way `status` and `sort` are, so a bookmark keeps it. Both new views read the full `loadPipeline(user)` rows rather than the matrix's filtered/sorted subset: a calendar shows what is on each date, a concluded event dimmed rather than dropped, same rows the matrix's own "Concluded" chip does the opposite of. Both stay scoped to an external user's own events, since that scoping is in the query the matrix already used, not in how a view chooses to draw the rows.
>
> Month is a Monday-first grid with previous/next month links; a card for every event on every date it covers, so a run that crosses a calendar date — a small-hours finish, or a true multi-night booking — lists on each one. Week lays a block from pack-in to pack-out for each event, falling back to doors/everyone-out and then a default evening window when neither is set, said on the block rather than printed as if it were decided. On overlap: *"we don't need a hard rule that says an event has to be packed out before another has packed in"* — two events that overlap sit side by side in the same day column rather than being refused. A run past midnight clips at the day boundary with a "→ 1:00am" label rather than splitting its block into the next day's column — an event's block is one element the day links from, and the Month view is already where the rest of a multi-date run shows. See `src/lib/calendar.ts` and its tests.

### Event record

The hub. Back link, title, badges (stage, space, booking model), and tabbed/stacked sections: the enquiry facts (owner, date, space, kind of night), artists with fee floor/ceiling and status (`enquired`/`pencilled`/`confirmed`/`declined`) and file checkboxes (`RIDERS`: promo pics, bio, EPK, hospitality rider, tech rider), **Terms & split** (split slider, deal state `agreed`/`queried`/`sent`), licence state (`LICENCE`: not required/required/applied for/confirmed/denied), bar close time, leads per department, and an **activity feed** (initials, text, when) which everything writes into.

**Stage gates** are the load-bearing interaction: each stage transition lists named conditions with a pass/fail state, a reason, and a deep link to the screen that fixes it. An event cannot advance while a gate fails. Gate sets are defined per transition in `gates(e)` — reproduce the full list from the prototype; examples: _An owner is named_, _Date is locked_, _At least one act confirmed_, _Fee floor and ceiling agreed_, _Terms agreed with the promoter_, _Bar close decided_, _Artist bios and pics in_, _Licence filed if it is needed_.

> **Changed 16 Sep 2026.** The gates are now held by the parts (see the note under Pipeline). Every condition `gates(e)` defines is kept, worded as it was, on the part it belongs to, with its reason and its deep link — `src/lib/parts.test.ts` lists them and fails if one goes missing. One was folded rather than moved: _Door list pulled_ tested exactly what _Tickets live on Gather.rsvp_ tests. What changed is the ordering: finishing one department no longer holds another up. Two moves are still refused while a gate fails — moving the booking on (enquiry → negotiating → confirmed) and putting a counted night to bed — and the event record shows each part with its failing gates under it in place of a single "Move to …" gate list. Signing off the last piece of artwork no longer moves anything or pushes any listing; the bar budget now locks when tickets first go live on Gather.rsvp.

> **Built 21 Sep 2026 — the bill and the terms can be changed.** Until now an act's status and fees, the split, the booking model and the figures the projection runs off were set when an event was made and by nothing afterwards, so an enquiry sent in from outside (every act enquired at $0, no split, no figures) could never clear "At least one act confirmed", "Fee floor and ceiling agreed" or "Split agreed". The venue can now change them on the event record. An outside promoter still changes nothing here: every action refuses them, and the controls are not drawn.
>
> The copy is the prototype's (`cycleArtist`, `addArtist`, `removeArtist`, the rename in `commitText`, `setFinModel`), with every change also written to the activity feed, which the prototype only did for the model. Where it departs, and why: an act's status is a picker over the four statuses rather than a button that cycles through them, because the cycle passes through *declined*, which moves money. Adding an act takes a name and starts at $0 to $0, where the prototype added "New name" at $100 to $250, a fee nobody agreed. The split is a slider with the prototype's three presets and is written only when "Set the split" is pressed, not on every tick of a drag. Switching the booking model lives here rather than in Finance, which only lists confirmed bookings and would be too late for an enquiry. Its curator toast no longer says finance signs off in between, which the advice process replaced.
>
> Three things are refused in words: any change once the night is put to bed, since its figures are the settlement's by then; a change to the status or fee of an act who has been paid, or taking them off the bill; and switching the model once a deposit or an invoice has been raised, until Finance reverses it. Attendance, bar spend a head, gear and hire, promotion, crew and tokens a head had no editor anywhere in the prototype, which took them from the Night Sheet; they are one small form under the terms, and the change is one activity line naming only what moved. The rules for all of these are in `src/lib/terms.ts`, which the enquiry form now reads too, so the two cannot disagree about what a valid fee is. Sound and the kind of night are left for Tech production, where the prototype edits them.

> **Changed 23 Sep 2026 — wording and two controls.** "It should be like 'type of event' rather than 'kind of night'": the enquiry fact and the enquiry form field both read "Type of event" now; the underlying `kind` field is unchanged. "We don't need that little explainer there": the line under the lead pickers explaining that a lead is a person, not a typed-in name, is gone. "Rather than this button saying what it does, it should show that the date is confirmed, or negotiating … if it indicates the status and then you can manipulate that status": the date control is now a status chip reading "Date TBC" or "Date held" rather than an instruction, with what a click does moved into its title and the click itself unchanged. "This UI is massively overstretched. It would be better if this was closer in": Where each part stands is capped near the width of the leads block above it, and each part's gate count now sits beside its status chip instead of at the far right, so a row reads as one line. "Bank details... should be uploaded by the artist and promoter themselves, or the internal event coordinator, on the overall event view": the Artists section now carries "Give them a record" / "Send them a link" per act, moved here from Tech production — see the note under Tech production.

> **Changed 23 Sep 2026 — pack-in, pack-out, and two condensed blocks.** From the same walkthrough. "It would be good to have a beginning of the pack-in time and the end of the pack-out. That's really the amount of time an event needs to be blocked out for. We don't need a hard rule that says an event has to be packed out before another has packed in": two more free times on the event, `packIn` and `packOut`, stored and read the same way doors and everyone-out are — pack-in has to be at or before doors, pack-out at or after everyone-out — with no rule connecting one event's pack-out to another's pack-in. The end date now follows pack-out the same way it already follows everyone-out, carried one night further when pack-out's own reading implies it runs past its own midnight.
>
> "It'd be nice if all of this date and time stuff was in one smaller, more condensed thing. It should have a beginning date and an end date. It's annoying that I have to look up here to see the beginning date": one "When" section — Starts (the date, read-only here, with the date-held chip from wave one beside it) and Ends on top, then pack-in, doors, bar close, everyone out and pack-out in a single row of small time fields, in place of the Date fact and the four-field run-times block.
>
> "It would be nicer if this was more condensed. These four could just be under 'event leads'. It should be identified under these leads who the coordinator or external promoter is, rather than it being up here, so you can see all of the team": one "Event leads" section, a tight two-column list — Internal owner, External coordinator, then Ticketing, Design, Promo, Tech — in place of the owner living alone in the facts row; the header sub-line stops repeating the promoter's name, keeping the date, space, days to door and booking age. "If you need to call this person we want your phone number and email": every named lead now shows `Person.email` and the linked `User.phone` as selectable text beside the name, for an external promoter too on their own events, since the loader already scopes the event to them.
>
> "Change this to being 'internal owner', and that has to be someone within XCHC who has the event coordinator role. And then we can have an optional field for an external": the internal owner picker now lists only people whose account carries the coordinator or administrator role — Connor decided administrators count too — and `setOwner` refuses anyone else with a plain message. The external coordinator is a new picker over the promoter organisations on file (`Payee` of kind `PROMOTER`), venue only. It sets `promoterId`, the field `eventScope` (src/lib/scope.ts) matches an outside account's events on, so changing it moves an event out of one organisation's reach and into another's, not only its display.

### Ticketing

Tiers derive from one number: `std` (standard). `sub = round(std × 0.8)`, `sup = round(std × 1.2)`, plus a `door` price. A four-way `mix` (subsidised/standard/supporter/door proportions) produces the average ticket price. Shows allocation, sold count, sales curve, and door list. Source of truth is **Gather.rsvp**.

> **Corrected 2 Sep 2026.** This line previously read "supporter/standard/subsidised", which contradicts the prototype it describes: `TIER_KEYS` is `[sub, std, sup, door]` and `avgTicket` pairs `mix[0]` with `tiers().sub`. Read the wrong way round it prices a supporter at 80% of standard rather than 120%, and the mix feeds the average ticket price straight into the P&L. The prototype code is authoritative and is unchanged; only this sentence was wrong.

> **Changed 23 Sep 2026.** From Connor's walkthrough. "I don't call it 'the room'. That's dumb" — the first section is now **Ticket sales**, not "The room" (the capacity note is unchanged). "You definitely want to be able to see a big, really obvious thing of the revenue that's been generated" — a headline revenue figure sits at the top of that section, sold shown against capacity beside it and labelled GST inclusive, since that is what it is, not the ex-GST figure the settlement counts. "It needs to be clearer that if I change these numbers, that is going to change this data" — the Prices and Mix forms are folded into the tiers table itself: standard and door are typed, subsidised and supporter are derived and redraw live, and one Save sets both through a new `setTiers` action. "I don't want to be able to manually change how many tickets are sold ... that should be data that's pulled from Gather. We don't want it typed by hand at all" — the Sold form and `setSold` are gone; `src/lib/gather.ts` is a stub source for `sold` until the real Gather.rsvp API exists, shaped so the real client is a drop-in. "This shouldn't be where you're changing the financial projection ... the ticketing page is just for setting up the ticket sales" — the scenario picker ("How the night might go") and `setScenario` have left Ticketing for Finance.

> **Changed 23 Sep 2026, the same day — the sold bar becomes a sales-over-time graph.** On Ticketing's sold bar: "This wants to be a much clearer infographic, and interactive. I'd rather this was a graph showing ticket sales over time, with the ability to separate out how many of the different ticket types are in there, and to change the time scale — default from whenever the tickets go on sale to the current day, and then projections. These are helpful metrics and you can keep them on the graph. It would be better as a line with points. This should be bigger." The room-diagram bar, its markers and the flat-pace paragraphs are gone. In their place: a cumulative line per tier, on by default and toggleable from its own legend; a time scale defaulting to since on sale, with last 14 days and last 7 days zooming the same curve rather than resetting it; breakeven and full-pay as labelled reference lines in place of the old vertical markers; and the projection — still `paceOf`'s own figure, never reworked — drawn dashed from today to the door. Sold, to breakeven and to pay everyone in full stay underneath it as figures, same as before. A new `TicketSaleDay` row (event, day, tier, that day's sales) gives the graph something to draw: `salesHistory` in `src/lib/gather.ts` reads it, the same stand-in pattern as `readSales`, until a real Gather.rsvp client replaces the table read. The chart's own maths — the cumulative totals, the scale, the projection segment — is pure and tested in `src/lib/sales-chart.ts`; the client component, `SalesChart.tsx`, only draws what it is given and holds the two toggles.

### Design

Asset checklist built from `ASSET_SET`, tiered `hero` / `lead` / `support`, each with format spec and a rationale line. Hero = two vertical video cuts (9:16); lead = the 1920×1005 event cover; support = story, A2 poster, listing copy. `CONTENT_RULES` render as a short doctrine panel: vertical video first (twice), video beats a still, almost no words on an image, real over polished, one idea per asset.

> **Changed 23 Sep 2026.** Connor: "Just 'design and communications' is fine" — the page title is now "Design & communications" (the sidebar still says "Design").

> **Changed 23 Sep 2026 — the checklist says who to chase.** "Why is it saying six acts to chase, and then when we come through here it doesn't look like there's anything left to do? That doesn't make much sense at all." (Connor). Design now lists, under the brief, every live act still missing a press shot or a bio, each with what is missing — the same `hasPromo`/`hasBio` per act that the Pipeline cell counts, through `missingBiosList` in `design.ts`, so the two screens cannot disagree. The Pipeline cell's own wording changed to "N acts' bios and pics to chase" to match.

> **Changed 23 Sep 2026 — the hours card reads what was actually logged.** "Run the timer from the event record, overruns land in the event's cost, not in nobody's — that's useless. But marketing hours used, yeah. It would also be good to see who has done that work." (Connor). The card now sums `HourEntry` rows logged against the event by the design team, against the design task's estimate, and lists who logged them — not the task's own `actual` column, which nobody types.

> **Changed 23 Sep 2026 — uploads say when storage is off.** "Does it actually work if I try and upload something?" (Connor). Design now shows the same "file storage is not configured" notice Tech does, and hides the upload control, when R2 isn't set up. `docs/RUNNING.md` gained a "Testing uploads locally" section covering the bucket's CORS rule, since the browser uploads straight to R2.

> **Changed 23 Sep 2026 — sign-off is the owner's or the promoter's, not design's.** "So how do I change if this is signed off or not?" · "We should make it that sign-off can happen from either the external promoter or the internal event owner." (Connor). Approve on any piece of the set is now refused for a design-role user, or for a coordinator who is not the event's owner, or for a promoter of a different organisation; it is allowed for the event's internal owner (`Event.ownerId`) and for a promoter of the event's own organisation (`Event.promoterId`) — see `maySignOff` in `src/lib/design.ts`. Design staff get "Ready for sign-off" in its place, moving a piece from draft to review; deciding it belongs to whoever may sign. The asset row now records who signed and when (`signedById`, `signedAt`); `promoterSigned` is kept, true only when the signer was the promoter, so the portal's own "promoter signed off" line still reads correctly. The Pipeline gate that used to read "Promoter signed off the creative" is now "Signed off by the owner or the promoter", and a piece counts as signed only once it is APPROVED with a recorded signer — an approval from before this feature carries no signer and does not count retroactively. **Admins are not among the signers.** Connor did not rule on this explicitly; an admin can grant themselves the owner's role, so treating that as a way to already be a signer would have been a decision made by accident. Said here plainly so it can be changed if he wants it to include them.
>
> **An approved piece can be reopened**, by the same people who may approve it: it goes back to review, its signature is cleared, and it asks for a sentence saying why — which becomes both a comment (below) and an activity line.
>
> **Comments.** "It would be good if we had an area here for comments between the design team and whoever it is that's signing off. You want comments either per asset, or a general design comment section." (Connor). Every piece now carries its own comment thread, and the brief carries one general thread for the event's design as a whole; the venue's design staff, coordinators and owner can write on either, a promoter on their own organisation's events only. Every comment is also an activity line, and "Ask for a change" posts its own words as a comment rather than only a one-line refusal.

### Promotion

`PLATFORMS` list with per-platform integration mode (`api` vs `manual`) and a note on how each is handled — Gather.rsvp (source of truth), Facebook event (Graph API), Instagram (manual), Eventfinda, Eventbrite (inventory capped so it can't oversell), EventsHub (council, moderated, 2 working days), Linktree, Telegram, Discord. Plus channel spread state per event.

> **Changed 23 Sep 2026 — the Promo lead card carries contact details.** "We need contact information on these sections, because if you need to call this person we want your phone number and email. That way external organisers can easily access it." (Connor). The Promo lead panel now shows the lead's email and phone as plain, selectable text underneath their name — no `mailto:`/`tel:` links. An external promoter sees this only for their own organisation's events; `loadPromo`'s existing `eventScope` is what enforces that, unchanged by this work. The same fields were added to the Design lead card, and to `User`'s row editor in Admin (below) so a staff account's phone has somewhere to be set. The event record's own leads block gets the same fields separately.

> **Changed 23 Sep 2026 — the live link is on the card.** "It would be good to have the links in here — the actual links for Facebook and the others — so if you need to copy them and send them to anyone, you can easily grab them from here." (Connor). Every channel card now shows what went out as selectable text, with a copy button and an "open in a new tab" link, once something has. A manual channel's tick-off form asks for the link by hand, optionally — `ChannelPush.url`, left alone rather than cleared when a re-post's field is left blank. An auto-sync channel records whatever its client hands back; none of the ten has a real client yet, so what is stored today is a placeholder shaped like the real thing and says "example" in it, never a made-up real-looking address — see `stubPushUrl` in `src/lib/promo.ts`.

### Tech production

`PRESETS` are one-click rig bundles that append gear costs _and_ labour hours to the event: in-house projection mapping + VJ, full band backline, livestream & multitrack, extra lighting rig, silent disco headsets. Each item is `{kind: 'gear', cost}` or `{kind: 'labour', hours}` and flows straight into the finance model. Tech roles: `Sound — Lead`, `Sound — 2IC`, `Lighting — Lead`.

> **Changed 23 Sep 2026 — hospitality riders and Acts and their details leave this module.** The sub-line no longer opens with "the Rig". "Hospitality riders are currently under the tech production section. We need to move that out. There's no reason for tech production to see that": the set this module tracks is now tech rider, stage plot and venue spec; the hospitality rider stays on the event record's own Artists section, per act. "We don't need bank details coming into this section. That should be uploaded by the artist and promoter themselves, or the internal event coordinator, on the overall event view": Acts and their details — names, status, masked account, the payee link — is gone from Tech entirely, and `issueArtistLink`/`linkArtistToPayee` moved to the event record's own actions, gated on Pipeline and `canChangeEventRecord` rather than the Tech module. Tech staff see no account figure anywhere on this page now.

> **Changed 23 Sep 2026 — tech rider and stage plot are per act.** "The only details we want to see here are tech riders and stage plots. These two want to be per artist, and you can have a section for the promoter as well." (Connor). The page now lists every live act with its own tech rider and stage plot slot — open, the version, and replace, which supersedes rather than overwrites the same as it always has — then one row for the promoter's own documents, filed against their payee rather than a slot, then the venue spec row from wave one, unchanged. `StoredFile.artistId` carries which act a file is on; a rider uploaded through an act's own access-grant link lands there automatically, because `resolveGrant` now resolves the act the link's payee is linked as on the link's own event. A file uploaded before this — everything, on the day this shipped — has no act and sits under "Unassigned" with a picker to say whose it is. The queue's have/need reads two slots, rider and stage plot, for every live act, in place of the flat three-kinds-per-event count from wave one; the venue spec and the promoter's row are shown but not counted towards it. The event record's own per-act tech-rider tick reads the same `artistId`, so the two cannot disagree about the same act.

> **Changed 23 Sep 2026 — the venue spec is composed and emailed, not uploaded.** "It'd be better to have a more full-featured option where you can select which components of a venue spec sheet you're sending out, as not all of them are relevant to all people. It doesn't make sense that it says 'venue spec sent' and then 'add it yourself', because this will only be uploading on our end, whereas we want it to be emailed out." (Connor). The venue spec row is now "Send the venue spec": a `VenueSpecComponent` house table — key, title, body, order, active — holds the sections (room dimensions and capacity, stage, PA and monitors, lighting rig, backline, power, load-in and parking, green room, bar and catering, house rules, contacts), edited in Admin, "Venue spec" (below). Tech ticks which components go and who they go to — an act with an email on its payee, or the promoter — sees exactly what that assembles into, and sends; a recipient with no email on file is refused, named. `VenueSpecSend` records the event, the components, the recipients, who sent it and when, and the row now reads "sent to … on …" off the most recent of these, which is what "sent" means now. The `TECH_SPEC` upload from wave one is gone, and with it `TECH_SPEC`'s place in `TECH_SET`.

> **Changed 23 Sep 2026 — a tech run sheet.** "A section here which allows you to fill in a run sheet, like a tech run sheet, would be really helpful. And then sending that to the promoter." (Connor). A new event's run sheet starts from its own pack-in, doors, bar close, everyone-out and pack-out — the same five times Roster already prints, below — as rows the tech lead edits in place, adds to, removes from and reorders; `RunSheetItem` holds them once saved, one save replacing the whole sheet rather than one action per row. "Send to the promoter" always includes them, plus any act ticked alongside, emails the sheet as text, and records a `RunSheetSend`. The promoter's own portal (see "Sign-offs", below) shows the sheet read-only once it has been sent at least once — live, off the same rows Tech's own page reads, not frozen at whatever it said the moment it was last sent.

### Roster

Shifts generated per event from role windows (`ROLE_WIN`, or `ROLE_WIN_EARLY` for early events; apartment and workshop events get reduced hours). Each shift: role, hours, start offset, assigned person, state, "asked" count. Assignment is checked against `AVAIL_SEED` (per-person weekly hour cap, volunteer hours, yes/no day-period preferences keyed `Fri-eve`, `Mon-day` …). **Roster ↔ Hours is two-way**: assigning a shift creates the hours; editing hours reflects back.

Roles: Duty manager, Bar staff, Sound — Lead, Sound — 2IC, Lighting — Lead, Door, Care team, Set-up crew, Clean-up crew.

> **Changed 23 Sep 2026 — two headline figures in place of "the call".** The sub-line no longer opens with "the Crew". "Make that bigger and more obvious, rather than 'the call'. Maybe call it projected or rostered hours, and projected full cost": the single corner figure is now two labelled, headline-sized figures, Rostered hours and Projected cost — the same `callHours` and `callCost`, same source.

> **Changed 23 Sep 2026 — pack-in and pack-out.** With pack-in and pack-out added to the event (see the note under Event record), set-up crew's call now defaults to starting at pack-in and clean-up crew's to ending at pack-out — worked back to a start by its own length — else the role windows above are unchanged; `crewCallStart` in `src/lib/roster-data.ts`. The event header here now also prints the five times in order: pack-in, doors, bar close, everyone out, pack-out.

### Bar

Live take ticking during show week, spend-per-head against the assumed `barHead`, margin by product modelled from the event's take and the house mix, stock cost at 40.2%, and an "Against the model" comparison panel. Bar labour can be toggled in or out of margin.

### Hours

Timesheets per person: rostered shift hours + logged task hours (`est` vs `actual`), every line attached to an event. This is the module that makes the profit share arguable — say so in the UI as the prototype does.

### Finance

The most specified screen. Event chip rail across the top (each chip: name, date, **booking model**, figure, note), then a header row with the model badge, a "Switch to dry hire / curator model" ghost button (hidden for external users), and the event identity line.

**Settlement P&L** (`finLines`) — label / value / note rows, with rules above the income and retained lines:

1. Tickets — _n_ at $avg average → ticket revenue ex-GST (projection with quiet/likely/great case, or reconciled from Gather.rsvp once concluded)
2. Bar margin — $x/head at 59.8% → bar margin (or actual bar profit after stock)
3. **Income, GST exclusive** (rule above; neutral-100) — with the GST collected and held stated in the note
4. − Cost base share — _day_ carries _n_% (rent, power, insurance, software)
5. − Gear, hire & promotion (incl. Wheke Sound on the sliding scale where applicable)
6. − Comps & crew tokens (at stock cost, not till price)
7. − Crew wages — _n_ hours, _n_ people, from rostered shifts and logged tasks, each at the rate of the person on it (since 22 Sep 2026: see the note under the formulas)
8. − Org-wide labour, share of _month_ — apportioned across the events in that month
9. − Artist & promoter floors — _n_ names on the bill
10. − Surplus share out — _n_% of the surplus to their people
11. **Retained by PicklePicklePickle** (rule above; accent if positive, `--st-stop` if negative) — "back into the cost base" / "this one costs us money"

Also on Finance: the **milestone pipeline** (below), the **finance review panel** (below), a **wages run** ("pay all" across everyone unpaid on the event, from hours already logged), **artist payments** (per name, reversible), and **post to Xero** (stub, but the account mapping is real: 1 invoice to 200, wage lines to 477, artist bills to 412).

> **Changed 23 Sep 2026 — two blocks arrive, one from Pipeline and one from Ticketing.** *"This type of financial breakdown isn't helpful on this screen. It would be helpful to see this on the Finance module"* moves "Where the labour goes" here: the same rows — team, bar, hours, planned cost — render under the settlement, loaded through the new `loadLabour` in `src/lib/finance-data.ts`, which is `labourSplit` (unchanged, in `src/lib/pipeline.ts`) fed by `loadPipeline(user)`. It is org-wide, not scoped to the event selected in the queue above it — the same "all events in the pipeline" figure Pipeline showed. And *"the ticketing page is just for setting up the ticket sales"* moves the scenario picker here too: quiet / likely / great, with a "Use this" per case, sits beside the Settlement heading, above the sheet it moves, and writes `Event.scen` through a new `setScenario` in `src/app/(app)/finance/actions.ts` — the same checks the deleted Ticketing action had, gated on the finance module instead: refused for external users, since Finance is never in their module set, the same as every other action in this file. An activity line records the switch, as the Ticketing one did.

### Admin

Role × module **permission matrix** as toggle rows — turning a module off removes it from that role's sidebar on next paint, verifiable by signing in as them. Users table (person, role, access, "you" marker). **"Your people"** — every name is an editable field, and changing it changes that person on every shift, timesheet, run sheet and bar view at once, because there is only one record of a person. Plus a state reset.

> **Changed 23 Sep 2026 — a staff account's phone can be set.** `User.phone` previously only travelled with an external promoter's own details (`setExternalDetails`). A staff row's editor now carries its own phone field, saved with a new `setPhone` action, so the number shown on the Design and Promo lead cards has somewhere to come from. Staff are still named through their Person record, not here.

> **Changed 23 Sep 2026 — the venue spec's components, edited here.** "It'd be better to have a more full-featured option where you can select which components of a venue spec sheet you're sending out, as not all of them are relevant to all people." (Connor). A new "Venue spec" section lists every `VenueSpecComponent`, seeded with Connor's own list — see "Tech production", above. Each one's title and body edit in place, saving together on blur; a toggle takes it out of what Tech offers to send, or puts it back, without losing its wording. Administrator-only, the same as every other row on this page.

### Sign-offs (external promoter portal)

Scoped hard: an external user sees only their own events (`visible()` returns `myEvents()` for external users) and only the `pipeline` + `portal` modules. They see the deal terms with the venue's own model figures, can agree or query (a query records a note the venue sees), and get file requests for the riders. Model-switch and finance-review actions are hidden from them.

> **Changed 23 Sep 2026 — the portal signs the artwork off, piece by piece.** The "N waiting on you" count was already here but nothing behind it wrote a sign-off; it is now true. Per event, the portal lists every piece of the set past draft — its name, its format spec, a link to the artwork (a presigned read, the same as Design's own, scoped to an event this promoter's organisation actually brought) — with Approve and Ask for a change on one still in review, and Reopen on one already signed off. "Ask for a change" asks for their words, which become a comment design sees and an activity line. Each piece carries its own comment thread, and the event carries one general thread, the promoter's side of what `docs/design-handoff/README.md` describes under "Design". A promoter reads and writes only their own organisation's threads — the event itself is out of scope before the query runs, the same way every other row here is.

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
2. **Booking confirmed** — confirmed and held in the calendar (complete at `stage >= 2` — since 16 Sep 2026, once the booking is confirmed); if not yet, the sub-line reads _"not yet — finance signs off here."_
3. **Settlement invoice** — after the door count is in.

The **finance review sits at booking confirmed, step 2.** The venue carries the downside on this model, so nothing is confirmed on a flagged event until the numbers move.

> **Changed 17 Sep 2026: confirming a booking goes through the advice process.** XCHC decides who may confirm a booking through its advice process, not through one finance sign-off. A booking under $1,000 that passes the autonomous checks is confirmed by its coordinator alone. From $1,000 to $3,000 it needs Fast Advice. Over $3,000, or with an Optics Risk, it needs Full Advice, and the finance view is one of that path's reviews. This applies to both booking models. See `advice-process.md`, which replaces the finance review at this step.

Milestone rows render as: state icon (`ph-check-circle` / `ph-circle-dashed`), label, sub-line, and an action button ("Raise it" / "Reverse") where the step is actionable. Done = `--st-good` border and a 7% good-tint background; not done = divider border, transparent.

### Finance review panel

Sits above settlement on both paths. State machine: `pending → approved | flagged`, and `flagged → approved` (via "Clear the flag and approve").

> **Changed 17 Sep 2026.** This review no longer decides whether a booking is confirmed. On both models, that is the advice process in `advice-process.md`. The review stays as the check before a dry hire's 25% deposit invoice.

```
finReview = { state: 'pending'|'approved'|'flagged', note: string, by: userInitials, when: string }
```

Seeded as `approved` (by `SL`, "at confirmation") for events at `stage >= 4` — since 16 Sep 2026, events on sale — or concluded; `pending` otherwise.

Panel contents:

- **State chip** — icon `ph-seal-check` (approved) / `ph-flag` (flagged) / `ph-hourglass-medium` (pending), coloured `--st-good` / `--st-stop` / `--st-warn`. Panel border picks up the status colour when pending or flagged; background is a 6% tint of it.
- **Milestone line** — "before the 25% deposit invoice" or "at booking confirmed, step 2".
- **Projected margin indicator** — computed as `margin = income > 0 ? retained / income : 0`:
  - `retained < 0` → **loss**, `--st-stop`: _"projected to run at a loss of $X"_
  - `margin < 0.08` → **thin**, `--st-warn`: _"thin — N% on $X of income"_
  - otherwise → **healthy**, `--st-good`: _"healthy — N% on $X of income"_
- **Explanatory blurb**, different per model (verbatim copy in the prototype, `finRev.blurb`).
- **Attribution line** — "Approved by _Name_ · _when_" or "Flagged by _Name_ · _when_"; hidden while pending.
- **Flag reason** — shown when flagged and a note exists.
- **Actions** (hidden for external users): a reason textarea, **Approve it** / **Clear the flag and approve**, and **Red-flag it**.

**Red-flagging requires a reason.** Submitting with an empty note does not flag — it raises a warn toast: _"Say what puts it at risk — the coordinator sees your words, not a flag on its own."_ On success the reason is stored on `finReview.note`, pushed to the activity feed as `"red-flagged this event: <reason>"`, surfaced to the coordinator, and the toast reads _"Red-flagged — it sits with the coordinator until the numbers move."_ Approving clears the note and toasts _"Approved — the milestone can go ahead."_ Both actions clear the draft textarea.

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

> **Pay policy, 22 Sep 2026 (Connor).** "Our standard payout for contractors (everyone who is not an employee) is $35. Our standard pay rate for employees is $30/hr." A person is an employee or a contractor (`Person.employment`, set in Admin). Contractors carry no on-costs, so `contractorRate: 35` is both what they are paid and what their hour costs. `loaded` (33.66) is now an employee's cost only. `ourPeople` prices each assigned shift at its person's `hourCost`, and task and labour add-on hours at `PLANNED_HOUR_COST` (35). The blend is worked out once, in `financeInputFor`, so every screen and the settlement agree. `orgCost` plans at 35. See `src/lib/finance.ts` and `src/lib/finance-input.ts`. This has not yet been checked against a real settlement.

Wheke Sound sliding-scale fee: `t = clamp((income - 3000) / 5000, 0, 1); fee = round((300 + 300*t) / 25) * 25`.

Org-wide labour (`ORG_ROLES`: venue administration, grant writing & reporting, bar admin & accounting, maintenance & working bees, marketing org-wide, governance & meetings) is pooled monthly and apportioned across the events in that month.

Once an event is concluded, actuals replace projections: `post = { tickets, ticketRev, barProfit, barTake, total: ticketRev + barProfit }` and the P&L labels change ("Tickets — n through the door", "Bar profit after stock", notes read "Gather.rsvp, reconciled" / "till read less stock cost").

`crewPayout(e)` aggregates every person's hours on the event (rostered + logged), multiplies by `loaded`, and carries a paid flag per person (`e.paid[initials]`). Artist payments are `e.aPaid[i]` against `e.artists[i]`, at their `low` (floor) figure.

---

## Interactions & behaviour

- **Role-based access.** `DEFAULT_PERMS` maps role → module keys; the Admin matrix mutates it live. A module absent from the role's list is absent from the sidebar and unreachable. Roles: `coordinator`, `design`, `tech`, `bar`, `admin`, `promoter` (labelled _"External coordinator · outside the venue"_).
- **External scoping.** `promoter` users see only events whose `promoter` matches their org, and only `pipeline` + `portal`. All venue-side actions are hidden, not merely disabled.
- **Command palette.** `⌘K` / `Ctrl+K` opens a centred 500px overlay (90px from top) searching events, screens and actions; `Esc` closes. Rows: icon, label, right-aligned hint. Empty state: _"Nothing matches that."_
- **Toasts.** Bottom-centre, surface background, `--shadow-lg`, max 460px, auto-dismiss at 3400ms. Three kinds — `good` `ph-check-circle`, `warn` `ph-warning`, `stop` `ph-warning-octagon`. Every mutation raises one, and the copy explains the _consequence_, not the action.
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

Server-side, the pieces that must be real: authentication and role/permission enforcement (server-side, not just hidden UI), event CRUD with the stage-gate rules enforced on transition, an immutable activity log, hours records joining people ↔ shifts ↔ events, and integrations (Gather.rsvp, Facebook Graph, Eventfinda, Eventbrite, EPOS, Xero in/out, Mailchimp, Meta Ads, Slack, Telegram, Discord, Linktree) — the sidebar shows their health, and _Xero bills-in needs re-auth_ is a modelled failure state worth keeping as a real one.

## Assets

No image assets. The brand mark is three inline SVG circles in accent ramp steps (`--color-accent`, `-500`, `-700`) at 19×19 in a 34px rounded accent-900 tile. Icons are the Phosphor web font. There are no photographs in this product.

## Files

- `design/Pickle Prototype.dc.html` — the full platform prototype (all twelve modules, all roles, all logic). Constants (`CFG`, `COV`, `STAGES`, `MODULES`, `ROLE_LABEL`, `DEFAULT_PERMS`, `USERS`, `PEOPLE`, `PRESETS`, `ASSET_SET`, `PLATFORMS`, …) are in the script block near line 3040; `calc()`, `gates()`, `crewPayout()` and `financeVals()` are the functions to port precisely.
- `design/Night Sheet (existing).dc.html` — the venue's existing night-sheet artefact, for context on the workflow being replaced.
- `advice-process.md` — who may confirm a booking, and how (added 17 Sep 2026). Replaces the finance review at confirmation.
- `organisations.md` — how promoter organisations are to work: memberships in several, Owner / Booker / Viewer, joining, inviting, and promoters keeping their acts' details (added 21 Sep 2026). Not built yet.
- `design/support.js` — the prototype's runtime. Reference only; do not port.
- `design/_ds/nocturne-…/styles.css` — the design system's token and component layer. Take colours, type, spacing, radii and shadows from here.
- `design/_ds/nocturne-…/readme.md` — Nocturne's own usage guide.
- `design/_ds/nocturne-…/_ds_bundle.js` — the design system's component bundle (so the prototype opens correctly in a browser).

To view the prototype: open `design/Pickle Prototype.dc.html` in a browser. Sign in as **Sione Latu (Super admin)** to see everything, **Awhina Reid** or **Devon Marsh** to see the external promoter's scoped view.

## Open items

- Margin calculations across both booking models want testing against real historical settlements before launch.
- Red-flag notification delivery to coordinators is in-app only in the prototype; decide on email/Slack.
- Per-space permissions (e.g. a door supervisor who sees tonight's run sheet but not the money) are described in Admin but not implemented.
