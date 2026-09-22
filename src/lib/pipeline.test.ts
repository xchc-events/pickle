import { describe, expect, it } from 'vitest'
import {
  attentionOf,
  daysBetween,
  labourSplit,
  metaLine,
  partHeads,
  partTitle,
  pipelineRows,
  pipelineSubline,
  runLine,
  type PipelineEvent,
} from './pipeline'
import { PARTS, type PartKey, type PartState } from './parts'
import { eventScope } from './scope'
import { initialsOf, money } from './format'
import { PLANNED_HOUR_COST } from './finance'

/**
 * Eight finished parts, with whichever ones a test cares about overridden.
 * The pipeline reads parts that src/lib/parts.ts has already worked out, so
 * these tests hand it the result rather than the records behind it.
 */
const parts = (over: Partial<Record<PartKey, Partial<PartState>>> = {}): PartState[] =>
  PARTS.map((p) => ({
    ...p,
    status: 'done',
    detail: null,
    tone: 'good',
    applies: true,
    clear: true,
    done: true,
    checks: [],
    ...over[p.key],
  }))

const ev = (over: Partial<PipelineEvent> = {}): PipelineEvent => ({
  id: 'x',
  name: 'An event',
  promoter: 'Puha Sound',
  format: 'DJs',
  spaceName: 'Main',
  concluded: false,
  booking: 'confirmed',
  daysToDoor: 20,
  date: new Date(2026, 8, 27),
  endDate: null,
  doors: '7:00 pm',
  allOut: '11:30 pm',
  riskNote: null,
  riskKind: 'warn',
  ownerInitials: 'MT',
  ownerName: 'Mere Tapu',
  ownerAccent: true,
  extCoordInitials: null,
  extCoordName: null,
  surplus: 0,
  actualTotal: null,
  hours: 0,
  taskHours: [],
  onSiteHours: 0,
  parts: parts(),
  ...over,
})

describe('daysBetween', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    const late = new Date(2026, 7, 31, 23, 30)
    const early = new Date(2026, 8, 1, 0, 30)
    expect(daysBetween(late, early)).toBe(1)
  })

  it('is negative once the date is past', () => {
    expect(daysBetween(new Date(2026, 8, 10), new Date(2026, 8, 3))).toBe(-7)
  })
})

describe('metaLine', () => {
  it('gives the risk note the line when there is one', () => {
    expect(metaLine(ev({ riskNote: 'Artwork awaiting sign-off 6d' }))).toBe(
      'Artwork awaiting sign-off 6d',
    )
  })

  it('otherwise names the internal owner, the format and the room', () => {
    expect(metaLine(ev({ ownerName: 'Ana Kelliher', extCoordName: null }))).toBe(
      'Ana Kelliher · DJs · Main',
    )
  })

  it('adds the external coordinator when there is one', () => {
    expect(
      metaLine(ev({ ownerName: 'Ana Kelliher', extCoordName: 'Kōura Records', format: 'Cabaret' })),
    ).toBe('Ana Kelliher · Kōura Records · Cabaret · Main')
  })

  it('says "no owner yet" — Connor did not want "internal" (23 Sep 2026)', () => {
    expect(metaLine(ev({ ownerName: null, extCoordName: null }))).toBe('no owner yet · DJs · Main')
  })

  it('keeps the external coordinator even with no internal owner yet', () => {
    expect(metaLine(ev({ ownerName: null, extCoordName: 'Kōura Records' }))).toBe(
      'no owner yet · Kōura Records · DJs · Main',
    )
  })

  it('lets the risk note win over a missing owner too', () => {
    expect(metaLine(ev({ ownerName: null, riskNote: 'stuck' }))).toBe('stuck')
  })
})

describe('runLine', () => {
  it('gives the date and the run from doors to everyone out', () => {
    expect(runLine(ev({ date: new Date(2026, 8, 27), doors: '7:00 pm', allOut: '11:30 pm' }))).toBe(
      'Sun 27 Sep · 7:00 pm – 11:30 pm',
    )
  })

  it('spans the date when the end date is a different day', () => {
    expect(
      runLine(
        ev({
          date: new Date(2026, 8, 27),
          endDate: new Date(2026, 8, 28),
          doors: '7:00 pm',
          allOut: '1:30 am',
        }),
      ),
    ).toBe('Sun 27 Sep – Mon 28 Sep · 7:00 pm – 1:30 am')
  })

  it('does not span the date when the end date is the same day', () => {
    expect(
      runLine(
        ev({
          date: new Date(2026, 8, 27),
          endDate: new Date(2026, 8, 27),
          doors: '7:00 pm',
          allOut: '11:30 pm',
        }),
      ),
    ).toBe('Sun 27 Sep · 7:00 pm – 11:30 pm')
  })

  it('prints only doors when everyone out is not set', () => {
    expect(runLine(ev({ date: new Date(2026, 8, 27), doors: '7:00 pm', allOut: null }))).toBe(
      'Sun 27 Sep · doors 7:00 pm',
    )
  })

  it('prints only everyone out when doors is not set', () => {
    expect(runLine(ev({ date: new Date(2026, 8, 27), doors: null, allOut: '1:30 am' }))).toBe(
      'Sun 27 Sep · out 1:30 am',
    )
  })

  it('prints only the date when neither time is set', () => {
    expect(runLine(ev({ date: new Date(2026, 8, 27), doors: null, allOut: null }))).toBe(
      'Sun 27 Sep',
    )
  })
})

describe('partTitle', () => {
  it('says where the part stands and what holds it up', () => {
    const p = parts({
      design: {
        status: '2 of 6',
        detail: 'in review',
        checks: [
          { label: 'Design lead assigned', ok: true, why: '', screen: 'event' },
          { label: 'Event cover signed off', ok: false, why: '', screen: 'design' },
          { label: 'Listing copy signed off', ok: false, why: '', screen: 'design' },
        ],
      },
    }).find((x) => x.key === 'design')!
    expect(partTitle(p)).toBe(
      'Design: 2 of 6, in review. 1 of 3 clear — held up by event cover signed off, listing copy signed off',
    )
  })

  it('stops at the count when everything is clear', () => {
    const p = parts({
      roster: {
        status: 'filled',
        checks: [{ label: 'Every shift filled', ok: true, why: '', screen: 'roster' }],
      },
    }).find((x) => x.key === 'roster')!
    expect(partTitle(p)).toBe('Roster: filled. 1 of 1 clear')
  })

  it('leaves the count off a part with no gates', () => {
    const p = parts({ booking: { status: 'confirmed' } }).find((x) => x.key === 'booking')!
    expect(partTitle(p)).toBe('Booking: confirmed')
  })

  it('leaves the gates off a part that is nothing to do yet', () => {
    // A settlement before the night fails "Actuals in" by definition. Saying
    // so on hover reads as something to chase when there is nothing to chase.
    const p = parts({
      settlement: {
        status: 'not yet',
        applies: false,
        done: false,
        checks: [{ label: 'Actuals in', ok: false, why: '', screen: 'event' }],
      },
    }).find((x) => x.key === 'settlement')!
    expect(partTitle(p)).toBe('Settlement: not yet')
  })

  it('keeps a name a gate carries, lowering only the first letter', () => {
    const p = parts({
      tickets: {
        status: 'priced',
        checks: [{ label: 'Tickets live on Gather.rsvp', ok: false, why: '', screen: 'promo' }],
      },
    }).find((x) => x.key === 'tickets')!
    expect(partTitle(p)).toBe(
      'Tickets: priced. 0 of 1 clear — held up by tickets live on Gather.rsvp',
    )
  })
})

describe('attentionOf', () => {
  it('counts a warning once and a blocked part twice', () => {
    const e = ev({
      parts: parts({
        promo: { tone: 'warn' },
        licence: { tone: 'stop' },
        design: { tone: 'plain' },
      }),
    })
    expect(attentionOf(e)).toBe(3)
  })

  it('adds the coordinator’s own flag, weighted the same way', () => {
    expect(attentionOf(ev({ riskNote: 'stuck', riskKind: 'warn' }))).toBe(1)
    expect(attentionOf(ev({ riskNote: 'stuck', riskKind: 'stop' }))).toBe(2)
  })

  it('is zero for an event nothing is wrong with', () => {
    expect(attentionOf(ev())).toBe(0)
  })
})

describe('pipelineRows', () => {
  const all = [
    ev({ id: 'near', daysToDoor: 3, ownerInitials: 'AK' }),
    ev({
      id: 'far',
      daysToDoor: 60,
      ownerInitials: 'MT',
      parts: parts({ licence: { tone: 'stop' } }),
    }),
    ev({ id: 'risky', daysToDoor: 20, riskNote: 'stuck', ownerInitials: 'MT' }),
    ev({
      id: 'mid',
      daysToDoor: 8,
      ownerInitials: 'AK',
      parts: parts({ promo: { tone: 'warn' } }),
    }),
    ev({ id: 'done', daysToDoor: -8, concluded: true }),
  ]
  const base = { status: 'all', sort: 'door', meInitials: 'MT' } as const

  it('hides concluded events from every live view', () => {
    expect(pipelineRows(all, base).map((r) => r.id)).not.toContain('done')
  })

  it('sorts by days to door, soonest first', () => {
    expect(pipelineRows(all, base).map((r) => r.id)).toEqual(['near', 'mid', 'risky', 'far'])
  })

  it('sorts by what needs attention, soonest door first among equals', () => {
    const rows = pipelineRows(all, { ...base, sort: 'attention' })
    expect(rows.map((r) => r.id)).toEqual(['far', 'mid', 'risky', 'near'])
  })

  it('filters to mine by owner', () => {
    expect(pipelineRows(all, { ...base, status: 'mine' }).map((r) => r.id)).toEqual([
      'risky',
      'far',
    ])
  })

  it('filters to at-risk by the presence of a note', () => {
    expect(pipelineRows(all, { ...base, status: 'risk' }).map((r) => r.id)).toEqual(['risky'])
  })

  it('filters to the next 30 days', () => {
    expect(pipelineRows(all, { ...base, status: 'soon' }).map((r) => r.id)).toEqual([
      'near',
      'mid',
      'risky',
    ])
  })

  it('shows concluded events only under the Concluded filter', () => {
    expect(pipelineRows(all, { ...base, status: 'done' }).map((r) => r.id)).toEqual(['done'])
  })

  it('builds the Concluded set from every event, not from the live ones', () => {
    // The quirk kept from the prototype: "done" replaces the row set outright
    // rather than narrowing it. Concluded events are filtered out at the top,
    // so this only returns anything because it re-reads from `all`.
    expect(pipelineRows(all, { ...base, status: 'done' }).map((r) => r.id)).toEqual(['done'])
  })

  it('does not mutate the array it is given', () => {
    const before = all.map((e) => e.id)
    pipelineRows(all, { ...base, sort: 'attention' })
    expect(all.map((e) => e.id)).toEqual(before)
  })
})

describe('partHeads', () => {
  it('counts, per part, the live events still to finish it', () => {
    const heads = partHeads([
      ev({ parts: parts({ design: { done: false }, tickets: { done: false } }) }),
      ev({ parts: parts({ design: { done: false } }) }),
      ev({ parts: parts({ design: { done: false } }), concluded: true }),
    ])
    expect(heads).toHaveLength(8)
    expect(heads.map((h) => h.label)).toEqual(PARTS.map((p) => p.label))
    expect(heads.find((h) => h.key === 'design')!.toGo).toBe(2)
    expect(heads.find((h) => h.key === 'tickets')!.toGo).toBe(1)
    expect(heads.find((h) => h.key === 'roster')!.toGo).toBe(0)
  })

  it('does not count a part that is nothing to do on that event', () => {
    // A licence the bar close does not need is not a licence still to get.
    const heads = partHeads([ev({ parts: parts({ licence: { done: false, applies: false } }) })])
    expect(heads.find((h) => h.key === 'licence')!.toGo).toBe(0)
  })

  it('calls the bookings still to confirm unconfirmed, and every other part to go', () => {
    // "Four to go" on Booking read as nothing; Connor called them "four
    // unconfirmed" (22 Sep 2026). The other columns keep their count.
    const heads = partHeads([
      ev({ parts: parts({ booking: { done: false }, design: { done: false } }) }),
      ev({ parts: parts({ booking: { done: false } }) }),
    ])
    expect(heads.find((h) => h.key === 'booking')!.count).toBe('2 unconfirmed')
    expect(heads.find((h) => h.key === 'design')!.count).toBe('1 to go')
    expect(heads.find((h) => h.key === 'roster')!.count).toBe('0 to go')
  })

  it('carries the stage nickname a part inherited, for the column head', () => {
    expect(partHeads([]).find((h) => h.key === 'design')!.nick).toBe('Labelling')
  })
})

describe('labourSplit', () => {
  it('pools task hours by team and shift hours as on-site crew', () => {
    const rows = labourSplit([
      ev({
        taskHours: [
          { team: 'Event coordination', hours: 6 },
          { team: 'Design & comms', hours: 2 },
        ],
        onSiteHours: 10,
      }),
      ev({ taskHours: [{ team: 'Event coordination', hours: 4 }], onSiteHours: 5 }),
    ])
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['On-site crew', '15h'],
      ['Event coordination', '10h'],
      ['Design & comms', '2h'],
    ])
  })

  it('costs hours at the planned contractor rate, not the base rate', () => {
    // 10h at $35 planned = $350, not 10 × $30.
    const rows = labourSplit([ev({ taskHours: [{ team: 'Admin', hours: 10 }] })])
    expect(rows.find((r) => r.label === 'Admin')!.cost).toBe(`$${10 * PLANNED_HOUR_COST}`)
  })

  it('scales bar widths against the largest team', () => {
    const rows = labourSplit([
      ev({
        taskHours: [
          { team: 'Big', hours: 20 },
          { team: 'Small', hours: 5 },
        ],
      }),
    ])
    expect(rows.find((r) => r.label === 'Big')!.widthPct).toBe(100)
    expect(rows.find((r) => r.label === 'Small')!.widthPct).toBe(25)
  })

  it('leaves concluded events out of the breakdown', () => {
    const rows = labourSplit([ev({ concluded: true, taskHours: [{ team: 'Gone', hours: 9 }] })])
    expect(rows.map((r) => r.label)).not.toContain('Gone')
  })
})

describe('pipelineSubline', () => {
  it('counts events in progress and those at risk', () => {
    const all = [ev({ riskNote: 'stuck' }), ev(), ev({ concluded: true })]
    expect(pipelineSubline(all, 2)).toBe('2 events in progress · 1 at risk · 2 shown')
  })
})

describe('eventScope', () => {
  it('does not narrow the query for venue staff', () => {
    expect(eventScope({ external: false, organisationId: null })).toEqual({})
  })

  it('scopes an external promoter to their organisation by id', () => {
    // An exact match on the relation, never a match on the free-text name.
    expect(eventScope({ external: true, organisationId: 'org_koura' })).toEqual({
      promoterId: 'org_koura',
    })
  })

  it('shows an external user with no org nothing at all', () => {
    // The dangerous failure is returning {} here, which would hand them the
    // whole building.
    expect(eventScope({ external: true, organisationId: null })).toEqual({ id: { in: [] } })
  })

  it('never scopes on a substring of a name', () => {
    // The bug this replaced: `{ promoter: { contains: 'Sound' } }` matched
    // "Puha Sound" and "Wheke Sound" too, so an organisation whose name was a
    // substring of another's read that other organisation's shows — their
    // ticket figures, their terms, their settlements.
    //
    // Asserted structurally rather than by example, because the failure is
    // that a *substring* operator is present at all.
    const clause = eventScope({ external: true, organisationId: 'Sound' })
    expect(JSON.stringify(clause)).not.toContain('contains')
    expect(clause).not.toHaveProperty('promoter')
  })
})

describe('initialsOf', () => {
  it('takes the first letter of the first two names', () => {
    expect(initialsOf('Awhina Reid')).toBe('AR')
    expect(initialsOf('Devon Marsh')).toBe('DM')
  })

  it('copes with one name and with extra names', () => {
    expect(initialsOf('Nio')).toBe('N')
    expect(initialsOf('Te Awa o Waikato')).toBe('TA')
  })

  it('falls back to a dash rather than an empty circle', () => {
    expect(initialsOf('   ')).toBe('\u2014')
  })
})

describe('money', () => {
  it('puts the minus outside the dollar sign', () => {
    expect(money(-2554)).toBe('-$2,554')
    expect(money(2554)).toBe('$2,554')
  })

  it('does not render a negative zero', () => {
    expect(money(-0.2)).toBe('$0')
  })
})
