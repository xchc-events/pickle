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
 */

import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Role, type ArtistStatus } from '../src/generated/prisma/client'
import { DEFAULT_PERMS, type RoleKey } from '../src/lib/constants'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

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

const ROLE_WIN: Record<string, [number, number]> = {
  'Duty manager': [3, 6],
  'Bar staff': [3.5, 5],
  'Sound — Lead': [0, 8],
  'Sound — 2IC': [2, 5],
  'Lighting — Lead': [2, 3],
  Door: [3.75, 3.5],
  'Care team': [5, 2.5],
  'Set-up crew': [0, 0.75],
  'Clean-up crew': [9, 0.75],
}
const ROLE_WIN_EARLY: Record<string, [number, number]> = {
  'Duty manager': [2, 5.5],
  'Bar staff': [2.5, 4.5],
  'Sound — Lead': [0, 6.5],
  'Sound — 2IC': [1.5, 4],
  'Lighting — Lead': [1.5, 2.5],
  Door: [2.75, 3],
  'Care team': [3.5, 2],
  'Set-up crew': [0, 0.75],
  'Clean-up crew': [7.5, 0.75],
}

// ----------------------------------------------------------------- events ---

type SeedEvent = {
  id: string
  name: string
  dow: string
  days: number
  stage: number
  stageDays: number
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

// The prototype writes `actual: 0` to mean "nothing logged yet". That is what
// a nullable column is for — and it matters, because finance.ts reads
// `actual ?? est`, so a stored 0 would wipe the estimate out of the wage line.
const DEFAULT_TASKS = [
  { team: 'Event coordination', est: 9, actual: null },
  { team: 'Design & comms', est: 6, actual: null },
  { team: 'Comms / socials', est: 3, actual: null },
  { team: 'Production management', est: 1.5, actual: null },
  { team: 'Bar admin & accounting', est: 3, actual: null },
]

const EVENTS: SeedEvent[] = [
  {
    id: 'ssr',
    name: 'Sunday Slow Roast',
    internal: true,
    promoter: 'internal · Ana Kelliher',
    owner: 'AK',
    dow: 'Sun',
    days: 3,
    stage: 6,
    stageDays: 1,
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
    internal: true,
    promoter: 'internal · Mere Tapu',
    owner: 'MT',
    dow: 'Fri',
    days: 8,
    stage: 5,
    stageDays: 6,
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
    promoter: 'Kōura Records',
    dow: 'Sat',
    days: 16,
    stage: 4,
    stageDays: 4,
    format: 'Live music',
    owner: 'MT',
    space: 'Main + Apartment U1',
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
    promoter: 'Hex Collective',
    dow: 'Sat',
    days: 23,
    stage: 3,
    stageDays: 6,
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
    promoter: 'Puha Sound',
    dow: 'Fri',
    days: 29,
    stage: 3,
    stageDays: 2,
    format: 'DJs',
    owner: 'SP',
    sold: 31,
    kind: 'djs',
    licence: 'applied',
  },
  {
    id: 'dtm',
    name: 'Dust to Mountains',
    internal: true,
    promoter: 'internal · Jonty Rewi',
    owner: 'JR',
    dow: 'Thu',
    days: 35,
    stage: 2,
    stageDays: 9,
    format: 'Live music',
    space: 'Main + Apartment U1',
    kind: 'live',
    risk: 'Confirmed 9d, no creative brief yet',
    riskKind: 'warn',
  },
  {
    id: 'wl',
    name: 'Wax Lyrical #12',
    promoter: 'Puha Sound',
    dow: 'Sat',
    days: 37,
    stage: 1,
    stageDays: 3,
    format: 'DJs',
    owner: 'SP',
    kind: 'djs',
  },
  {
    id: 'kr',
    name: 'Kōwhai Rooms residency',
    internal: true,
    promoter: 'internal · Ana Kelliher',
    owner: 'AK',
    dow: 'Wed',
    days: 41,
    stage: 1,
    stageDays: 1,
    format: 'Cabaret',
    space: 'Apartment U1',
    std: 20,
    door: 25,
    kind: 'workshop',
    licence: 'none',
    lateBar: false,
  },
  {
    id: 'chr',
    name: 'Care & Harm Reduction hui',
    internal: true,
    promoter: 'internal · unassigned',
    owner: null,
    dow: 'Tue',
    days: 12,
    stage: 0,
    stageDays: 2,
    format: 'Cabaret',
    space: 'Apartment U1',
    std: 0,
    door: 0,
    kind: 'workshop',
    licence: 'none',
    lateBar: false,
  },
  {
    id: 'ns',
    name: 'Nightshade (Halloween)',
    promoter: 'Hex Collective',
    dow: 'Fri',
    days: 71,
    stage: 0,
    stageDays: 1,
    format: 'DJs + live',
    owner: null,
    kind: 'live-djs',
  },
  {
    id: 'apt',
    name: 'Kiwa Trio — listening room',
    promoter: 'Kōura Records',
    dow: 'Fri',
    days: 8,
    stage: 4,
    stageDays: 3,
    format: 'Cabaret',
    space: 'Apartment U1',
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
    internal: true,
    promoter: 'internal · Ana Kelliher',
    owner: 'AK',
    dow: 'Sun',
    days: -14,
    stage: 7,
    stageDays: 4,
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
    promoter: 'Puha Sound',
    dow: 'Sat',
    days: -8,
    stage: 7,
    stageDays: 2,
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

function rolesFor(e: SeedEvent, spaceName: string): string[] {
  const apt = spaceName === 'Apartment U1'
  const workshop = e.kind === 'workshop'
  if (apt) {
    return [
      'Duty manager',
      'Bar staff',
      'Sound — Lead',
      'Door',
      'Care team',
      'Set-up crew',
      'Clean-up crew',
    ]
  }
  const cap = e.format === 'Cabaret' ? 150 : 220
  const likely = e.att ? e.att[1] : Math.round(cap * 0.62)
  const roles = ['Duty manager', 'Bar staff']
  if (likely > 140) roles.push('Bar staff')
  roles.push('Sound — Lead')
  if (e.kind === 'live' || e.kind === 'live-djs') roles.push('Sound — 2IC')
  roles.push('Lighting — Lead', 'Door')
  if (!workshop) roles.push('Door')
  roles.push('Care team')
  if (!workshop) roles.push('Care team')
  roles.push('Set-up crew', 'Set-up crew', 'Clean-up crew', 'Clean-up crew')
  return roles
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

// ------------------------------------------------------------------- main ---

async function main() {
  const today = startOfToday()

  console.log('clearing…')
  await db.activity.deleteMany()
  await db.hourEntry.deleteMany()
  await db.shift.deleteMany()
  await db.task.deleteMany()
  await db.addon.deleteMany()
  await db.eventArtist.deleteMany()
  await db.financeReview.deleteMany()
  await db.actual.deleteMany()
  await db.event.deleteMany()
  await db.space.deleteMany()
  await db.availability.deleteMany()
  await db.user.deleteMany()
  await db.person.deleteMany()
  await db.modulePermission.deleteMany()

  console.log('permissions…')
  for (const [role, mods] of Object.entries(DEFAULT_PERMS)) {
    for (const m of mods) {
      await db.modulePermission.create({
        data: { role: role.toUpperCase() as Role, module: m },
      })
    }
  }

  console.log('people…')
  const personByInitials = new Map<string, string>()
  for (const p of PEOPLE) {
    const row = await db.person.create({
      data: { name: p.n, initials: p.i },
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
      },
    })
  }

  console.log('spaces…')
  const spaceIds = new Map<string, string>()
  for (const [name, capacity] of [
    ['Main', 220],
    ['Apartment U1', 40],
    ['Main + Apartment U1', 220],
  ] as [string, number][]) {
    const row = await db.space.create({ data: { name, capacity } })
    spaceIds.set(name, row.id)
  }

  console.log('events…')
  for (const e of EVENTS) {
    const spaceName = e.space ?? 'Main'
    const date = seedDate(today, e.days, e.dow)
    const lateBar = e.lateBar !== false
    const cap = spaceName === 'Apartment U1' ? 40 : e.format === 'Cabaret' ? 150 : 220
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
        stage: e.stage,
        stageEnteredAt: addDays(today, -e.stageDays),
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
        barClose: lateBar ? '12:00am' : '11:00pm',
        gear: e.gear ?? 200,
        adv: e.adv ?? 100,
        sound: e.sound ?? 'inhouse',
        crew: 6,
        tok: 2,
        split: 0.62,
      },
    })

    // Artists. Status follows the prototype: past Design the first four are
    // confirmed and the rest pencilled; before it, the first two are confirmed.
    const pa = e.pa ?? DEFAULT_PA
    await db.eventArtist.createMany({
      data: pa.map((p, i) => ({
        eventId: created.id,
        name: p.name,
        low: p.low,
        high: p.high,
        order: i,
        status: (e.stage >= 3
          ? i < 4
            ? 'CONFIRMED'
            : 'PENCILLED'
          : i < 2
            ? 'CONFIRMED'
            : 'ENQUIRED') as ArtistStatus,
      })),
    })

    await db.task.createMany({
      data: (e.tasks ?? DEFAULT_TASKS).map((t) => ({
        eventId: created.id,
        name: t.team,
        est: t.est,
        actual: t.actual,
      })),
    })

    const win = lateBar ? ROLE_WIN : ROLE_WIN_EARLY
    const roles = rolesFor(e, spaceName)
    const filled = e.filled ?? roles.length
    const assigned: { role: string; person: string }[] = []
    for (const [i, role] of roles.entries()) {
      const w = win[role] ?? [3, 4]
      let hours = w[1]
      if (e.kind === 'workshop' && role === 'Sound — Lead') {
        hours = spaceName === 'Apartment U1' ? 3 : 4
      }
      const isFilled = i < filled
      const who = isFilled ? pickFor(role, assigned) : null
      if (who) assigned.push({ role, person: who })
      await db.shift.create({
        data: {
          eventId: created.id,
          role,
          hours,
          start: w[0],
          personId: who ? (personByInitials.get(who) ?? null) : null,
          state: isFilled ? 'ASSIGNED' : 'OPEN',
          asked: 4,
        },
      })
    }

    if (e.actual) {
      await db.actual.create({ data: { eventId: created.id, ...e.actual } })
    }

    await db.financeReview.create({
      data: {
        eventId: created.id,
        state: e.stage >= 4 || e.concluded ? 'APPROVED' : 'PENDING',
        by: e.stage >= 4 || e.concluded ? 'SL' : null,
        when: e.stage >= 4 || e.concluded ? addDays(today, -e.stageDays) : null,
      },
    })

    await db.activity.create({
      data: {
        eventId: created.id,
        who: '—',
        text: 'Event record created from the seed',
        at: addDays(today, -e.stageDays),
      },
    })
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
  for (const [who, note, hours, monthOffset] of orgHours) {
    const at = new Date(today)
    at.setMonth(at.getMonth() + monthOffset)
    await db.hourEntry.create({
      data: { personId: personByInitials.get(who)!, hours, note, createdAt: at },
    })
  }

  const counts = {
    people: await db.person.count(),
    users: await db.user.count(),
    events: await db.event.count(),
    shifts: await db.shift.count(),
    tasks: await db.task.count(),
    artists: await db.eventArtist.count(),
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
