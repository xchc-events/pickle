/**
 * Seed: the design prototype's own data, as real rows.
 *
 * Ported from `seed()` in docs/design-handoff/design/Pickle Prototype.dc.html.
 * The figures matter — the prototype's numbers are what the venue recognises,
 * and they are what the finance tests are written against.
 *
 * Dates: the prototype pins events to fixed strings ("Sat 6 Sep") with a
 * days-to-door offset from a notional today. Here they are seeded relative to
 * the day the seed runs, then nudged by up to three days so each event still
 * falls on its intended day of week. Day of week is not cosmetic — it picks
 * the event's share of the weekly cost base (COV in src/lib/finance.ts), so
 * moving an event off its day would move its surplus.
 *
 * Two environment variables change what a run does, both read once at the
 * top of `main()` so a bad one can refuse before anything is touched:
 *
 *  - `SEED_PASSWORD` — on a local Postgres, seeded users sign in with the
 *    development role picker and never need a password. A test deployment is
 *    a production build, where that picker is off and an emailed link cannot
 *    reach an `@xchc.test` address — so without a password nobody can sign
 *    in at all. When this is set (and not blank), every seeded user gets it
 *    as their password, checked against `src/lib/password-policy.ts` for
 *    each of them first; unset or blank leaves passwords null, as before.
 *  - `SEED_ONLY_IF_EMPTY` — a redeploy of the test site runs this seed again.
 *    Wiping and reinstalling is what a developer wants against a local
 *    database, and the last thing anybody wants against a test database that
 *    has a week of real clicking-around in it. Set to `1` or `true`, the seed
 *    counts the User table first and, if it is not empty, logs one line and
 *    stops without deleting or creating anything.
 */

import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Role, type ArtistStatus } from '../src/generated/prisma/client'
import { DEFAULT_PERMS, type RoleKey } from '../src/lib/constants'
import { ASSET_SET } from '../src/lib/design'
import { shiftPlan, type RosterEvent } from '../src/lib/roster'
import { capacityOf } from '../src/lib/ticketing'
import { plausibleSalesHistory } from '../src/lib/gather-seed'
import { financeVals } from '../src/lib/finance'
import { barBudgetFrom, isBarRole } from '../src/lib/bar'
import { hashPassword } from '../src/lib/password'
import { seedOnlyIfEmpty, seedPasswordFrom } from '../src/lib/seed-install'
import { nightOfLocal } from '../src/lib/night'
import { HOUSE_TASKS } from '../src/lib/intake'
import { endNightFor } from '../src/lib/run-times'

/**
 * The one bookable room.
 *
 * Declared once and used both to create the Space row and to work out
 * attendance defaults, so the seeded room and the figures derived from it
 * cannot disagree.
 */
const MAIN_SPACE = { name: 'Main', capacity: 220, seatedCapacity: 150 }
const MAIN_CAPACITY = { capacity: MAIN_SPACE.capacity, seatedCapacity: MAIN_SPACE.seatedCapacity }
import { BEATS, PLATFORMS } from '../src/lib/promo'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

/**
 * Connor, 23 Sep 2026, on Tech production: "It'd be better to have a more
 * full-featured option where you can select which components of a venue
 * spec sheet you're sending out, as not all of them are relevant to all
 * people." His own list of sections, seeded in this order — the wording is
 * a starting point for an administrator to correct in Admin, "Venue spec",
 * not a finished spec; nothing here is a fact about the room that has not
 * already been established elsewhere in this file.
 */
const VENUE_SPEC_COMPONENTS: { key: string; title: string; body: string }[] = [
  {
    key: 'room',
    title: 'Room dimensions and capacity',
    body: `${MAIN_SPACE.name}: capacity ${MAIN_SPACE.capacity} standing, ${MAIN_SPACE.seatedCapacity} seated. Floor dimensions to be added here.`,
  },
  {
    key: 'stage',
    title: 'Stage',
    body: 'Dimensions, height and access to be added here.',
  },
  {
    key: 'pa',
    title: 'PA and monitors',
    body: 'The house PA, monitor count and mix positions to be added here.',
  },
  {
    key: 'lighting',
    title: 'Lighting rig',
    body: 'What is rigged, and what a visiting LD can plug into, to be added here.',
  },
  {
    key: 'backline',
    title: 'Backline',
    body: 'What the venue can provide, and what every act still needs to bring, to be added here.',
  },
  {
    key: 'power',
    title: 'Power',
    body: 'Available power on stage and front of house to be added here.',
  },
  {
    key: 'load_in',
    title: 'Load-in and parking',
    body: 'Where to pull up, the route in, and any lift or stairs, to be added here.',
  },
  {
    key: 'green_room',
    title: 'Green room',
    body: 'What the green room offers, and where it is relative to the stage, to be added here.',
  },
  {
    key: 'bar_catering',
    title: 'Bar and catering',
    body: 'What the house bar covers, and any hospitality provided to acts, to be added here.',
  },
  {
    key: 'house_rules',
    title: 'House rules',
    body: 'Curfew, noise limits and anything else every act needs to know before they arrive, to be added here.',
  },
  {
    key: 'contacts',
    title: 'Contacts',
    body: 'Who to call on the day — duty manager and tech lead — to be added here.',
  },
]

// ------------------------------------------------------------------ people ---

const PEOPLE = [
  { n: 'Ana Kelliher', i: 'AK', can: ['Duty manager', 'Bar staff'], fortnight: 14 },
  { n: 'Hine Paora', i: 'HP', can: ['Bar staff'], fortnight: 11 },
  { n: 'Jonty Rewi', i: 'JR', can: ['Sound — Lead', 'Sound — 2IC'], fortnight: 16 },
  { n: 'Rangi Moke', i: 'RM', can: ['Sound — 2IC', 'Lighting — Lead'], fortnight: 9 },
  { n: 'Sam Peters', i: 'SP', can: ['Lighting — Lead', 'Set-up crew'], fortnight: 7 },
  { n: 'Tama Fields', i: 'TF', can: ['Door', 'Set-up crew'], fortnight: 12 },
  { n: 'Nina Wray', i: 'NW', can: ['Care team', 'Door'], fortnight: 6 },
  { n: 'Kahu Mihaka', i: 'KM', can: ['Bar staff', 'Door', 'Clean-up crew'], fortnight: 4 },
  { n: 'Esme Vaile', i: 'EV', can: ['Care team', 'Door', 'Clean-up crew'], fortnight: 3 },
  { n: 'Dev Rao', i: 'DR', can: ['Set-up crew', 'Clean-up crew', 'Bar staff'], fortnight: 37 },
  { n: 'Whetu Ngata', i: 'WN', can: ['Door', 'Care team', 'Clean-up crew'], fortnight: 8 },
  { n: 'Pip Callaghan', i: 'PC', can: ['Bar staff', 'Duty manager'], fortnight: 10 },
  { n: 'Marama Hall', i: 'MH', can: ['Care team', 'Door'], fortnight: 5 },
  {
    n: 'Tobias Renn',
    i: 'TR',
    can: ['Sound — 2IC', 'Lighting — Lead', 'Set-up crew'],
    fortnight: 13,
  },
  { n: 'Lena Fisi', i: 'LF', can: ['Door', 'Bar staff', 'Set-up crew'], fortnight: 6 },
  { n: 'Ori Beckett', i: 'OB', can: ['Sound — Lead', 'Sound — 2IC'], fortnight: 18 },
  { n: 'Suzy Kalani', i: 'SK', can: ['Clean-up crew', 'Set-up crew', 'Care team'], fortnight: 2 },
  { n: 'Mere Tapu', i: 'MT', can: ['Duty manager', 'Door'], fortnight: 22 },
  { n: 'Tui Ware', i: 'TW', can: ['Door', 'Care team'], fortnight: 5 },
  { n: 'Sione Latu', i: 'SL', can: ['Duty manager', 'Bar staff'], fortnight: 9 },
]

const USERS: {
  id: string
  n: string
  i: string
  role: RoleKey
  org?: string
}[] = [
  { id: 'mt', n: 'Mere Tapu', i: 'MT', role: 'coordinator' },
  { id: 'tw', n: 'Tui Ware', i: 'TW', role: 'design' },
  { id: 'jr', n: 'Jonty Rewi', i: 'JR', role: 'tech' },
  { id: 'ak', n: 'Ana Kelliher', i: 'AK', role: 'bar' },
  { id: 'sl', n: 'Sione Latu', i: 'SL', role: 'admin' },
  { id: 'kr', n: 'Awhina Reid', i: 'AR', role: 'promoter', org: 'Kōura Records' },
  { id: 'hx', n: 'Devon Marsh', i: 'DM', role: 'promoter', org: 'Hex Collective' },
]

// ------------------------------------------------------------------- rota ---
// Role windows live here rather than in src/lib until the Roster module is
// ported — the seed is their only consumer today. [start offset, hours].

// The role windows and the role list live in src/lib/roster.ts — they are
// house standard, like ASSET_SET above, and a second copy here would mean the
// seed and the product could disagree about what a shift is.

// ----------------------------------------------------------------- events ---

type SeedEvent = {
  id: string
  name: string
  dow: string
  days: number
  /// Where the booking stands. Every other part of the event is worked out
  /// from the rows below, as the product works it out — see src/lib/parts.ts.
  booking: 'enquiry' | 'negotiating' | 'confirmed'
  /// Days since this event last moved on. Listings, the review and the first
  /// activity line are dated off it.
  sinceDays: number
  /// Design has been briefed: a piece of the set is up for sign-off, design
  /// and tech have leads, and four acts are confirmed rather than two.
  briefed?: boolean
  /// Tickets are live on Gather.rsvp, with what goes with going on sale: the
  /// hand-posted listings ticked off, the first two beats worked, a promo
  /// lead, a finance review signed and a locked bar budget.
  onSale?: boolean
  format: string
  kind: string
  space?: string
  internal?: boolean
  promoter: string
  owner: string | null
  std?: number
  door?: number
  barHead?: number
  gear?: number
  adv?: number
  sound?: string
  licence?: string
  lateBar?: boolean
  sold?: number
  filled?: number
  /// How many pieces of the design set are signed off. The next one along is
  /// the one up for sign-off; everything after it is still a draft.
  approved?: number
  /// Pieces of the set already in, whatever the booking says — a promoter's
  /// tour artwork arrives with the enquiry. Applied over `approved`.
  pieces?: Record<string, 'REVIEW' | 'APPROVED'>
  /// The creative one-liner, where the coordinator has written one.
  brief?: string
  att?: [number, number, number]
  concluded?: boolean
  risk?: string
  riskKind?: 'warn' | 'stop'
  pa?: { name: string; low: number; high: number }[]
  tasks?: { team: string; est: number; actual: number | null }[]
  actual?: { tickets: number; ticketRev: number; barTake: number; barProfit: number }
}

const DEFAULT_PA = [
  { name: 'Promoter', low: 150, high: 400 },
  { name: 'Artist 1', low: 100, high: 300 },
  { name: 'Artist 2', low: 100, high: 300 },
  { name: 'Artist 3', low: 100, high: 300 },
  { name: 'Artist 4', low: 100, high: 300 },
  { name: 'Artist 5', low: 100, high: 350 },
]

const EVENTS: SeedEvent[] = [
  {
    id: 'ssr',
    name: 'Sunday Slow Roast',
    approved: 6,
    internal: true,
    promoter: 'internal · Ana Kelliher',
    owner: 'AK',
    dow: 'Sun',
    days: 3,
    booking: 'confirmed',
    sinceDays: 1,
    briefed: true,
    onSale: true,
    format: 'Cabaret',
    std: 25,
    door: 35,
    sold: 78,
    barHead: 18,
    gear: 0,
    adv: 20,
    kind: 'workshop',
    licence: 'confirmed',
    lateBar: false,
  },
  {
    id: 'bs4',
    name: 'Basement Sessions vol. 4',
    approved: 6,
    internal: true,
    promoter: 'internal · Mere Tapu',
    owner: 'MT',
    dow: 'Fri',
    days: 8,
    booking: 'confirmed',
    sinceDays: 6,
    briefed: true,
    onSale: true,
    format: 'DJs',
    sold: 96,
    kind: 'djs',
    licence: 'applied',
    filled: 9,
    risk: '3 shifts unfilled, 8 days out',
    riskKind: 'warn',
  },
  {
    id: 'sf',
    name: 'Slow Fold — album release',
    approved: 5,
    brief:
      'Slow Fold play the whole record front to back, with Harbour Static opening. Last Ōtautahi show before they tour.',
    promoter: 'Kōura Records',
    dow: 'Sat',
    days: 16,
    booking: 'confirmed',
    sinceDays: 4,
    briefed: true,
    onSale: true,
    format: 'Live music',
    owner: 'MT',
    kind: 'live',
    sound: 'wheke',
    licence: 'confirmed',
    sold: 84,
    filled: 11,
    att: [90, 145, 200],
    pa: [
      { name: 'Kōura Records', low: 150, high: 400 },
      { name: 'Slow Fold', low: 200, high: 500 },
      { name: 'Harbour Static', low: 100, high: 250 },
      { name: 'Nio', low: 100, high: 300 },
      { name: 'Te Awa', low: 100, high: 300 },
      { name: 'DJ Wetland', low: 100, high: 200 },
    ],
    tasks: [
      { team: 'Event coordination', est: 9, actual: 6.5 },
      { team: 'Design & comms', est: 6, actual: 7.5 },
      { team: 'Comms / socials', est: 3, actual: 1.5 },
      { team: 'Production management', est: 1.5, actual: null },
      { team: 'Bar admin & accounting', est: 3, actual: 1 },
    ],
  },
  {
    id: 'sb',
    name: 'Static Bloom',
    approved: 2,
    promoter: 'Hex Collective',
    dow: 'Sat',
    days: 23,
    booking: 'confirmed',
    sinceDays: 6,
    briefed: true,
    onSale: true,
    format: 'DJs + live',
    owner: 'JR',
    sold: 12,
    kind: 'live-djs',
    sound: 'wheke',
    licence: 'required',
    risk: 'Artwork awaiting sign-off 6d',
    riskKind: 'stop',
  },
  {
    id: 'obc',
    name: 'Ōtautahi Bass Co-op',
    approved: 2,
    promoter: 'Puha Sound',
    dow: 'Fri',
    days: 29,
    booking: 'confirmed',
    sinceDays: 2,
    briefed: true,
    onSale: true,
    format: 'DJs',
    owner: 'SP',
    sold: 31,
    kind: 'djs',
    licence: 'applied',
  },
  {
    id: 'dtm',
    name: 'Dust to Mountains',
    approved: 0,
    internal: true,
    promoter: 'internal · Jonty Rewi',
    owner: 'JR',
    dow: 'Thu',
    days: 35,
    booking: 'confirmed',
    sinceDays: 9,
    format: 'Live music',
    kind: 'live',
    risk: 'Confirmed 9 days ago, no creative brief yet',
    riskKind: 'warn',
  },
  {
    id: 'wl',
    name: 'Wax Lyrical #12',
    approved: 0,
    promoter: 'Puha Sound',
    dow: 'Sat',
    days: 37,
    booking: 'negotiating',
    sinceDays: 3,
    format: 'DJs',
    owner: 'SP',
    kind: 'djs',
  },
  {
    id: 'kr',
    name: 'Kōwhai Rooms residency',
    approved: 0,
    internal: true,
    promoter: 'internal · Ana Kelliher',
    owner: 'AK',
    dow: 'Wed',
    days: 41,
    booking: 'negotiating',
    sinceDays: 1,
    format: 'Cabaret',
    std: 20,
    door: 25,
    kind: 'workshop',
    licence: 'none',
    lateBar: false,
  },
  {
    id: 'chr',
    name: 'Care & Harm Reduction hui',
    approved: 0,
    internal: true,
    promoter: 'internal · unassigned',
    owner: null,
    dow: 'Tue',
    days: 12,
    booking: 'enquiry',
    sinceDays: 2,
    format: 'Cabaret',
    std: 0,
    door: 0,
    kind: 'workshop',
    licence: 'none',
    lateBar: false,
  },
  {
    id: 'ns',
    name: 'Nightshade (Halloween)',
    approved: 0,
    promoter: 'Hex Collective',
    // Hex sent the cover and the story cut for their whole Halloween run
    // with the enquiry. They are up for sign-off before any terms are
    // agreed — design no longer waits on the booking.
    pieces: { cover: 'REVIEW', story: 'REVIEW' },
    dow: 'Fri',
    days: 71,
    booking: 'enquiry',
    sinceDays: 1,
    format: 'DJs + live',
    owner: null,
    kind: 'live-djs',
  },
  {
    id: 'apt',
    name: 'Kiwa Trio — listening room',
    approved: 6,
    promoter: 'Kōura Records',
    dow: 'Fri',
    days: 8,
    booking: 'confirmed',
    sinceDays: 3,
    briefed: true,
    onSale: true,
    format: 'Cabaret',
    kind: 'live',
    std: 22,
    door: 28,
    sold: 34,
    barHead: 12,
    gear: 0,
    adv: 30,
    licence: 'none',
    lateBar: false,
    owner: 'AK',
    filled: 5,
  },
  {
    id: 'lps',
    name: 'Long Player Sundays #9',
    approved: 6,
    internal: true,
    promoter: 'internal · Ana Kelliher',
    owner: 'AK',
    dow: 'Sun',
    days: -14,
    booking: 'confirmed',
    sinceDays: 4,
    briefed: true,
    onSale: true,
    format: 'Cabaret',
    std: 25,
    door: 30,
    sold: 121,
    barHead: 17,
    gear: 0,
    adv: 40,
    kind: 'workshop',
    licence: 'confirmed',
    lateBar: false,
    concluded: true,
    actual: { tickets: 118, ticketRev: 3009, barTake: 1974, barProfit: 1026 },
  },
  {
    id: 'vs7',
    name: 'Vault Sessions #7',
    approved: 6,
    promoter: 'Puha Sound',
    dow: 'Sat',
    days: -8,
    booking: 'confirmed',
    sinceDays: 2,
    briefed: true,
    onSale: true,
    format: 'DJs',
    sold: 164,
    kind: 'djs',
    owner: 'MT',
    licence: 'confirmed',
    sound: 'wheke',
    concluded: true,
    actual: { tickets: 151, ticketRev: 4863, barTake: 3268, barProfit: 1699 },
  },
]

// ------------------------------------------------------------------ dates ---

const DOW_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const startOfToday = () => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  return d
}
const addDays = (d: Date, n: number) => {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/**
 * `days` out from today, then nudged by at most three days onto the intended
 * weekday, so the event keeps its share of the weekly cost base.
 */
function seedDate(today: Date, daysOut: number, dow: string): Date {
  const target = DOW_INDEX[dow]
  const naive = addDays(today, daysOut)
  let shift = (target - naive.getDay() + 7) % 7
  if (shift > 3) shift -= 7
  return addDays(naive, shift)
}

// ----------------------------------------------------------------- shifts ---

/** The seed's event shape, as the roster library wants it. */
function rosterEventFor(e: SeedEvent, lateBar: boolean): RosterEvent {
  return {
    space: MAIN_CAPACITY,
    format: e.format,
    kind: e.kind,
    att: e.att ?? [0, 0, 0],
    lateBar,
  }
}

/**
 * Who gets a shift. Trained people first, anyone free otherwise.
 *
 * Set-up and clean-up crew are only counted against each other, so the same
 * person can take a crew slot as well as a specialist one — which is what
 * actually happens on the night.
 */
function pickFor(role: string, assigned: { role: string; person: string }[]): string | null {
  const isCrew = role.includes('crew')
  const taken = assigned
    .filter((s) => (isCrew ? s.role.includes('crew') : true))
    .map((s) => s.person)
  const p =
    PEOPLE.filter((x) => x.can.includes(role) && !taken.includes(x.i))[0] ??
    PEOPLE.filter((x) => !taken.includes(x.i))[0]
  return p ? p.i : null
}

/**
 * What a listing says about itself. Only Slow Fold carries notes in the
 * prototype — it is the event the demo walks through, so it is the one with a
 * history behind each channel.
 */
function channelNote(e: SeedEvent, channel: string, cap: number): string | null {
  if (e.id !== 'sf') return null
  switch (channel) {
    case 'facebook-event':
      return 'Start time says 8:30pm · support act missing'
    case 'eventfinda':
      return `Capacity still 180, now ${cap}`
    case 'gather':
      return `4 tiers live · ${e.sold ?? 0} sold · cap ${cap}`
    case 'instagram':
      return 'Grid post 24 Aug · 2 stories queued'
    case 'mailchimp':
      return '“What’s on in September” · 2,140 subscribers'
    default:
      return null
  }
}

// ------------------------------------------------------------------- main ---

async function main() {
  const today = startOfToday()

  // Read and validate both seed knobs before anything reaches the database.
  // A `SEED_PASSWORD` that fails the house policy must refuse here, ahead of
  // even the `SEED_ONLY_IF_EMPTY` count below — a bad password should never
  // get the chance to leave a half-cleared database behind.
  const onlyIfEmpty = seedOnlyIfEmpty(process.env)
  const seedPassword = seedPasswordFrom(
    process.env,
    USERS.map((u) => ({ name: u.n, email: `${u.id}@xchc.test` })),
  )

  if (onlyIfEmpty) {
    const existing = await db.user.count()
    if (existing > 0) {
      console.log(`seed skipped: ${existing} users already present (SEED_ONLY_IF_EMPTY)`)
      return
    }
  }

  console.log('clearing…')
  await db.activity.deleteMany()
  await db.hourEntry.deleteMany()
  await db.shift.deleteMany()
  await db.task.deleteMany()
  await db.addon.deleteMany()
  await db.eventArtist.deleteMany()
  await db.asset.deleteMany()
  await db.channelPush.deleteMany()
  await db.beat.deleteMany()
  await db.eventLead.deleteMany()
  await db.financeReview.deleteMany()
  await db.actual.deleteMany()
  await db.barSale.deleteMany()
  await db.barBudget.deleteMany()
  await db.ticketSaleDay.deleteMany()
  await db.ticketCode.deleteMany()
  await db.doorListEntry.deleteMany()
  await db.event.deleteMany()
  await db.space.deleteMany()
  await db.availability.deleteMany()
  await db.user.deleteMany()
  await db.person.deleteMany()
  await db.payee.deleteMany()
  await db.modulePermission.deleteMany()
  await db.venueSpecComponent.deleteMany()

  console.log('permissions…')
  for (const [role, mods] of Object.entries(DEFAULT_PERMS)) {
    for (const m of mods) {
      await db.modulePermission.create({
        data: { role: role.toUpperCase() as Role, module: m },
      })
    }
  }

  console.log('venue spec…')
  for (const [i, c] of VENUE_SPEC_COMPONENTS.entries()) {
    await db.venueSpecComponent.create({ data: { ...c, order: i } })
  }

  console.log('people…')
  const personByInitials = new Map<string, string>()
  for (const p of PEOPLE) {
    const row = await db.person.create({
      data: {
        name: p.n,
        initials: p.i,
        // Connor's 22 Sep 2026 pay policy: Mere Tapu, the seeded duty
        // manager, is the one fictional employee on the books, so both
        // rates show locally. Everyone else defaults to CONTRACTOR.
        employment: p.i === 'MT' ? 'EMPLOYEE' : 'CONTRACTOR',
      },
    })
    personByInitials.set(p.i, row.id)
    await db.availability.create({
      data: { personId: row.id, weekly: p.fortnight / 2, volunteer: 0 },
    })
  }

  console.log('users…')
  for (const u of USERS) {
    await db.user.create({
      data: {
        id: u.id,
        email: `${u.id}@xchc.test`,
        name: u.n,
        role: u.role.toUpperCase() as Role,
        promoter: u.org ?? null,
        personId: personByInitials.get(u.i) ?? null,
        // Hashed per user rather than once and reused: password.ts's own
        // invariant is that even a password shared on purpose still gets a
        // unique salt per account, and a handful of scrypt hashes costs under
        // a second next to what a shared salt would give away for free.
        passwordHash: seedPassword ? await hashPassword(seedPassword) : null,
        passwordChangedAt: seedPassword ? today : null,
      },
    })
  }
  if (seedPassword) {
    console.log(`passwords set for ${USERS.map((u) => u.id).join(', ')}`)
  }

  console.log('spaces…')
  const spaceIds = new Map<string, string>()
  // One bookable room. Capacity lives on the row — nothing reads it from a
  // constant any more, so a second room is a seed entry, not a code change.
  {
    const row = await db.space.create({ data: MAIN_SPACE })
    spaceIds.set(MAIN_SPACE.name, row.id)
  }

  console.log('events…')
  for (const e of EVENTS) {
    const spaceName = e.space ?? 'Main'
    // A night, as src/lib/night.ts stores one. The hold ladder matches a night
    // by exact instant, so a seeded event and one started through the enquiry
    // form on the same night have to store the same one, or two bookings could
    // hold the same room without either ladder seeing the other.
    const date = nightOfLocal(seedDate(today, e.days, e.dow))
    const lateBar = e.lateBar !== false
    // The prototype's own run times. Without doors there is no service
    // window, and without one a bar cannot be read off the till.
    const doors = lateBar ? '8:00pm' : '7:00pm'
    const barClose = lateBar ? '12:00am' : '11:00pm'
    const allOut = lateBar ? '1:00am' : '11:30pm'
    const cap = capacityOf(MAIN_CAPACITY, e.format)
    const att: [number, number, number] = e.att ?? [
      Math.round(cap * 0.4),
      Math.round(cap * 0.62),
      Math.round(cap * 0.9),
    ]

    const licenceMap: Record<string, string> = {
      none: 'NOT_REQUIRED',
      required: 'REQUIRED',
      applied: 'APPLIED_FOR',
      confirmed: 'CONFIRMED',
      denied: 'DENIED',
    }

    const created = await db.event.create({
      data: {
        id: e.id,
        name: e.name,
        date,
        spaceId: spaceIds.get(spaceName)!,
        kind: e.kind,
        format: e.format,
        ownerId: e.owner ? (personByInitials.get(e.owner) ?? null) : null,
        promoter: e.promoter,
        internal: e.internal ?? false,
        bookingStatus: e.booking.toUpperCase() as never,
        bookingStatusSince: addDays(today, -e.sinceDays),
        concluded: e.concluded ?? false,
        // Seed events obc, wl and vs7 are dry hire; everything else curator.
        model: ['obc', 'wl', 'vs7'].includes(e.id) ? 'DRY' : 'CURATOR',
        licence: (licenceMap[e.licence ?? 'required'] ?? 'REQUIRED') as never,
        riskNote: e.risk ?? null,
        riskKind: (e.riskKind ?? 'warn').toUpperCase() as never,
        std: e.std ?? 30,
        door: e.door ?? 40,
        mix: [0.2, 0.4, 0.15, 0.25],
        att,
        scen: 1,
        sold: e.sold ?? 0,
        barHead: e.barHead ?? 20,
        doors,
        barClose,
        allOut,
        endDate: endNightFor(date, doors, allOut),
        gear: e.gear ?? 200,
        adv: e.adv ?? 100,
        sound: e.sound ?? 'inhouse',
        crew: 6,
        tok: 2,
        split: 0.62,
        brief: e.brief ?? null,
      },
    })

    // Artists. Status follows the prototype: once the creative is briefed the
    // first four are confirmed and the rest pencilled; before it, the first two.
    const pa = e.pa ?? DEFAULT_PA
    await db.eventArtist.createMany({
      data: pa.map((p, i) => ({
        eventId: created.id,
        name: p.name,
        low: p.low,
        high: p.high,
        order: i,
        status: (e.briefed
          ? i < 4
            ? 'CONFIRMED'
            : 'PENCILLED'
          : i < 2
            ? 'CONFIRMED'
            : 'ENQUIRED') as ArtistStatus,
      })),
    })

    // The house's standard off-site work unless the event says otherwise — the
    // same list the enquiry form gives a new event, so the seed and the product
    // cannot disagree about what an event is planned with. The prototype writes
    // `actual: 0` to mean "nothing logged yet". That is what a nullable column
    // is for — and it matters, because finance.ts reads `actual ?? est`, so a
    // stored 0 would wipe the estimate out of the wage line.
    const tasks = e.tasks ?? HOUSE_TASKS.map((t) => ({ team: t.name, est: t.est, actual: null }))
    await db.task.createMany({
      data: tasks.map((t) => ({
        eventId: created.id,
        name: t.team,
        est: t.est,
        actual: t.actual,
      })),
    })

    const plan = shiftPlan(rosterEventFor(e, lateBar))
    const filled = e.filled ?? plan.length
    const assigned: { role: string; person: string }[] = []
    for (const [i, s] of plan.entries()) {
      const isFilled = i < filled
      const who = isFilled ? pickFor(s.role, assigned) : null
      if (who) assigned.push({ role: s.role, person: who })
      const personId = who ? (personByInitials.get(who) ?? null) : null

      const shift = await db.shift.create({
        data: {
          eventId: created.id,
          role: s.role,
          hours: s.hours,
          start: s.start,
          personId,
          state: isFilled ? 'ASSIGNED' : 'OPEN',
          asked: 4,
        },
      })

      // An assigned shift carries its hours. The product enforces this —
      // assigning writes the entry, unassigning removes it, in one
      // transaction (src/app/(app)/roster/actions.ts) — so seed data that
      // skipped it would be data the product could never have produced, and
      // every on-site figure would read zero.
      if (personId) {
        await db.hourEntry.create({
          data: {
            personId,
            eventId: created.id,
            shiftId: shift.id,
            hours: s.hours,
            // The shift's own role, not a team: "Sound — Lead" is what the
            // person actually did, and it is what their timesheet should say.
            role: s.role,
            workedOn: date,
          },
        })
      }
    }

    // When tickets went live. Three weeks before the night, but never later
    // than this event last moved on.
    const onSaleAt = new Date(
      Math.min(addDays(today, -e.sinceDays).getTime(), addDays(date, -21).getTime()),
    )

    // The bar budget, for every event already on sale — locked as tickets
    // going live locks it in the product (`pushChannel`, in
    // src/app/(app)/promo/actions.ts), off the settlement's own figures. Only `att`, `scen` and `barHead` reach
    // the two figures a budget takes from `financeVals` — heads and the bar
    // margin line — so the rest of the input is zero rather than assembled for
    // a projection nothing here reads. Nobody's initials, as with the actuals:
    // the seed locked nothing.
    if (e.onSale) {
      const barHead = e.barHead ?? 20
      const vals = financeVals({
        dow: date.getDay(),
        std: 0,
        door: 0,
        mix: [0.25, 0.25, 0.25, 0.25],
        att,
        scen: 1,
        barHead,
        gear: 0,
        adv: 0,
        sound: null,
        crew: 0,
        tok: 0,
        split: 0,
        artists: [],
        shifts: [],
        tasks: [],
        addons: [],
        orgShareHours: 0,
      })
      const labourHours = plan.filter((s) => isBarRole(s.role)).reduce((n, s) => n + s.hours, 0)

      await db.barBudget.create({
        data: {
          eventId: created.id,
          ...barBudgetFrom({ vals, barHead, labourHours }),
          basis: 'ON_SALE',
          lockedAt: onSaleAt,
        },
      })
    }

    // Department leads, handed out as the prototype hands them out: ticketing
    // at confirmation, design and tech when the creative is briefed, promo when
    // tickets go on sale. A part that has not got there has nobody, which is
    // what its gates test for.
    const confirmed = e.booking === 'confirmed'
    const leads: [string, string, boolean][] = [
      ['TICKETING', 'MT', confirmed],
      ['DESIGN', 'TW', e.briefed ?? false],
      ['PROMO', 'TW', e.onSale ?? false],
      ['TECH', 'JR', e.briefed ?? false],
    ]
    for (const [role, who, has] of leads) {
      if (!has) continue
      const personId = personByInitials.get(who)
      if (!personId) continue
      await db.eventLead.create({
        data: { eventId: created.id, role: role as never, personId },
      })
    }

    // The design set. `approved` pieces are signed off and the next one along
    // is the one up for sign-off — but only once the creative is briefed. A
    // confirmed event with nothing briefed has nothing in front of anyone yet,
    // which is what "no creative brief yet" on the pipeline is describing.
    // Pieces a promoter sent early are in whatever the booking says.
    const signedOff = e.approved ?? 0
    await db.asset.createMany({
      data: ASSET_SET.map((a, i) => ({
        eventId: created.id,
        key: a.key,
        state: (e.pieces?.[a.key] ??
          (i < signedOff
            ? 'APPROVED'
            : i === signedOff && e.briefed
              ? 'REVIEW'
              : 'DRAFT')) as never,
      })),
    })

    // Channel spread. Everything that syncs itself goes out at confirmation,
    // except Gather.rsvp: that is the tickets, and it is live only once the
    // event is on sale. The two listings that need a human are ticked off then
    // too.
    const twId = personByInitials.get('TW') ?? null
    await db.channelPush.createMany({
      data: PLATFORMS.map((pl) => {
        const auto = pl.kind === 'api'
        const live =
          pl.key === 'gather' ? (e.onSale ?? false) : confirmed && (auto || (e.onSale ?? false))
        const byHand = live && !auto
        return {
          eventId: created.id,
          channel: pl.key,
          live,
          stale: false,
          note: channelNote(e, pl.key, cap),
          byId: byHand ? twId : null,
          at: live
            ? pl.key === 'gather' || byHand
              ? onSaleAt
              : addDays(today, -e.sinceDays)
            : null,
        }
      }),
    })

    // Slow Fold is the worked example: two listings drifted after the room was
    // upsized and the start time moved, and nobody has re-pushed them.
    if (e.id === 'sf') {
      await db.channelPush.updateMany({
        where: { eventId: created.id, channel: { in: ['facebook-event', 'eventfinda'] } },
        data: { stale: true },
      })
    }

    // Ticket sales, by day and tier — a plausible history for every event
    // that has sold anything, ending on the same total as `e.sold` so the
    // sales-over-time chart and the revenue headline agree (see
    // src/lib/gather-seed.ts and its test for the exactness guarantee). The
    // window runs from the same on-sale moment the bar budget locks at to
    // today, capped at the night itself for a concluded event — nothing
    // sells to a door that has already passed.
    if ((e.sold ?? 0) > 0) {
      const historyEnd = date.getTime() < today.getTime() ? date : today
      const history = plausibleSalesHistory({
        sold: e.sold!,
        mix: [0.2, 0.4, 0.15, 0.25],
        since: onSaleAt,
        today: historyEnd,
      })
      await db.ticketSaleDay.createMany({
        data: history.map((r) => ({
          eventId: created.id,
          day: r.day,
          tier: r.tier,
          sold: r.sold,
        })),
      })
    }

    // Codes and the door list — T6, T7. Slow Fold is the worked example: a
    // live percent-off code, and a door list whose COMP entries (5 people)
    // stand in for the flat 6 typed as `crew` above, so Finance's comps
    // line for this event is already reading the list, not the guess — see
    // `compsCountFor` in src/lib/door-list.ts.
    if (e.id === 'sf') {
      await db.ticketCode.create({
        data: {
          eventId: created.id,
          code: 'LOCALS10',
          kind: 'PERCENT_OFF',
          value: 10,
          useLimit: 30,
          uses: 12,
          who: 'Mere Tapu',
          createdById: 'mt',
        },
      })
      await db.doorListEntry.createMany({
        data: [
          {
            eventId: created.id,
            name: 'Kōura Records guest list',
            partySize: 2,
            kind: 'COMP',
            note: 'label guests',
            who: 'Mere Tapu',
            addedById: 'mt',
          },
          {
            eventId: created.id,
            name: 'Harbour Static guest list',
            partySize: 3,
            kind: 'COMP',
            note: 'opening act',
            who: 'Mere Tapu',
            addedById: 'mt',
          },
          {
            eventId: created.id,
            name: 'Night Owl PR',
            partySize: 1,
            kind: 'INDUSTRY',
            note: null,
            who: 'Mere Tapu',
            addedById: 'mt',
          },
          {
            eventId: created.id,
            name: 'Aroha Ngata',
            partySize: 2,
            kind: 'GUEST',
            note: null,
            who: 'Mere Tapu',
            addedById: 'mt',
          },
        ],
      })
    }

    await db.beat.createMany({
      data: BEATS.map((b, i) => ({
        eventId: created.id,
        key: b.key,
        // Announce and on sale are worked by the time tickets are live.
        done: (e.onSale ?? false) && i < 2,
      })),
    })

    if (e.actual) {
      // Both halves, entered by hand, as they would have been on the night.
      // Nobody's initials: the seed did not count anything, and a stamp naming
      // somebody would be a claim about a person that is not true.
      const at = addDays(date, 1)
      await db.actual.create({
        data: {
          eventId: created.id,
          ...e.actual,
          doorSource: 'MANUAL',
          doorReconciledAt: at,
          barSource: 'MANUAL',
          barReconciledAt: at,
        },
      })
    }

    await db.financeReview.create({
      data: {
        eventId: created.id,
        state: e.onSale || e.concluded ? 'APPROVED' : 'PENDING',
        by: e.onSale || e.concluded ? 'SL' : null,
        when: e.onSale || e.concluded ? onSaleAt : null,
      },
    })

    await db.activity.create({
      data: {
        eventId: created.id,
        who: '—',
        text: 'Event record created from the seed',
        at: addDays(today, -e.sinceDays),
      },
    })
  }

  // The organisations outside promoters act for. Scope is `Event.promoterId`
  // matched against `User.organisationId` (src/lib/scope.ts), and until now
  // only the migration that introduced those columns ever filled them in — so
  // on a freshly seeded database Awhina and Devon saw no events at all, and
  // could not have started an enquiry, which needs an organisation to belong
  // to. The same three steps as that migration's backfill, in the same order.
  console.log('organisations…')

  // 1. One per distinct outside promoter. An internal event's promoter text
  // names a staff member ("internal · Ana Kelliher"), not an organisation.
  const outside = EVENTS.filter((e) => !e.internal && e.promoter.trim() !== '')
  const organisationIds = new Map<string, string>()
  for (const name of new Set(outside.map((e) => e.promoter.trim()))) {
    const row = await db.payee.create({ data: { kind: 'PROMOTER', name, country: 'NZ' } })
    organisationIds.set(name, row.id)
  }

  // 2. Point each of their events at it.
  for (const e of outside) {
    await db.event.update({
      where: { id: e.id },
      data: { promoterId: organisationIds.get(e.promoter.trim()) },
    })
  }

  // 3. Point each outside account at theirs, by exact name. Anything that does
  // not match is left null, which fails closed: that account sees nothing until
  // somebody links it. Failing open here would be a disclosure.
  for (const u of USERS) {
    const organisationId = u.org ? organisationIds.get(u.org) : undefined
    if (organisationId) await db.user.update({ where: { id: u.id }, data: { organisationId } })
  }

  // Org-wide labour, pooled by month and apportioned across that month's
  // events. Seeded as hour entries with no event, exactly as the prototype's
  // `kind: 'org'` entries are.
  console.log('org hours…')
  const orgHours: [string, string, number, number][] = [
    ['SL', 'Grant writing & reporting — Creative NZ quarterly report', 11, 0],
    ['SL', 'Venue administration — insurance renewal, IRD, payroll', 8, 0],
    ['AK', 'Bar admin & accounting — stocktake and supplier reconciliation', 6, 0],
    ['AK', 'Maintenance & working bees — cellar shelving and lines clean', 5, 1],
    ['SL', 'Governance & meetings — board meeting and minutes', 3, 1],
  ]
  for (const [who, line, hours, monthOffset] of orgHours) {
    const at = new Date(today)
    at.setMonth(at.getMonth() + monthOffset)

    // The role is its own column rather than a prefix on the note: the
    // monthly pool groups by it, and reading wages out of free text is the
    // kind of thing that breaks quietly. See src/lib/hours.ts.
    const [role, ...rest] = line.split(' — ')
    await db.hourEntry.create({
      data: {
        personId: personByInitials.get(who)!,
        hours,
        role,
        note: rest.join(' — ') || null,
        workedOn: at,
        createdAt: at,
      },
    })
  }

  const counts = {
    people: await db.person.count(),
    users: await db.user.count(),
    events: await db.event.count(),
    shifts: await db.shift.count(),
    tasks: await db.task.count(),
    artists: await db.eventArtist.count(),
    assets: await db.asset.count(),
    channels: await db.channelPush.count(),
    beats: await db.beat.count(),
    leads: await db.eventLead.count(),
    ticketSaleDays: await db.ticketSaleDay.count(),
    ticketCodes: await db.ticketCode.count(),
    doorListEntries: await db.doorListEntry.count(),
    venueSpecComponents: await db.venueSpecComponent.count(),
  }
  console.log('seeded', counts)
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err)
    await db.$disconnect()
    process.exit(1)
  })
