# Where we stand against the market

**Written 8 September 2026.** A gap analysis of PicklePicklePickle against the
two leading live-music venue platforms, plus the leading venue-hire platform for
the dry-hire side of the business. Every claim about our own code below was
checked against the tree at `e5b5a89`, not inferred from the handoff.

This is guidance, not a backlog handed down. Where a gap is a deliberate scope
choice rather than an oversight, it says so.

---

## Who we benchmarked against, and why

**[Prism.fm](https://prism.fm/why-prism-for-venues-and-promoters/)** and
**[Opendate](https://opendate.io/)** are the two market leaders in live-music
venue management — the closest comparators to what XCHC actually does, and the
systems a touring agent dealing with us will already know.

**[Tripleseat](https://www.tripleseat.com/features/)** leads the broader
venue-hire market (hospitality, private hire, corporate). It is the right
comparator for `BookingModel.DRY` — the dry-hire half of our business, which the
live-music pair barely address.

We also looked at Momentus, Skedda and Stage Portal. Momentus and Skedda are
enterprise/room-booking tools with little to say about artist settlement;
Stage Portal is the nearest philosophical neighbour (grassroots-first, advancing
and crew in one system) but is UK-specific and too young to benchmark against.

### What they do that we structurally cannot

| Capability                                    | Prism | Opendate | Tripleseat | Us                              |
| --------------------------------------------- | ----- | -------- | ---------- | ------------------------------- |
| Holds / avails ladder with conflict detection | ✅    | ✅       | ✅         | ❌ no availability model at all |
| Deal structures (guarantee, door, versus)     | ✅    | ✅       | n/a        | ❌ one `split` float            |
| Artist advancing workflow                     | ✅    | ✅       | n/a        | ❌ three time strings           |
| Settlement sheet, rendered and signed         | ✅    | ✅       | ✅         | ❌ computed, never displayed    |
| Ticket sales over time / forecast vs actual   | ✅    | ✅       | n/a        | ❌ one hand-typed integer       |
| Inbound enquiry capture                       | ✅    | ✅       | ✅         | ❌ no public form               |
| Contracts + e-signature + deposits            | ✅    | ✅       | ✅         | ❌ a three-state enum           |
| Guest list / comps as records                 | ✅    | ✅       | ✅         | ❌ two integers                 |
| Fan CRM, email/SMS marketing                  | ➖    | ✅       | ✅         | ❌ deliberate — see "Not ours"  |

### What we do that neither of them does

Worth stating plainly, because it is the reason this project exists rather than
a subscription to Prism:

- **One record of an hour.** Roster ↔ Hours is two-way and enforced in a
  transaction: assigning a shift writes the `HourEntry`. Prism tracks
  settlement; it does not cost your labour. Neither platform can tell you what a
  Tuesday actually cost in wages.
- **Loaded-rate wage costing into the P&L.** `CFG.loaded` (33.66) is applied to
  every hour, rostered or typed, and lands as line 7 of the settlement.
- **Cost-base share by day of week.** `COV` in `src/lib/finance.ts` — a Saturday
  carries 70% of the weekly base, a Monday 4%. No competitor models this;
  they show you gross margin per show and leave the fixed base to your
  accountant.
- **Stage gates with named, deep-linked conditions.** An event cannot advance
  while a gate fails, and the gate tells you which screen fixes it. Prism has
  status fields and task lists; it has nothing that refuses.

Keep these. They are the differentiator, and none of what follows should be
built in a way that weakens them.

---

## P0 — The pipeline cannot currently finish

These are not gaps against the market. They are things that are broken now.

### PG-1 — An event can never reach Payout

> As a coordinator, I want to close out a show that has happened, so that it
> stops sitting in Show week forever.

**This is the highest-priority item in this document.** The stage 6 → 7 gate
(`Show week` → `Payout`) requires `hasActual`, which reads
`db.actual.count(...)` at
[event-record-data.ts:366](../src/lib/event-record-data.ts:366). No application
code path creates an `Actual` row — there is no `actual.create`,
`actual.upsert` or `actual.update` anywhere in `src/`.

**Corrected 9 September 2026.** `prisma/seed.ts` _does_ write `Actual` rows, for
two concluded events. So the two seeded demo nights can pass this gate, and an
earlier draft of this document overstated the fault by saying nothing anywhere
creates one. The consequence for real work is unchanged: an event created and
run through the product can never acquire actuals, so it can never pass the gate
and will pile up at stage 6 forever. This is the same failure PR #7 found in the
roster — the seed producing data the product itself cannot produce.

The gate also deep-links to `'bar'`
([event-record.ts:388](../src/lib/event-record.ts:388)) — a module that is not
in `BUILT_MODULES`, so the one affordance offered to fix the problem is a dead
link.

**Acceptance criteria**

- A coordinator can enter final ticket count, ticket revenue, bar take and bar
  profit against a concluded event, and an `Actual` row is written.
- The gate passes once that row exists, and the event advances to Payout.
- The entry writes to `Activity` naming who reconciled it.
- A test asserts the stage 6 → 7 transition succeeds after actuals are entered
  and fails before — the gate is currently untestable end to end.
- The deep link points at a screen that exists.

**Note:** the smallest honest fix is an actuals panel on the event record, not
the whole Bar module. Do that first; PG-14 can follow.

### PG-2 — The settlement P&L is computed but never shown

> As a coordinator, I want to see the eleven-line settlement for an event, so
> that I can tell whether the night made money and explain why.

`financeVals()` in `src/lib/finance.ts` returns all 21 figures the handoff's
P&L needs — `income`, `base`, `wheke`, `comps`, `ourPeople`, `orgCost`,
`floor`, `surplus`, `theirShare`, `ours`. The handoff calls Finance "the most
specified screen" and gives the eleven lines verbatim. **None of it is rendered
anywhere.** `/finance` is 185 lines and shows payee bank accounts only.

**Corrected 9 September 2026.** An earlier draft said `marginHealth()` was
called by nothing. It is: `event-record-data.ts:371` computes it and the event
record renders it as the margin indicator. What is missing is the _finance
review panel_ the handoff specifies around it (PG-3), not the function.

**Acceptance criteria**

- The eleven lines render in the handoff's order, with the rules above income
  and retained, and the specified colour treatment on the retained line.
- The GST collected-and-held figure appears in the income line's note, as
  specified — this is the only place GST is surfaced to a human.
- The scenario switch (quiet/likely/great) changes the projection in place.
- A concluded event reads off `Actual` instead of the projection.
- External promoters see the model figures the handoff grants them and nothing
  more.

### PG-3 — Finance review and the milestone pipeline do not exist

> As an admin, I want to red-flag an event whose numbers do not work, so that
> the deposit invoice does not go out while it is losing money.

`FinanceReview` is in the schema with `state`, `note`, `by`, `when`.

**Corrected 9 September 2026.** An earlier draft said it was read and written by
nothing outside the generated Prisma client. `prisma/seed.ts` writes one for
every event — APPROVED at `stage >= 4` or concluded, PENDING otherwise, exactly
as the handoff describes. The accurate claim is narrower: nothing _reads_ them
and no _application_ code writes them, so the rows exist and govern nothing.
This is the third such overstatement found by building against the code rather
than reading it; the other two are noted under PG-1 and PG-2.

The dry-hire and
curator milestone ladders, the state machine
(`pending → approved | flagged`, `flagged → approved`), the projected-margin
indicator and the "red-flagging requires a reason" rule are all specified in the
handoff and entirely absent.

**Acceptance criteria**

- The review panel sits before the deposit invoice on dry hire, and at booking
  confirmed on curator, per the handoff.
- Red-flagging with an empty note does not flag; it raises the specified warn
  toast.
- Flagging writes `"red-flagged this event: <reason>"` to `Activity` and holds
  the milestone.
- `marginHealth()` drives the loss/thin/healthy indicator — do not reimplement
  the thresholds.
- Actions are hidden from external users.

---

## P1 — Structural gaps against the market

### PG-4 — There is no hold, and nothing stops a double booking

> As a coordinator, I want to pencil a date without confirming it, and be told
> when someone else wants the same room, so that two shows never land in one
> space.

This is the largest structural gap in the product. `Space` has `name` and
`capacity` and nothing else. An `Event` has one `date` and one `spaceId`. **No
code anywhere checks whether another event already occupies that room that
night.** Two coordinators can book the Main Room twice on a Saturday and the
system will show both, cheerfully, on the pipeline.

Every comparator treats this as the primitive the business runs on. Prism sells
shared avails, shared holds, hold prioritisation and automated conflict
detection as its headline. Opendate leads with "place holds and confirm shows".
An enquiry at stage 0 is not a hold — it carries no priority, no expiry, and no
exclusivity.

**Acceptance criteria**

- A date + space can carry ranked holds (1st, 2nd, 3rd) belonging to different
  enquiries.
- Confirming an event releases the lower holds and notifies their owners.
- A hold has an expiry, and expired holds stop blocking.
- Attempting to confirm into an occupied slot is refused server-side with the
  conflicting event named — not hidden in the view.
- A "challenge" moves a 2nd hold to 1st and gives the incumbent a deadline.
- Multi-day and multi-space bookings are expressible (a festival takes both
  rooms for three days).

**Design note:** this changes the `Event ↔ Space` relation from a scalar to a
booking record. Do it before the calendar grows any more screens that assume one
date per event. The `dateTbc` flag becomes redundant once a hold has its own
state.

### PG-5 — We cannot express the deals we actually do

> As a coordinator, I want to record "the greater of $500 or 70% of the net
> door", so that the settlement computes what we actually agreed.

We have `Event.split` (a share of surplus, 0–1) and `EventArtist.low`/`high` (a
fee floor and ceiling). Between them they express _one_ deal shape: a negotiated
fee inside a range, plus a surplus share.

The industry standard shapes, none of which we can represent:

| Shape            | Formula                               | Can we?                              |
| ---------------- | ------------------------------------- | ------------------------------------ |
| Flat guarantee   | `payout = guarantee`                  | ➖ via `low = high`                  |
| Door deal        | `payout = NBOR × pct`                 | ➖ approximated by `split`           |
| **Versus deal**  | `payout = MAX(guarantee, NBOR × pct)` | ❌                                   |
| Promoter profit  | margin taken before the split         | ❌                                   |
| Four-wall rental | flat rent + itemised extras           | ➖ `BookingModel.DRY`, no line items |

The versus deal is the most common structure for exactly our tier of act, and
`MAX()` is not expressible in the current model at all. `BookingModel` being a
two-value enum (`DRY | CURATOR`) is a reasonable simplification of the venue's
own two ways of working — but it is a _business model_, not a _deal term_, and
the two are currently conflated.

**Acceptance criteria**

- A deal is a record with a type, a guarantee, a percentage, and a definition of
  what the percentage applies to.
- `financeVals()` computes artist payout from the deal type. **Per CLAUDE.md
  this is a change to the finance specification: write the test first, and
  record the decision against a real settlement.**
- The settlement shows the comparison on a versus deal ("guarantee $500 vs 70%
  of $1,240 net = $868 — paid on the percentage").
- Existing events migrate to `FLAT` or `SPLIT` with no change to any figure they
  currently show. Prove it with a before/after over the seed.

### PG-6 — There is no advancing workflow, and no night sheet

> As a tech lead, I want the load-in, soundcheck and set times agreed with the
> tour manager in the record, so that the night runs off one sheet.

We hold three strings on the event: `doors`, `barClose`, `allOut`. That is the
entire schedule. Advancing — the structured conversation with the tour manager
that both Prism and Opendate give a dedicated tab — covers load-in per act,
soundcheck slots and durations, set times and lengths, changeovers, curfew,
stage plot confirmation, power and rigging, hospitality and dressing rooms,
parking and loading dock access, and credential counts.

We have riders as files (`RIDER_HOSPITALITY`, `RIDER_TECH`, `STAGE_PLOT`) with
nowhere to say they have been _read and agreed_, and no advance status.

Note that `docs/design-handoff/design/Night Sheet (existing).dc.html` is the
artefact this product is meant to replace, and we have not built its
replacement. The run sheet is what the door team, the sound lead and the duty
manager actually work off on the night.

**Acceptance criteria**

- Per-act schedule rows (load-in, soundcheck, set start, set length).
- An advance has a state — not started / sent / returned / agreed — and gates
  entry to Show week.
- A printable/exportable night sheet renders from the record for the door, bar
  and sound leads.
- The existing `doors`/`barClose`/`allOut` strings remain the source for the
  licence gate. **Do not convert them to `DateTime`** — the comment at
  [schema.prisma:270](../prisma/schema.prisma:270) explains why, and it is
  right.

### PG-7 — Ticket sales are a single hand-typed integer

> As a coordinator, I want to see how a show is selling week by week, so that I
> can add promotion before it is too late rather than after.

`Event.sold` is one `Int`, typed by a human, with an activity line naming who
typed it. That was a defensible call while Gather.rsvp is unconnected (PR #8
says as much). But it forecloses:

- the **sales curve** the handoff specifies on Ticketing
- forecast vs actual, which is a headline feature of both comparators
- mid-sale forecasting and demand prediction
- any alert that a show is tracking below breakeven while there is still time

There is also no **on-sale date** and no **announce date** in the schema, so
even the x-axis of that curve does not exist.

**Acceptance criteria**

- A `TicketCount` time series (event, timestamp, sold, source) — hand-entered
  counts and API counts both land in it, distinguishable.
- `Event.onSaleAt` and `Event.announcedAt`.
- The Ticketing room diagram gains the curve, with breakeven and full-pay as
  horizontal marks (`breakeven` and `fullPay` already come out of
  `financeVals()`).
- An event whose curve projects below breakeven inside 14 days of doors raises
  a risk on the pipeline, using the existing `riskNote`/`riskKind`.

### PG-8 — Capacity has two sources of truth, and the live one is hard-coded

> As an admin, I want to add a room or change a capacity without a developer.

`Space.capacity` is a column in the database. **It is never read.** Every
capacity in the product comes from `capacityOf()` at
[ticketing.ts:42](../src/lib/ticketing.ts:42), which matches on the literal
string `'Apartment U1'` and otherwise returns `CFG.capMusic` or `CFG.capSeated`.

The function's own comment says it exists so there are not "two copies that
drift" — and it is right that Ticketing and Roster should share one rule. But
the rule it centralises reads from constants rather than from the row, so
there are two copies anyway, and the one the venue can edit is the dead one.

This contradicts the product's central claim directly: capacity is a fact about
a room, and the room is a record.

**Acceptance criteria**

- `capacityOf()` resolves from `Space`, keeping one shared rule.
- Seated/cabaret capacity becomes a property of the space (a second column, or a
  format→capacity map on the row), not a branch on `format` in code.
- Adding a space in Admin is sufficient to book and price it.
- `CFG.capMusic`/`capSeated`/`capApt` are removed, or reduced to seed values.
- Existing figures are unchanged: assert the seed's three spaces produce
  220 / 150 / 40 as they do today.

---

## P2 — Specified but not built

### PG-9 — Inbound enquiries have no front door

> As a promoter outside the venue, I want to send XCHC an enquiry without
> knowing who to email.

Tripleseat's headline is an inquiry inbox; Opendate lists inbound inquiries as
core. PR #2 noted that "New enquiry" explains inline that an enquiry starts as
the public event sheet, and that no public form exists. It still does not.
Every event in the system begins with a staff member typing.

**Acceptance criteria**

- An unauthenticated form creates an event at stage 0 with `dateTbc`.
- It is rate-limited and spam-resistant. Reuse the throttle from
  `src/lib/auth.ts` rather than writing a second one.
- Submissions land in a queue an owner claims, and claiming writes to Activity.
- No submitted field is trusted into a figure that reaches the P&L without a
  coordinator confirming it.

### PG-10 — Contracts are a three-state enum

> As a coordinator, I want the promoter to sign something, so that a disputed
> booking has a document behind it.

`DealState` is `SENT | AGREED | QUERIED` plus a free-text `dealNote`. The portal
lets a promoter agree or query. There is no document, no version, no signature,
no deposit schedule, no cancellation terms, and — for external promoters
bringing the public into our building — no insurance certificate.

The industry norm is 50% of the guarantee on signing with the balance at
settlement, plus a kill fee if the venue cancels. Our dry-hire milestone ladder
already assumes a 25% deposit invoice exists; nothing issues it.

**Acceptance criteria**

- A generated agreement, versioned, with the deal terms rendered from the
  record rather than retyped.
- Promoter agreement in the portal is captured as a signature event — who, when,
  from where — and is immutable afterwards.
- A deposit milestone that can be raised and reversed, feeding the dry-hire
  ladder in PG-3.
- Certificate-of-insurance upload for external promoters, using the existing
  `StoredFile` machinery and a new `FileKind`.

### PG-11 — Guest list and comps are two integers

> As a door supervisor, I want tonight's guest list on a screen, so that I am
> not working off a group chat.

`Event.crew` and `Event.tok` are counts feeding the comps P&L line at stock
cost. Correct for the arithmetic, useless on the door. There is no list of
names, no per-act allocation, no cutoff, no check-in, and therefore no way for
the comps line to be checked against what actually happened.

**Acceptance criteria**

- Guest list entries belong to an event and optionally to an act.
- Per-act allocation with a cap, and a cutoff (industry norm 48–72h before).
- Door check-in marks arrivals; the comps line reconciles against arrivals, not
  the allocation.
- Acts submit their own list through the existing `AccessGrant` token flow —
  they should not need an account, exactly as with payment details.

### PG-12 — Merch is entirely absent

> As a coordinator, I want merch recorded, so the settlement is complete and the
> act knows our terms before they arrive.

No model, no field, no line. Merch is a settlement line at every venue and a
live political issue in grassroots music — Music Venue Trust's campaigning has
made 0% venue commission close to standard, which is very likely XCHC's
position. **That is an argument for stating it explicitly in the deal, not for
omitting it.**

**Acceptance criteria**

- Merch terms on the deal (commission %, default 0, and who sells).
- Reported merch gross on the settlement, even at 0% commission, so the act's
  night is recorded whole.
- Advancing (PG-6) states the terms before the act travels.

### PG-13 — Home is not built

> As anyone, I want to know what needs me today.

Specified in the handoff (metric strip, "Needs you" queue, "Next through the
door", "Your hours this month"). `home` is in `MODULES` and in every role's
`DEFAULT_PERMS`, but absent from `BUILT_MODULES`. Every input it needs already
exists — failing gates, unassigned shifts, pending reviews, unlogged hours.

This is the cheapest high-value screen left: it is aggregation over data we
already hold, with no new schema.

### PG-14 — Bar is not built

> As a duty manager, I want to know whether tonight beat the model.

Specified in the handoff (live take, spend per head against `barHead`, margin by
product, stock cost at 40.2%, "Against the model" panel). Prism specifically
tracks bar sales per attendee as a competitive metric.

`CFG.barMargin` (0.598) and `CFG.stockCost` (0.402) already drive the P&L off an
_assumed_ `barHead`. Nothing anywhere checks that assumption against a real
till. Combined with PG-1, this is how the actuals get in.

---

## Corrections to what already exists

Carried forward from the PR review, all re-verified in the tree today.

### PG-15 — Pipeline and Ticketing can price the same event differently

[pipeline-data.ts:68](../src/lib/pipeline-data.ts:68) casts `e.mix` raw and
assembles its own finance input inline; Ticketing and the event record both go
through `financeInputFor()`, which normalises the mix.
[finance-input.ts](../src/lib/finance-input.ts) documents the divergence in its
own header. Two screens, one event, two projected surpluses — the precise thing
the product exists to prevent. Flagged in PR #10 and deliberately deferred
because it moves money on a shipped screen; it needs a test and a recorded
decision, not a quiet fix.

### PG-16 — A tile's label and its arithmetic disagree

"Labour booked to events this month" at
[pipeline.ts:212](../src/lib/pipeline.ts:212) sums all live events with no month
filter. Faithful to the prototype, flagged since PR #2. Product decision: change
the copy, or filter to the month.

### PG-17 — Two Pipeline tiles are hard-coded

[pipeline.ts:194-209](../src/lib/pipeline.ts:194) — "11 days" and "9 days",
honestly marked `placeholder: true`. They need stage-transition history. Since
`stageEnteredAt` already exists, recording transitions to an append-only table
would make both real and cost little. **Note the interaction with PG-4:** a
holds ladder gives you the enquiry→confirm interval for free.

### PG-18 — External promoters see our cost-base coverage

`<MetricStrip>` at
[pipeline/page.tsx:193](<../src/app/(app)/pipeline/page.tsx:193>) renders
unconditionally, so an outside promoter reads _"7 of 18 — covers 39% of the
base"_. Faithful to the prototype, and the handoff does grant promoters the
venue's model figures — but this is XCHC's viability, not a deal projection, and
it is the one item here that reaches a third party. Decide it before the next
promoter account is issued.

### PG-19 — A dead substring match survives on the display path

[pipeline-data.ts:94](../src/lib/pipeline-data.ts:94) still does
`(e.promoter ?? '').includes(u.promoter)` to pick the external coordinator's
avatar. It is display-only and cannot leak an event — PR #10 moved access
scoping onto `promoterId` — but it is the same shape as the bug that was fixed,
and it is the last reason `User.promoter` still exists. PR #10 said that column
would be dropped after one release. Drop it and this together.

---

## Not ours, deliberately

State these so nobody builds them by accident:

- **Fan CRM, email and SMS marketing, audience segmentation.** Opendate's core;
  a whole product. Gather.rsvp is our source of truth for ticket buyers and the
  handoff says so.
- **Consumer ticketing, box office and reserved seating.** We model tiers and
  price; we do not sell. Eventbrite inventory is capped precisely so it cannot
  oversell.
- **Floor plans and 3D diagramming.** Tripleseat's differentiator, irrelevant to
  a music room.
- **Multi-venue and agency tooling.** Prism's agency platform assumes a roster of
  venues. We are single-tenant, and CLAUDE.md is explicit about that.
- **Artist discovery / demand data.** Requires an industry-wide dataset we have
  no route to.

---

## Suggested sequence

**First — make the loop close.** PG-1, PG-2, PG-3. Until an event can settle,
the product does not do the thing its own README says it does, and no amount of
new surface changes that. All three are mostly rendering over logic that is
already written and tested.

**Then — fix the structural model while it is still cheap.** PG-4 (holds) and
PG-5 (deals) both change the shape of core records. Every screen built before
them will need revisiting after; every screen built after them comes out right.
PG-8 (capacity) belongs here too — it is small, and it removes a hard-coded room
name from the pricing path.

**Then — the night itself.** PG-6 (advancing and the night sheet), PG-11 (guest
list), PG-14 (Bar). This is the cluster that replaces the group chat, which is
the workflow XCHC is actually trying to get rid of.

**Alongside, cheaply — PG-13 (Home)** needs no schema and makes the whole thing
feel finished.

**Corrections** are small and independent. PG-15 and PG-18 are the two with real
consequences; the rest can ride along.

One process note: PG-5 changes `src/lib/finance.ts`, which CLAUDE.md designates
as specification ported line-for-line from the handoff. That change needs a test
written first and a decision recorded against a real settlement — not a tidy-up.
The handoff's own open items say the same thing: _"margin calculations across
both booking models want testing against real historical settlements before
launch."_ That reconciliation has still not happened, and it should happen
before the deal model is extended, not after.

---

## Sources

- [Prism.fm — for venues and promoters](https://prism.fm/why-prism-for-venues-and-promoters/)
- [Prism.fm — the complete guide to talent buying software](https://prism.fm/blog/music-management-software/the-complete-guide-to-talent-buying-software/)
- [Opendate](https://opendate.io/)
- [Tripleseat — features](https://www.tripleseat.com/features/)
- [Ticket Fairy — booking contracts and settlements for venues in 2026](https://www.ticketfairy.com/blog/deal-or-no-deal-navigating-booking-contracts-settlements-for-venues-in-2026)
- [Stage Portal — building an artist advance process](https://stageportal.gg/blog/artist-advance-process-grassroots-music-venue/)
- [Stage Portal — venue management software for independent venues](https://stageportal.gg/blog/best-venue-management-software-independent-music-venues/)
- [Ari's Take — how to properly advance your shows](https://aristake.com/how-to-properly-advance-your-shows-and-why-you-have-to/)
- [Tour Manager — show settlement guide](https://tourmanager.info/show-settlement/)
