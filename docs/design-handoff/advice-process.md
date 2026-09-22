# Confirming a booking: the advice process

Decided with Connor, 17 September 2026. Where this and the design handoff
disagree, this wins. See [What this replaces](#what-this-replaces).

Confirming a booking is the step that matters most on an event: once a booking
is confirmed, its tickets can go on sale. XCHC runs as a Teal organisation, and
who may take that step depends on how big and how risky the night is. The
venue already works this way through an advice process, so Pickle has to follow
that process rather than invent a different one.

Nothing here is built yet. [How it is being built](#how-it-is-being-built) lists
the stages, and [Still to decide](#still-to-decide) lists the questions still
open.

## Who is who

- **Events Circle.** Internal XCHC people who put on events. Some of them hold
  the **Event Coordinator** role.
- **Event Coordinator.** Books events. A coordinator works with external
  Curators, or is the Curator of their own event. The coordinator who books an
  event is its owner in Pickle.
- **Events Circle Link** and **Bar Circle Link.** The people who hold the link
  role for those circles.
- **Finance Circle.** Its members can give the finance view in Full Advice.
- **External Curator.** Someone outside XCHC who brings an event to the venue.
  In Pickle this is an external promoter account, the one that uses the
  Sign-offs portal.

One person can be in more than one circle.

Mind the word. In Pickle, "Curator model" is also the name of a booking model,
the one where the venue shares the risk, as against dry hire. In this document
a Curator is always a person.

## The three paths

Every booking goes down exactly one path. The path is worked out from the
booking's projected figures and its flags, and it applies on both booking
models.

| Path | When | Who must respond before the booking can be confirmed |
| --- | --- | --- |
| Autonomous | Revenue under $1,000, and every autonomous check passes | Nobody. The coordinator confirms it. |
| Fast Advice | Revenue from $1,000 to $3,000, both included | The Events Circle Link, or two other Event Coordinators |
| Full Advice | Revenue over $3,000, or an Optics Risk, or a regularly recurring event | Everyone Fast Advice needs, plus the Bar Circle Link or a Finance Circle member |

**Short notice.** On any path, a booking with less than two weeks' lead-in that
needs bar staff also needs a response from the Bar Circle Link. Lead-in is
counted from the day the booking is confirmed to the night.

**Revenue** means the Night Sheet's total revenue at the Likely attendance:
ticket income without GST, plus bar gross profit. In Pickle this is `income`
from `financeVals` in `src/lib/finance.ts`, worked out for the Likely scenario
whichever scenario the event is set to show. All three thresholds use this one
figure.

### The autonomous checks

A booking under $1,000 can skip advice only if every one of these passes. All
of them read the projection at the Likely attendance.

1. **Revenue.** It is under $1,000.
2. **Running costs.** Take revenue, then take off gear, hire and promotion,
   and drink comps. What is left covers that day's share of the weekly running
   costs. In `financeVals` terms: `income − gear − comps ≥ base`.
3. **Living wage.** What is left after that pays every crew hour at $30 an
   hour. Artists do not have to reach their top fee for this check to pass.
4. **No clash.** No other confirmed event is in the same room at an
   overlapping time. Each event's time in the room includes its setup and its
   packdown (internal) or packout (external). See [Clashes](#clashes).

There are no other Night Sheet checks. The Night Sheet's own calculation code
(`xchc-engine.js`) is not in this repository, so these checks are written
against Pickle's projection, whose lines follow the same shape.

For scale, here is each day's share of the $2,457.37 weekly running costs, from
`COV`:

| Sun | Mon | Tue | Wed | Thu | Fri | Sat |
| --- | --- | --- | --- | --- | --- | --- |
| $147.44 | $98.29 | $122.87 | $122.87 | $245.74 | $982.95 | $1,720.16 |

So a Saturday can never pass check 2 under $1,000, and a Friday almost never
can.

### Other coordinators, and Links on their own events

"Two other Event Coordinators" means two people who hold the coordinator role,
neither of them the event's owner.

The Events Circle Link may review their own event. On Fast or Full Advice,
though, their own event still needs a review from at least one other Event
Coordinator, as well as everything else that path asks for (the Bar Circle Link
on short notice, for example).

### Optics Risk

Any internal person can mark a booking as an Optics Risk: kink or sex-positive
events, for example. The mark sends the booking to Full Advice, whatever its
revenue. Only a Full Advice reviewer can clear the mark.

### Bar service

A booking records its bar service, as one of:

- Alcohol Service
- Non-Alcohol Bar Service
- Cafe Service
- No Bar or Cafe Service Required

Alcohol Service and Non-Alcohol Bar Service need bar staff. Cafe Service is
left alone for now, until the venue knows what the cafe will look like.

## Responses

A reviewer responds with one of **Confirm**, **Changes Requested** or
**Booking Denied**. Changes Requested and Booking Denied must say what the
problem is, specifically. A response without that is refused.

- Booking Denied stops the booking, whoever else has confirmed, until that
  reviewer changes their answer.
- Changes Requested holds the booking until that reviewer changes their answer
  to Confirm.
- The event's coordinator and its external Curators are told about every
  response, both in Pickle and by email. Curators can read the feedback.

## Changes after confirmation: Update Review

An external Curator can change their event after it is confirmed, even once it
is live on promotion and ticketing. The change puts the event into **Update
Review**. Update Review runs the same process again, with the same thresholds for
Autonomous, Fast Advice and Full Advice. Reviewers are shown exactly what
changed, and the review must come from the same people who confirmed the event.

External accounts cannot change an event record today (`canChangeEventRecord`
refuses them), so this is a new permission. Like every other permission, it will
be checked on the server.

## Clashes

A booking gets three new times: **setup**, **packdown** and **packout**.
Internal events use setup and packdown. Events brought by an external Curator
use packout. An event occupies its room from the start of setup until packdown
or packout ends. Two confirmed events clash when those spans overlap in the same
room, on the same date or across midnight.

## Notifications

Every notification is sent both in Pickle and by email.

## Recurring events

Not built yet. When they are, they go to Full Advice.

## What this replaces

In the design handoff, the finance review sat at "booking confirmed, step 2" on
the curator model and before the 25% deposit on dry hire. It was pending,
approved or red-flagged, by anyone who could open Finance. (See "Curator model
milestones" and "Finance review panel" in `README.md`.) At confirmation, the
advice process replaces it on both booking models, and the finance view becomes
one of the Full Advice reviews. The finance review stays only as the check
before a dry hire's 25% deposit invoice.

Nothing in Pickle had ever connected the finance review to confirming a booking:
`advanceBooking` never read it, and Finance only lists bookings that are already
confirmed. A narrower fix, a gate that would stop a red-flagged curator booking
being confirmed, was dropped in favour of this.

## Still to decide

**The checks**

- Where a booking under $1,000 goes when check 2, 3 or 4 fails.
- Which crew hours check 3 counts. Before an event has shifts, Pickle's
  standard roster (`callFor` in `src/lib/roster.ts`) plans 24.5–27 hours for a
  workshop, 32–37 for a DJ night and 36–42 for live music. At $30 an hour even
  the smallest DJ night's crew ($960) costs more than a night under $1,000 has
  left after its day's share. Only small workshops, Sunday to Thursday, could
  ever be autonomous.
- ~~Whether $30 an hour includes the 12.2% on-costs.~~ Answered 22 Sep 2026:
  $30 is an employee's base pay, before on-costs, and costs the venue $33.66.
  Contractors, who are everyone else, are paid $35 flat. Pickle now costs each
  hour by who works it and plans unassigned hours at $35, so check 3's crew
  figures above run about a sixth higher than the $30 they assume.

**Update Review**

- Which changes trigger it.
- Whether the internal coordinator's own changes trigger it too.
- What stays live while it runs.
- What a Booking Denied on an update does.
- Who reviews an update that moves the event to a bigger path, or one first
  confirmed autonomously, or one whose original reviewer has left.
- Whether changes made before confirmation, after someone has responded, need
  that person to review them again.

**Who reviews**

- Whether one person can meet two requirements at once.
- Whether the Events Circle Link rule applies in the same way to the Bar
  Circle Link and to Finance Circle members.
- Who exactly counts as a Full Advice reviewer for clearing an Optics Risk.
- Who presses Confirm once advice is complete, or whether the last Confirm
  confirms the booking by itself.

**Clashes**

- Whether setup, packdown and packout are durations or clock times, and
  whether external events have setup time as well.
- Room holds allow one confirmed booking per room per night (the
  `Hold_one_confirmed_per_night` index). With time spans, a day workshop and a
  night gig could share a room on the same date. Whether holds move to time
  spans too.
- What check 4 does for a booking whose run times are not set yet.

**Bar service**

- What existing events are set to.
- How the bar-close gates and the late-bar licence check treat each option.
- Whether the standard roster drops bar staff when there is no bar.

**Notifications**

- Which moments send one, and to whom.

## How it is being built

Tests first at every stage, as CLAUDE.md asks of anything that touches money
or permissions.

1. **The rules.** This document, plus a pure rules module: which path applies,
   the autonomous checks, who has to respond, and whether the responses so far
   allow confirming. No schema changes.
2. **The data.** Circle and Link membership; bar service; setup, packdown and
   packout; the Optics Risk mark; advice requests and responses. Migrated on a
   throwaway database first.
3. **The event record.** Requesting advice and responding to it, and a booking
   gate that makes Confirm refuse until advice is complete. Reviewers get their
   reviews under Home's "Needs you".
4. **Notifications**, in Pickle and by email.
5. **Update Review.**

Recurring events and Cafe Service come after that.
