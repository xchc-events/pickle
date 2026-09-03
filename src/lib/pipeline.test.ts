import { describe, expect, it } from 'vitest'
import {
  daysBetween,
  isPastStageTarget,
  labourSplit,
  metaLine,
  pipelineMetrics,
  pipelineRows,
  pipelineSubline,
  projection,
  stageCells,
  stageCounts,
  type PipelineEvent,
} from './pipeline'
import { eventScope } from './scope'
import { initialsOf, money } from './format'
import { STAGE_TARGET } from './constants'

const ev = (over: Partial<PipelineEvent> = {}): PipelineEvent => ({
  id: 'x',
  name: 'An event',
  promoter: 'Puha Sound',
  format: 'DJs',
  spaceName: 'Main',
  concluded: false,
  stage: 3,
  daysToDoor: 20,
  daysInStage: 2,
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

describe('stage targets', () => {
  it('flags an event that has outstayed its stage', () => {
    // Design has a 5-day target.
    expect(STAGE_TARGET[3]).toBe(5)
    expect(isPastStageTarget(3, 6)).toBe(true)
    expect(isPastStageTarget(3, 5)).toBe(false)
  })

  it('never flags the stages with no target', () => {
    // On sale and Show week run as long as the calendar says.
    expect(isPastStageTarget(4, 40)).toBe(false)
    expect(isPastStageTarget(6, 40)).toBe(false)
  })

  it('matches the seed events the prototype hand-flagged', () => {
    // Every seed event carrying a risk note, and the two nearest that do not.
    expect(isPastStageTarget(5, 6)).toBe(true) // Basement Sessions vol. 4
    expect(isPastStageTarget(3, 6)).toBe(true) // Static Bloom
    expect(isPastStageTarget(2, 9)).toBe(true) // Dust to Mountains
    expect(isPastStageTarget(3, 2)).toBe(false) // Ōtautahi Bass Co-op
    expect(isPastStageTarget(1, 3)).toBe(false) // Wax Lyrical #12
  })
})

describe('projection', () => {
  it('says modelling before terms are agreed', () => {
    expect(projection(ev({ stage: 1, surplus: 9999 })).text).toBe('modelling')
  })

  it('shows the projected surplus once past terms', () => {
    expect(projection(ev({ stage: 2, surplus: 1200 }))).toEqual({
      text: 'proj. $1,200',
      tone: 'good',
    })
  })

  it('does not call a thin surplus good', () => {
    expect(projection(ev({ stage: 2, surplus: 500 })).tone).toBe('muted')
    expect(projection(ev({ stage: 2, surplus: 501 })).tone).toBe('good')
  })

  it('shows what a concluded event actually took', () => {
    expect(projection(ev({ concluded: true, actualTotal: 4035, surplus: -1 }))).toEqual({
      text: 'took $4,035',
      tone: 'good',
    })
  })

  it('formats a loss with the sign outside the dollar', () => {
    expect(projection(ev({ stage: 2, surplus: -320 })).text).toBe('proj. -$320')
  })
})

describe('metaLine', () => {
  it('gives the risk note the line when there is one', () => {
    expect(metaLine(ev({ riskNote: 'Artwork awaiting sign-off 6d' }))).toBe(
      'Artwork awaiting sign-off 6d',
    )
  })

  it('otherwise names the promoter, format and room', () => {
    expect(metaLine(ev())).toBe('Puha Sound · DJs · Main')
  })
})

describe('stageCells', () => {
  it('ticks what is done, counts the current stage, leaves the rest blank', () => {
    const cells = stageCells(2, 9, false)
    expect(cells).toHaveLength(8)
    expect(cells[0]).toMatchObject({ text: '✓', state: 'done' })
    expect(cells[2]).toMatchObject({ text: '9d', state: 'current' })
    expect(cells[3]).toMatchObject({ text: '', state: 'ahead' })
  })

  it('colours only the current cell with the risk', () => {
    const cells = stageCells(2, 9, true)
    expect(cells[2].risky).toBe(true)
    expect(cells.filter((c) => c.risky)).toHaveLength(1)
  })
})

describe('pipelineRows', () => {
  const all = [
    ev({ id: 'near', daysToDoor: 3, daysInStage: 1, ownerInitials: 'AK' }),
    ev({ id: 'far', daysToDoor: 60, daysInStage: 9, ownerInitials: 'MT' }),
    ev({ id: 'risky', daysToDoor: 20, daysInStage: 6, riskNote: 'stuck', ownerInitials: 'MT' }),
    ev({
      id: 'apt',
      daysToDoor: 8,
      daysInStage: 2,
      spaceName: 'Apartment U1',
      ownerInitials: 'AK',
    }),
    ev({ id: 'done', daysToDoor: -8, daysInStage: 2, concluded: true }),
  ]
  const base = { status: 'all', space: 'all', sort: 'door', meInitials: 'MT' } as const

  it('hides concluded events from every live view', () => {
    expect(pipelineRows(all, base).map((r) => r.id)).not.toContain('done')
  })

  it('sorts by days to door, soonest first', () => {
    expect(pipelineRows(all, base).map((r) => r.id)).toEqual(['near', 'apt', 'risky', 'far'])
  })

  it('sorts by time stuck when asked', () => {
    const rows = pipelineRows(all, { ...base, sort: 'stuck' })
    expect(rows.map((r) => r.daysInStage)).toEqual([9, 6, 2, 1])
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
      'apt',
      'risky',
    ])
  })

  it('composes a status filter with a space filter', () => {
    const rows = pipelineRows(all, { ...base, status: 'soon', space: 'apt' })
    expect(rows.map((r) => r.id)).toEqual(['apt'])
  })

  it('shows concluded events only under the Concluded filter', () => {
    expect(pipelineRows(all, { ...base, status: 'done' }).map((r) => r.id)).toEqual(['done'])
  })

  it('lets Concluded override the space chips, as the prototype does', () => {
    // Deliberate: "done" replaces the row set outright rather than narrowing
    // it, so a space chip left selected does not hide concluded events.
    const rows = pipelineRows(all, { ...base, status: 'done', space: 'apt' })
    expect(rows.map((r) => r.id)).toEqual(['done'])
  })

  it('does not mutate the array it is given', () => {
    const before = all.map((e) => e.id)
    pipelineRows(all, { ...base, sort: 'stuck' })
    expect(all.map((e) => e.id)).toEqual(before)
  })
})

describe('stageCounts', () => {
  it('counts live events per stage and ignores concluded ones', () => {
    const counts = stageCounts([
      ev({ stage: 0 }),
      ev({ stage: 0 }),
      ev({ stage: 4 }),
      ev({ stage: 7, concluded: true }),
    ])
    expect(counts).toHaveLength(8)
    expect(counts[0]).toEqual({ label: 'Enquiry', count: 2 })
    expect(counts[4]).toEqual({ label: 'On sale', count: 1 })
    expect(counts[7]).toEqual({ label: 'Payout', count: 0 })
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

  it('costs hours at the loaded rate, not the base rate', () => {
    // 10h at $33.66 loaded = $337, not 10 × $30.
    const rows = labourSplit([ev({ taskHours: [{ team: 'Admin', hours: 10 }] })])
    expect(rows.find((r) => r.label === 'Admin')!.cost).toBe('$337')
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

describe('pipelineMetrics', () => {
  it('counts anything past terms-agreed towards the cost base', () => {
    const m = pipelineMetrics([ev({ stage: 2 }), ev({ stage: 5 }), ev({ stage: 1 })])
    expect(m[3].value).toBe('2 of 18')
    expect(m[3].sub).toBe('covers 11% of the base')
  })

  it('marks the two figures that are not computed yet', () => {
    const m = pipelineMetrics([])
    expect(m.filter((x) => x.placeholder)).toHaveLength(2)
    expect(m[2].placeholder).toBeUndefined()
  })

  it('totals labour hours across live events at the loaded rate', () => {
    const m = pipelineMetrics([
      ev({ hours: 10 }),
      ev({ hours: 5 }),
      ev({ hours: 99, concluded: true }),
    ])
    expect(m[2].value).toBe('15h')
    expect(m[2].sub).toBe('$505')
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
