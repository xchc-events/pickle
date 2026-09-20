# Promoter organisations: who belongs, and what they may do

Decided with Connor, 18 and 21 September 2026. Where this and the design handoff
disagree, this wins. See [What this replaces](#what-this-replaces).

An outside promoter sees only the events their organisation brought. Until now
an organisation was a `Payee` row an administrator attached an account to, one
per account, and nobody outside the venue could do anything about who was in
theirs. Touring promoters do not work like that. A label has three people on
it, a tour manager needs to see the shows and nothing else, and one person books
for two collectives. Waiting on a venue administrator for each of those does
not scale, so organisations are to run their own membership.

Nothing here is built yet. [How it is being built](#how-it-is-being-built)
lists the stages, and [Still to decide](#still-to-decide) the questions still
open.

## What Connor asked for

> Users should be able to define the name of their promoter organisation or
> pick from a list of already existing ones (as you type it shows similarly
> named organisations) and if you select an existing organisation it sends a
> notification to the Promoter Organisation Owner who can then approve you to
> be a part of their organisation and see events. Better yet, allow the
> promoter organisation owner to give different levels of permissions to
> members of their organisation. Our admins should also be able to alter
> organisations and their members if necessary. Organisation owners can add
> members to their organisation by inputting their email address and it sends
> out an acceptance link.

And, asked three questions:

- **An invitation to an address with no account creates the account.** An
  outside promoter, tied to the inviting organisation, who sets a password the
  way an administrator's invitation has them do. Single-use, seven days. The
  account shows in Admin, where it can be switched off.
- **Levels are Owner, Booker and Viewer.** Only an Owner changes the
  organisation's bank and tax details. "Owner and Booker should also be able to
  modify artist details for artists on their events (i.e. that way artists can
  give their tour promoter their EPK, bank details etc to upload to the
  platform). All accounts should be able to have any of these roles. One account
  can belong to multiple organisations that it is a part of or that it owns."
- It lands as small pull requests, one piece at a time.

## Membership

Membership is many to many, and it has nothing to do with `User.role`. Any
account may belong to any number of organisations, at a level in each. A
coordinator who also runs a night with a collective is a member of it and is
still staff.

```prisma
enum OrgLevel { OWNER BOOKER VIEWER }

model OrgMembership {
  userId         String
  organisationId String   // a Payee of kind PROMOTER
  level          OrgLevel
  @@unique([userId, organisationId])
}
```

`OrgMembership` replaces `User.organisationId` as what `eventScope` reads. An
outside account sees the union of its organisations' events, and one with no
memberships still matches nothing:

```ts
if (!user.external) return {}
if (user.organisationIds.length === 0) return { id: { in: [] } }
return { promoterId: { in: [...user.organisationIds] } }
```

`User.organisationId` stays for one release, read by nothing, as `User.promoter`
did, so the backfill can be checked against it. The backfill makes one
membership per account that has an organisation today. The earliest active
member of each organisation becomes its Owner, the rest Bookers.

## What each level may do

One pure function, `orgCan(level, capability)` in `src/lib/org.ts`, and every
check is `orgCan(levelIn(user, organisationId), capability)`. No check ever
reads a level without the organisation it is a level in.

|                                              | Viewer | Booker | Owner |
| -------------------------------------------- | ------ | ------ | ----- |
| See the organisation's events                | ✓      | ✓      | ✓     |
| Start an enquiry for it                      |        | ✓      | ✓     |
| Edit artist details, for acts on its events  |        | ✓      | ✓     |
| Edit the organisation's bank and tax details |        |        | ✓     |
| Manage members, requests and invitations     |        |        | ✓     |

No membership means no to all of it. A venue administrator acts on any
organisation without being a member of it.

**Bank details are the Owner's** because changing an account number redirects
every settlement the venue pays that organisation from then on. Today any member
can (`saveOwnDetails`). A change emails every Owner, the way a password change
emails the account: a notice out of band is how you find out it was not you.

### Artist details, and the fraud they invite

A promoter who can type an act's bank account can type their own. Seven
controls, all of them required:

1. The actions take an event and an act on it, never a payee id. The payee is
   found on the server.
2. It is allowed only when that event's `promoterId` is an organisation the
   caller may edit artist details for. An act's payee record is shared across
   every event they play, for anybody, so it is only ever reachable through an
   act row on one of your own events.
3. Details the act confirmed themselves (`detailsAt` is set) are never
   overwritten by a promoter. The act's own link is the only way to change them.
   A promoter may fill in details where there are none, and correct ones their
   own organisation entered.
4. `detailsAt` keeps its one meaning, that the payee confirmed. A promoter's
   entry leaves it null and records who entered it, for which organisation, and
   when.
5. Finance is told before it pays: "entered by Kōura Records (Awhina Reid),
   3 Oct — not confirmed by the act", and the payable says to verify first.
6. An activity line on the event, a line on the organisation's own trail, and an
   email to the event's owner and, where there is an address, to the act.
7. Nothing is read back. `canReveal` already refuses every outside account.

Files (riders, stage plot, press shots, bio, EPK) go through the existing upload
path with the event always set and only the kinds the artist's own link allows.

## Getting in

**Founding one.** Any account may name a new organisation and becomes its Owner.
Names are folded (case, spacing, punctuation) and two organisations may not fold
to the same key. If the name is taken, they are offered a request to join it.

**Finding one.** The type-ahead needs three characters, matches from the start
of the folded name, and returns at most eight names and nothing else. It does
let an outside account learn the names of organisations that have brought shows
here. That was asked for; these limits are what keep it to that.

**Asking to join.** A request grants nothing. One pending request per account
per organisation. An Owner of that organisation approves or declines, and only
approval creates the membership. An organisation with no Owner sends its
requests to the venue's administrators. Every organisation made before this has
no Owner until the backfill or an administrator names one.

**Being invited.** An Owner enters an address and a level, never Owner. The link
goes to its own page, `/org/invite/[token]`, kept apart from the sign-in links so
that no path can confuse joining an organisation with proving who you are.
Opening the page spends nothing; the button does. Somebody signed in must be
signed in as the invited address, which is what makes a forwarded link useless.
An address with no account gets one, created inside the same transaction that
spends the invitation: always an outside promoter, always exactly that one
membership, never with a password. They are then sent the ordinary invitation to
set one. Ten live invitations an organisation, twenty a day.

This changes a rule the code states in several places: that an account is made
by an administrator in Admin and nowhere else. Those comments change in the same
pull request as the behaviour (`prisma/schema.prisma` on `User`, `src/lib/auth.ts`,
`src/lib/auth-rules.ts`, `src/lib/admin-data.ts`, and the Admin page's own
subtitle). A quietly false invariant is worse than a changed one.

## Staying in, and leaving

Levels, removal and transfer are per organisation. Nobody changes their own
level. An organisation always has an Owner: the last one cannot be demoted or
removed, and a transfer promotes before it demotes.

Removing somebody from one organisation does not sign them out. Scope is read
afresh on every request, so the organisation is gone from what they see at once,
and ending their sessions would sign a coordinator, or a promoter who still
works for another label, out of everything. Switching an account off still ends
its sessions. An administrator removing somebody as a security matter can choose
to sign them out everywhere as well.

Administrators can rename an organisation, name its Owner, change or remove any
membership, approve requests for one with no Owner, revoke invitations, and
merge duplicates. A merge re-points every event, membership, file and grant, and
deletes nothing: the organisation merged away may hold sealed bank details.

Everything that changes an organisation is written to an append-only trail of
its own. `Activity` belongs to an event and none of this does.

## What this replaces

- `User.organisationId` as the thing that scopes an outside account.
- The comment in `src/lib/portal-data.ts` that an organisation is made only by a
  migration or a coordinator.
- `userProblems` in `src/lib/auth-rules.ts` calling a staff account with an
  organisation a misconfiguration. It is now ordinary.
- Matching promoters by name in `src/lib/pipeline-data.ts` and
  `src/lib/event-record-data.ts` (`hasPortal`, the outside coordinator's avatar).
  Both still use the substring match `scope.ts` was rewritten to get rid of.
- The refusal at `/events/new` for an outside account with no organisation. It
  becomes a way to found or join one. With several organisations, the enquiry
  form asks which one the night is for, from those the account may book for.

## Still to decide

- Whether an organisation somebody founds themselves needs the venue to confirm
  it before its enquiries are taken seriously. Proposed: no, but Admin marks it
  unconfirmed until a coordinator has looked.
- Whether an act is sent their own confirmation link as soon as a promoter
  enters their details. Proposed: yes, where there is an address for them.
- Whether choosing an organisation in Sign-offs also filters "Your events".
  Proposed: no. Bank details and members belong to one organisation; the
  Pipeline stays the union.

## How it is being built

Tests first at every stage, and every migration tried on a throwaway database.

1. **Memberships replace the one organisation.** The table and its backfill,
   `eventScope`, the session, Sign-offs, Admin, the enquiry form, the seed, and
   every test fixture that builds a signed-in user. `hasPortal` stops matching
   by name.
2. **Levels do something.** `orgCan`. Bank details become the Owner's. Sign-offs
   gets a way to choose the organisation. Admin edits a list of memberships.
3. **Founding, finding, joining.** Folded names, the type-ahead, requests and
   their approval, the organisation's trail, the emails.
4. **Invitations that can make an account**, and the invariant comments with them.
5. **Promoters maintain their acts.** The provenance columns, the seven
   controls, and what Finance is shown.
6. **Managing members, and merging duplicates.**
