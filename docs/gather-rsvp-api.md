# What Pickle needs from a Gather.rsvp API

A brief for the Gather.rsvp team, from XCHC in Ōtautahi Christchurch.

XCHC runs its events off an internal tool called Pickle. Every department works
off one record of each event: the booking, the artwork, the promotion, the
tickets, the roster and the settlement. Gather.rsvp is where XCHC sells
tickets, and Pickle treats Gather as **the source of truth for everything to do
with tickets**: what is on sale, how many have sold, who is on the door list,
who has come through the door, and what the tickets took.

Today a coordinator types the sold count into Pickle by hand and pulls the door
list out of Gather's admin. This document says what an API would need to do for
that to stop. It is written as a set of needs and a suggested shape, not a
finished contract. Where you already have a different shape that meets the
need, use yours.

There is a formatted copy of this at
<https://claude.ai/artifact/Rwiw6x6Gvtm8EUWHTNz5Xb>, for sending to Gather.
**This file is canonical**; if the two disagree, this one wins.

Contents:

1. [The four jobs](#1-the-four-jobs)
2. [Ground rules that make it fit](#2-ground-rules-that-make-it-fit)
3. [Reading sales](#3-reading-sales)
4. [Pushing a listing live](#4-pushing-a-listing-live)
5. [Codes and comps](#5-codes-and-comps)
6. [The door](#6-the-door)
7. [Settlement figures](#7-settlement-figures)
8. [Webhooks](#8-webhooks)
9. [Auth, environments and limits](#9-auth-environments-and-limits)
10. [What we do not need](#10-what-we-do-not-need)
11. [Questions for you](#11-questions-for-you)
12. [Priority order](#12-priority-order)
13. [Appendix: how this maps onto Pickle](#appendix-how-this-maps-onto-pickle)

---

## 1. The four jobs

In the order XCHC would use them:

| Job                         | Direction       | When                                             | Need   |
| --------------------------- | --------------- | ------------------------------------------------ | ------ |
| **Read sales**              | Gather → Pickle | Continuously while a show is on sale             | Must   |
| **Push a listing live**     | Pickle → Gather | Once, when the coordinator puts the show on sale | Must   |
| **Door list and check-ins** | Both ways       | Show night                                       | Must   |
| **Settlement figures**      | Gather → Pickle | Once, after the show                             | Must   |
| Discount codes and comps    | Pickle → Gather | With the listing, and whenever they change       | Should |
| Attribution (what sold it)  | Gather → Pickle | With every order                                 | Nice   |

"Read sales" on its own would replace the hand-typed count and is the single
most valuable thing. Everything else can follow.

## 2. Ground rules that make it fit

These are what Pickle needs from the API's _shape_, whatever the endpoints are
called.

- **Every figure must be reproducible from the list of orders.** Pickle's
  central claim is that every number on a screen resolves back to a record.
  A summary endpoint that says "312 sold" is fine, but the orders list for that
  event must add up to 312. If the two can disagree, Pickle has to read the
  orders and add them up itself.
- **Timestamps on everything, in ISO 8601 with an offset.** Pickle draws a
  sales curve, so it needs when each order was placed, not just that it was.
  `2026-10-03T19:42:11+13:00` or `...Z` are both fine. XCHC is in
  `Pacific/Auckland`, and the venue thinks in local time.
- **Stable IDs.** Events, ticket types, orders, tickets, codes and check-ins
  each need an ID that never changes or gets reused. Pickle stores them.
- **An external reference on events.** When Pickle creates a Gather event it
  will send its own event ID. Please store it and let us look an event up by
  it. This is what makes a retry safe: create with the same external ID twice
  and you get the same Gather event back, not two.
- **Idempotent writes.** Any create or update Pickle sends may be sent again
  after a timeout. An `Idempotency-Key` header, or the external reference
  above, either works.
- **Money as a decimal string in NZD, with GST stated.** `"25.00"`, not `25`
  or `2500`. New Zealand GST is 15%. For every money figure say whether it is
  GST inclusive (what the buyer paid) and whether Gather's fee is inside it.
  Pickle's settlement divides by 1.15 exactly once, so it needs to know what it
  is dividing.
- **Cursor pagination on every list.** Page size of your choosing; a `next`
  cursor or URL on every page; a stable order (oldest first is easiest for
  incremental sync). Filtering by `updated_since` on orders and tickets would
  let Pickle poll cheaply.
- **JSON errors it can show a person.** A status code, a short machine code
  and a sentence. Pickle puts API errors in front of a coordinator, so
  `{"code":"event_not_found","message":"No event with id evt_9k2 in this
organiser account"}` beats a bare 404.
- **A test organiser account** we can hit without selling a real ticket. See
  section 9.

## 3. Reading sales

This is the one that matters most.

### 3.1 Event summary

For one event: how many have sold and what they took, broken down by ticket
type. Pickle reads this on every page load of its Ticketing screen, and every
few minutes in the background for every show on sale.

```
GET /events/{event_id}
```

```json
{
  "id": "evt_9k2",
  "external_id": "cmf3x1abc",
  "name": "Half Hexagon + guests",
  "url": "https://gather.rsvp/half-hexagon",
  "starts_at": "2026-10-03T20:00:00+13:00",
  "ends_at": "2026-10-04T01:00:00+13:00",
  "timezone": "Pacific/Auckland",
  "status": "on_sale",
  "capacity": 200,
  "sold": 118,
  "checked_in": 0,
  "gross": { "amount": "3230.00", "currency": "NZD", "gst_inclusive": true, "includes_fees": true },
  "net_to_organiser": { "amount": "3068.50", "currency": "NZD", "gst_inclusive": true },
  "ticket_types": [
    {
      "id": "tt_1",
      "name": "Subsidised",
      "external_key": "sub",
      "price": "20.00",
      "capacity": null,
      "sold": 21
    },
    {
      "id": "tt_2",
      "name": "Standard",
      "external_key": "std",
      "price": "25.00",
      "capacity": null,
      "sold": 71
    },
    {
      "id": "tt_3",
      "name": "Supporter",
      "external_key": "sup",
      "price": "30.00",
      "capacity": null,
      "sold": 26
    }
  ],
  "updated_at": "2026-09-17T10:12:40+12:00"
}
```

Notes:

- `sold` counts **paid tickets** only. Comps and holds are not sales; see
  section 5. Refunded tickets come off `sold`.
- `status` values Pickle would act on: `draft`, `on_sale`, `sold_out`,
  `sales_closed`, `cancelled`. If yours differ, list them.
- `external_key` is whatever Pickle sent when it created the ticket type, so
  it can match Gather's tiers to its own without matching on names.
- One `capacity` for the event is what XCHC needs. Per ticket type is
  optional.

### 3.2 Orders

Every order on an event, with when it was placed. This is what draws the sales
curve, and what section 2 says the summary must agree with.

```
GET /events/{event_id}/orders?updated_since=2026-09-16T00:00:00Z&cursor=...
```

```json
{
  "data": [
    {
      "id": "ord_88a1",
      "event_id": "evt_9k2",
      "placed_at": "2026-09-16T21:04:19+12:00",
      "status": "paid",
      "buyer": { "name": "Ari Tāne" },
      "discount_code": "LOCALS",
      "source": { "referrer": "instagram", "utm_campaign": "cut-1" },
      "lines": [
        { "ticket_type_id": "tt_2", "quantity": 2, "unit_price": "25.00", "discount_each": "2.50" }
      ],
      "total": {
        "amount": "45.00",
        "currency": "NZD",
        "gst_inclusive": true,
        "includes_fees": true
      },
      "refunded_at": null,
      "updated_at": "2026-09-16T21:04:19+12:00"
    }
  ],
  "next": "/events/evt_9k2/orders?cursor=eyJ..."
}
```

Notes:

- `status`: at least `paid`, `refunded`, `cancelled`. A partial refund is fine
  as a second order status or a `refunded_quantity` per line; say which.
- **Buyer name is all Pickle needs** for the door list. Email and phone are
  not needed and Pickle would rather not receive them. See section 10.
- `discount_code` and `discount_each` let Pickle show what a code cost, as its
  own line, rather than letting it disappear into an average ticket price.
- `source` is the nice-to-have from section 1. If a buyer arrived through a
  link Pickle generated (`?ref=telegram` or UTM parameters on the event URL),
  echo it back on the order. That is all "attribution" means here.

### 3.3 Everything on sale

One list of the organiser's events with the summary fields, so a nightly job
can sync every show in one call rather than one per show.

```
GET /events?status=on_sale&cursor=...
```

## 4. Pushing a listing live

When a coordinator presses **Push it live** in Pickle, Pickle creates the
Gather event and its ticket types in one go and stores the IDs that come back.
From then on, if the ticket price or the times change in Pickle, Pickle sends
an update. Nothing about the listing is ever typed into Gather's admin.

```
POST /events
```

```json
{
  "external_id": "cmf3x1abc",
  "name": "Half Hexagon + guests",
  "description": "Listing copy, plain text or limited markdown, up to N characters",
  "starts_at": "2026-10-03T20:00:00+13:00",
  "ends_at": "2026-10-04T01:00:00+13:00",
  "timezone": "Pacific/Auckland",
  "venue": { "name": "XCHC", "address": "376 Wilsons Road North, Waltham, Ōtautahi Christchurch" },
  "cover_image_url": "https://files.xchc.co.nz/.../cover.jpg",
  "capacity": 200,
  "status": "on_sale",
  "ticket_types": [
    {
      "external_key": "sub",
      "name": "Subsidised",
      "description": "If money is tight",
      "price": "20.00"
    },
    { "external_key": "std", "name": "Standard", "price": "25.00" },
    {
      "external_key": "sup",
      "name": "Supporter",
      "description": "Pays a little forward",
      "price": "30.00"
    }
  ]
}
```

Notes:

- **Three online tiers, one price each, no allocation per tier.** XCHC's
  tiers are pay-what-fits: subsidised, standard and supporter, all for the
  same ticket. A buyer picks the one that suits them. Any tier can sell the
  whole room; only the event capacity caps sales. A fourth "door" price exists
  in Pickle, but it is sold at the door in cash or on the till, not through
  Gather.
- **Prices change.** The standard price moves and the other two move with it.
  `PATCH /events/{id}` and `PATCH /events/{id}/ticket_types/{id}` with the
  same fields is enough. A price change must not affect tickets already sold.
- **Cover image.** Pickle holds a 1920×1005 event cover. Either accept a URL
  Gather fetches once, or a multipart upload. Tell us the dimensions and size
  you want and Pickle will produce that.
- **Description length.** Pickle trims listing copy to fit each platform.
  Tell us the limit and what formatting survives.
- **Status transitions Pickle would drive:** `draft` → `on_sale` (the push),
  `on_sale` → `sales_closed` (doors, or the coordinator's call), and
  `cancelled`. Pickle will never delete an event that has sold a ticket.
- **Response:** the full event as in 3.1, so Pickle gets every ID in one round
  trip.

## 5. Codes and comps

Both live on the event record in Pickle, and both push to Gather with the
listing. Coordinators should never have to open Gather's admin to make a code.

### 5.1 Discount codes

```
POST /events/{event_id}/discount_codes
PATCH /events/{event_id}/discount_codes/{id}
GET /events/{event_id}/discount_codes
```

```json
{
  "code": "LOCALS",
  "kind": "percent",
  "value": "10",
  "max_redemptions": 30,
  "active": true,
  "applies_to": ["tt_1", "tt_2", "tt_3"],
  "redemptions": 12
}
```

`kind` is `percent` or `amount`. Deactivating a code closes it to new orders and
leaves existing holders alone. `redemptions` on read is what Pickle shows
against the surplus. The order's `discount_code` (3.2) is how Pickle checks
it.

### 5.2 Comps

Comps are the venue's own allocation: guest list for the acts, crew, media. In
Pickle they are **an allocation, not a ticket type, and they never touch the
sold figure.** They cost the venue forgone income, which Pickle works out
itself.

What Pickle needs is for named comps to appear on the door list and be
checkable-in like any other ticket:

```
POST /events/{event_id}/comps
```

```json
{
  "external_id": "comp_cmf3x1abc_3",
  "name": "Half Hexagon guest · 1",
  "allocation": "Half Hexagon",
  "note": "artist guest list"
}
```

Returns a `ticket_id` that shows up in section 6 with `"kind": "comp"`. If
Gather already has a guest-list or free-ticket feature, a way to issue a free
ticket to a name without an email will do, as long as those tickets are
flagged so they stay out of `sold`.

## 6. The door

On show night the door works off Pickle, not off Gather's admin, so nobody
keeps a second list. Pickle pulls the list, and check-ins go **both ways**:
scanning in Gather's own app should show up in Pickle, and ticking a name in
Pickle should show up in Gather.

### 6.1 Door list

```
GET /events/{event_id}/tickets?cursor=...
```

```json
{
  "data": [
    {
      "id": "tix_4f1",
      "order_id": "ord_88a1",
      "kind": "paid",
      "holder_name": "Ari Tāne",
      "ticket_type_id": "tt_2",
      "discount_code": "LOCALS",
      "checked_in_at": null,
      "checked_in_by": null
    },
    {
      "id": "tix_4f2",
      "order_id": null,
      "kind": "comp",
      "holder_name": "Half Hexagon guest · 1",
      "allocation": "Half Hexagon",
      "checked_in_at": "2026-10-03T20:41:00+13:00",
      "checked_in_by": "gather_scanner"
    }
  ],
  "next": null
}
```

One row per person, not per order. An order for two tickets is two rows with
the same `holder_name`, or two names if Gather collects them. `kind` is at
least `paid` and `comp`; refunded tickets are omitted or flagged, your call,
but say which.

### 6.2 Check-in

```
POST /events/{event_id}/tickets/{ticket_id}/check_in
DELETE /events/{event_id}/tickets/{ticket_id}/check_in
```

Body optional: `{ "at": "...", "by": "pickle:CB" }`. Checking in an already
checked-in ticket should succeed and return the original `checked_in_at`, not
error, so a flaky door connection can retry. Undo is needed because doors make
mistakes.

## 7. Settlement figures

After the show, Pickle's settlement replaces its projection with what happened.
The door half of that is two numbers, both from Gather:

| Figure          | What it is                                                                                            | Terms                                  |
| --------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Tickets through | Paid tickets checked in, plus paid tickets not checked in (it is the sold count; no-shows still paid) | count                                  |
| Ticket takings  | What ticket buyers paid, net of refunds                                                               | NZD, **GST inclusive**, and state fees |

Section 3.1's `sold`, `gross` and `net_to_organiser` cover this, provided
they are final once sales close and refunds have settled. What Pickle needs
explicitly is:

- **Gross to buyer and net to organiser as separate figures**, so the venue can
  put Gather's fee on its own line rather than inside "ticket revenue".
- **When Gather pays out**, if the API can say so (`payout_at`, `payout_amount`,
  a reference). Not essential, but it closes the loop against the bank.
- A statement that these figures **do not change** after some point, or a
  `finalised_at`, so Pickle knows when to stop polling and write the number
  down.

## 8. Webhooks

Polling every few minutes is acceptable and Pickle will do it regardless.
Webhooks make the door and the sales curve feel live. If you build them:

| Event                    | When                                            |
| ------------------------ | ----------------------------------------------- |
| `order.paid`             | An order completes                              |
| `order.refunded`         | Full or partial refund                          |
| `ticket.checked_in`      | Scanned or marked in, in Gather                 |
| `ticket.check_in_undone` | The above reversed                              |
| `event.updated`          | Anything on the event changed in Gather's admin |
| `event.status_changed`   | on sale, sold out, closed, cancelled            |

Shape and rules Pickle needs:

- **One JSON body per event** with the type, a unique delivery ID, the
  timestamp, and the full current object (the order, the ticket, the event),
  not just its ID. Pickle can then act without a follow-up read.
- **Signed.** `HMAC-SHA256` over the raw body with a shared secret, in a header
  (`Gather-Signature: t=1726550000,v1=hex...` in the Stripe style is well
  understood). Pickle rejects anything unsigned.
- **Retried** with backoff for a day or so when Pickle does not answer 2xx,
  and **delivered at least once** with the delivery ID so Pickle can ignore
  a duplicate.
- **Registered per organiser** in Gather's settings or by API, with the
  secret shown once.

`event.updated` matters more than it looks. Pickle treats itself as the
record and Gather as the record's front end. If somebody changes a price in
Gather's admin, Pickle needs to know so it can say so, rather than quietly
carrying a different price on its settlement.

## 9. Auth, environments and limits

- **A per-organiser API key**, sent as `Authorization: Bearer <key>`, scoped to
  XCHC's organiser account and nothing else. Pickle stores it as an
  environment variable on the server and it never reaches a browser. OAuth is
  more than this needs; there is one venue and one server.
- **Read and write scopes** if you have them, so the first deployment can be
  read-only.
- **A sandbox** or a test organiser account that never charges a card, with
  test events we can create, sell fake tickets on and check in. Pickle's
  integration tests will run against it.
- **A published rate limit** and a `429` with `Retry-After` when it is hit.
  Pickle backs off on `429`, `502`, `503` and `504` already.
- **A `GET /me` or `GET /organiser`** that answers with the account name, so
  Pickle can show "Gather.rsvp connected as XCHC" and catch a wrong key on
  deploy rather than on show night.
- **Versioning**: a version in the path or a header, and notice before a
  breaking change. XCHC is a small team; a month is plenty.

## 10. What we do not need

Saying this so nothing is built for us that will not be used.

- **Selling tickets.** Pickle never takes a payment and never will. No card
  fields, no checkout API.
- **Buyer contact details.** No emails, phones or addresses. Pickle is not a
  CRM and holding that data is a liability the venue does not want. The
  buyer's name for the door is enough; if Gather would rather send a ticket
  reference and no name, tell us and we will talk.
- **Multi-organiser anything.** One organiser account, one venue.
- **Reserved seating, floor plans, merch, add-ons.** XCHC is a standing music
  room.
- **Deleting events or orders.** Pickle only ever cancels or closes.
- **Analytics dashboards.** Pickle draws its own from the orders.

## 11. Questions for you

Answers to these shape the rest.

1. Does Gather have **discount codes** today? Percent, amount, both? Per event
   or per organiser?
2. Is there a **free or comp ticket** that can be issued to a name without an
   email address, and is it distinguishable from a sale?
3. Is there a **scanner or check-in** feature already, and can a check-in be
   made from outside it?
4. What does an **order** contain today: is the buyer name captured per ticket
   or per order?
5. What is the **listing copy limit** and what formatting does it accept?
6. **Cover image**: dimensions, size, URL or upload?
7. How are **fees** shown in your figures: added on top for the buyer, taken
   out of the organiser's payout, or configurable?
8. When is an event's money **final**, and when do you pay out?
9. Would you rather **webhooks or polling** be the primary path? Pickle will
   do both, but it changes what we build first.
10. Is there any **referrer or UTM capture** on orders today?

## 12. Priority order

If this were built one piece at a time, this is the order XCHC would ask for:

1. Auth, `GET /organiser`, `GET /events`, `GET /events/{id}` (section 3.1, 9)
2. `GET /events/{id}/orders` with timestamps and pagination (3.2)
3. `GET /events/{id}/tickets` and check-in both ways (6)
4. `POST /events` and `PATCH` for the listing and tiers (4)
5. Discount codes and comps (5)
6. Webhooks (8)
7. Fees, payout and `finalised_at` (7)
8. Referrer capture (3.2)

Step 1 and 2 alone would remove the hand-typed sold count and give XCHC a
sales curve. Step 3 puts the door on Pickle. Everything after that removes a
trip into Gather's admin.

---

## Appendix: how this maps onto Pickle

For XCHC's own developers, so the integration is built against what is already
there. Not needed by Gather.

| Gather concept                 | Pickle today                                                                                 | Change needed                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Organiser API key              | Pattern in `src/lib/eposnow.ts`: env vars, `isConfigured()`, scrubbed errors                 | `src/lib/gather.ts` and `gather-client.ts` on the same pattern                                                                         |
| Event `external_id`            | `Event.id`                                                                                   | none                                                                                                                                   |
| Gather event `id`, `url`       | Not stored. `ChannelPush` for `channel: 'gather'` holds only `live`/`stale`                  | Add `externalId` and `url` to `ChannelPush`, or a `GatherEvent` row                                                                    |
| Ticket types `sub`/`std`/`sup` | `tiers()` in `src/lib/finance.ts` from `Event.std`                                           | Send on push; store the three `ticket_type_id`s                                                                                        |
| `sold`                         | `Event.sold`, typed by hand in `setSold`                                                     | Becomes a read. `setSold` stays as a fallback with `source: MANUAL`; product-gaps PG-7 wants a `TicketCount` time series with `source` |
| Orders with `placed_at`        | Nothing                                                                                      | PG-7: `TicketCount` series feeds the sales curve; `paceOf` in `src/lib/ticketing.ts` replaces its flat 0.56 with a fitted curve        |
| `starts_at` / `ends_at`        | `Event.date` plus `doors`, `allOut` strings in local time                                    | Compose in `Pacific/Auckland`; never convert the strings                                                                               |
| Capacity                       | `Space.capacity` or `seatedCapacity` via `capacityOf()`                                      | none                                                                                                                                   |
| Push live                      | `pushChannel(id, 'gather')` in `src/app/(app)/promo/actions.ts`, guarded by `canGoOnSale`    | Call the API inside the same transaction; keep the bar-budget lock                                                                     |
| Codes and comps                | `Event.crew` and `Event.tok` counts only. Prototype has full codes/comps; product-gaps PG-11 | New models; PG-11's acceptance criteria apply                                                                                          |
| Door list and check-in         | Nothing                                                                                      | New screen on Ticketing, per the prototype's Door list tab                                                                             |
| `gross` and `net_to_organiser` | `Actual.tickets`, `Actual.ticketRev` (GST inclusive), `doorSource: MANUAL`                   | Add `GATHER` to `ActualSource`; `countDoor` gains a server-read path like `closeBarFromTill`                                           |
| `event.updated` webhook        | `ChannelPush.stale` exists but Gather is marked `mirrors: false` in `src/lib/promo.ts`       | A Gather-side edit should set `stale` and say what differs                                                                             |
| Webhook receiver               | No `src/app/api` routes yet                                                                  | Route handler verifying the signature; every accepted delivery writes to `Activity`                                                    |

Rules that carry over unchanged: the activity table is append-only and every
mutation writes to it; permissions are server-side, and an external promoter
sees only their own events' figures; nothing here does its own price
arithmetic, `financeVals` does.
