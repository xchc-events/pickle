import { isDeepStrictEqual } from 'node:util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { NO_LONGER_STANDING, type HoldChange } from './holds'

/**
 * The hold writers, against a ladder kept in memory.
 *
 * The rules in holds.ts are tested as rules in holds.test.ts. Nothing covered
 * whether the writers ask them the right question, and that is where this bug
 * was. Each action scoped the *event*, then handed a hold id from the browser
 * to a writer that never asked whose hold it was. From one event's page a
 * coordinator could confirm another event's 1st hold and release everyone else
 * on that night, release any hold still standing, or challenge with somebody
 * else's lower hold in their own event's name — and each activity line landed
 * on the event the request came from, not the event the hold belonged to.
 *
 * A write that succeeds also reports the holds of other events it changed, and
 * the action writes a line on each of those events from that report. So the
 * report is tested against the table itself: a hold whose row changed and was
 * left out gets no line, and one listed that did not change gets a false one.
 *
 * The stand-in database answers only the queries holds-data.ts makes, and logs
 * which client made each one, so a check that slipped outside the Serializable
 * transaction — where the ladder can change underneath it — fails here too.
 */

vi.mock('server-only', () => ({}))

interface Row {
  id: string
  eventId: string
  spaceId: string
  date: Date
  rank: number
  state: 'HELD' | 'RELEASED' | 'CONFIRMED'
  challengedByEventId: string | null
  challengedAt: Date | null
  releasedAt: Date | null
}

type Where = Record<string, unknown>

/** The Hold table. */
let rows: Row[] = []

/** Every query made, as `tx.hold.update` or `db.hold.findMany`. */
const queries: string[] = []

/** Conflicts still to throw at commit, the way Postgres aborts the loser of a Serializable race. */
let conflicts = 0

const same = (have: unknown, want: unknown) =>
  have instanceof Date && want instanceof Date ? have.getTime() === want.getTime() : have === want

/** Prisma's `where`, for the two shapes holds-data.ts uses: a value, and `{ not: value }`. */
const matches = (row: Row, where: Where) =>
  Object.entries(where).every(([field, want]) => {
    const have = row[field as keyof Row]
    return want !== null && typeof want === 'object' && 'not' in want
      ? !same(have, want.not)
      : same(have, want)
  })

/** A row the way Prisma hands one back: a copy, with its space joined. */
const copy = (row: Row) => ({ ...structuredClone(row), space: { name: 'Main' } })

function holdClient(client: 'db' | 'tx') {
  const log = (op: string) => queries.push(`${client}.hold.${op}`)
  return {
    findUnique: async ({ where }: { where: Where }) => {
      log('findUnique')
      const row = rows.find((r) => matches(r, where))
      return row ? copy(row) : null
    },
    findMany: async ({ where, orderBy }: { where: Where; orderBy: Record<string, 'asc'> }) => {
      log('findMany')
      const field = Object.keys(orderBy)[0] as keyof Row
      return rows
        .filter((r) => matches(r, where))
        .sort((a, b) => Number(a[field]) - Number(b[field]))
        .map(copy)
    },
    update: async ({ where, data }: { where: Where; data: Partial<Row> }) => {
      log('update')
      const row = rows.find((r) => matches(r, where))
      if (!row) throw new Error(`No Hold matches ${JSON.stringify(where)}`)
      return copy(Object.assign(row, data))
    },
    updateMany: async ({ where, data }: { where: Where; data: Partial<Row> }) => {
      log('updateMany')
      const hit = rows.filter((r) => matches(r, where))
      for (const row of hit) Object.assign(row, data)
      return { count: hit.length }
    },
    updateManyAndReturn: async ({ where, data }: { where: Where; data: Partial<Row> }) => {
      log('updateManyAndReturn')
      const hit = rows.filter((r) => matches(r, where))
      for (const row of hit) Object.assign(row, data)
      return hit.map(copy)
    },
  }
}

/** An interactive transaction: all or nothing, and abortable at commit. */
const $transaction = vi.fn(async (fn: (tx: { hold: ReturnType<typeof holdClient> }) => unknown) => {
  const before = structuredClone(rows)
  try {
    const result = await fn({ hold: holdClient('tx') })
    if (conflicts > 0) {
      conflicts--
      // The shape the pg adapter throws — see isWriteConflict in holds.ts.
      throw Object.assign(new Error('TransactionWriteConflict'), {
        name: 'DriverAdapterError',
        cause: { originalCode: '40001', kind: 'TransactionWriteConflict' },
      })
    }
    return result
  } catch (err) {
    rows = before
    throw err
  }
})

vi.mock('./db', () => ({
  db: {
    $transaction: (...args: Parameters<typeof $transaction>) => $transaction(...args),
    hold: holdClient('db'),
  },
}))

const { challengeHold, confirmHold, holdsForEvent, releaseHold } = await import('./holds-data')

/**
 * Saturday in the Main room: Slow Fold holds it first, Static Bloom and Dust
 * to Mountains are queued behind. The requests that should be refused come
 * from Nightshade's page — an event in scope for the coordinator, with no
 * hold on this night at all.
 */
const SATURDAY = new Date('2026-10-03T00:00:00.000Z')
const NIGHTSHADE = 'ns'

const hold = (over: Pick<Row, 'id' | 'eventId' | 'rank'>): Row => ({
  spaceId: 'main',
  date: SATURDAY,
  state: 'HELD',
  challengedByEventId: null,
  challengedAt: null,
  releasedAt: null,
  ...over,
})

beforeEach(() => {
  rows = [
    hold({ id: 'hold_sf', eventId: 'sf', rank: 1 }),
    hold({ id: 'hold_sb', eventId: 'sb', rank: 2 }),
    hold({ id: 'hold_dtm', eventId: 'dtm', rank: 3 }),
  ]
  queries.length = 0
  conflicts = 0
  $transaction.mockClear()
})

const REFUSED = { ok: false, why: NO_LONGER_STANDING }

/** Each hold's state, by id. */
const states = () => Object.fromEntries(rows.map((r) => [r.id, r.state]))

/** The rank of every hold still standing, by id. */
const standing = () =>
  Object.fromEntries(rows.filter((r) => r.state === 'HELD').map((r) => [r.id, r.rank]))

/** A hold that belongs to another event, as a writer reports what it did to it. */
const affected = (holdId: string, eventId: string, change: HoldChange, rank: number) => ({
  holdId,
  eventId,
  change,
  rank,
  spaceName: 'Main',
  date: SATURDAY,
})

/** A hold given up before now. It keeps its row and its old number. */
const givenUp = (id: string, eventId: string): Row => ({
  ...hold({ id, eventId, rank: 1 }),
  state: 'RELEASED',
})

describe('confirmHold', () => {
  it("confirms the event's own 1st hold and releases every other hold on the night", async () => {
    await expect(confirmHold('hold_sf', 'sf')).resolves.toMatchObject({ ok: true })
    expect(states()).toEqual({ hold_sf: 'CONFIRMED', hold_sb: 'RELEASED', hold_dtm: 'RELEASED' })
  })

  it('reports every other event whose hold it released, at the rank each held', async () => {
    await expect(confirmHold('hold_sf', 'sf')).resolves.toEqual({
      ok: true,
      affected: [
        affected('hold_sb', 'sb', 'released', 2),
        affected('hold_dtm', 'dtm', 'released', 3),
      ],
    })
  })

  it('does not report a hold that was given up before the night was taken', async () => {
    rows.push(givenUp('hold_gone', 'gone'))

    const out = await confirmHold('hold_sf', 'sf')
    expect(out.ok && out.affected.map((h) => h.eventId)).toEqual(['sb', 'dtm'])
  })

  it("refuses another event's 1st hold, and releases nobody", async () => {
    const before = structuredClone(rows)

    await expect(confirmHold('hold_sf', NIGHTSHADE)).resolves.toEqual(REFUSED)
    expect(rows).toEqual(before)
  })
})

describe('releaseHold', () => {
  it("releases the event's own hold and moves everyone behind it up", async () => {
    await expect(releaseHold('hold_sf', 'sf')).resolves.toMatchObject({ ok: true })
    expect(standing()).toEqual({ hold_sb: 1, hold_dtm: 2 })
  })

  it('reports every event it moved up, at the rank each moved to', async () => {
    await expect(releaseHold('hold_sf', 'sf')).resolves.toEqual({
      ok: true,
      affected: [
        affected('hold_sb', 'sb', 'moved_up', 1),
        affected('hold_dtm', 'dtm', 'moved_up', 2),
      ],
    })
  })

  it('does not report the holds above it, which stay where they were', async () => {
    const out = await releaseHold('hold_sb', 'sb')
    expect(out.ok && out.affected.map((h) => h.eventId)).toEqual(['dtm'])
  })

  it("refuses another event's hold, and moves nobody up", async () => {
    const before = structuredClone(rows)

    await expect(releaseHold('hold_sf', NIGHTSHADE)).resolves.toEqual(REFUSED)
    expect(rows).toEqual(before)
  })
})

describe('challengeHold', () => {
  it('puts the 1st hold on notice in the name of the event holding the lower one', async () => {
    await expect(challengeHold('hold_sb', 'sb')).resolves.toMatchObject({ ok: true })
    expect(rows.find((r) => r.id === 'hold_sf')?.challengedByEventId).toBe('sb')
  })

  /** Only the incumbent is on notice. A hold queued in between is not changed. */
  it('reports the 1st hold it put on notice, and nobody queued in between', async () => {
    await expect(challengeHold('hold_dtm', 'dtm')).resolves.toEqual({
      ok: true,
      affected: [affected('hold_sf', 'sf', 'challenged', 1)],
    })
  })

  it("refuses another event's lower hold, so nobody is challenged in the caller's name", async () => {
    const before = structuredClone(rows)

    await expect(challengeHold('hold_sb', NIGHTSHADE)).resolves.toEqual(REFUSED)
    expect(rows).toEqual(before)
  })
})

/** Each writer, with a hold another event owns and the event that owns it. */
describe.each([
  ['confirmHold', confirmHold, 'hold_sf', 'sf'],
  ['releaseHold', releaseHold, 'hold_sf', 'sf'],
  ['challengeHold', challengeHold, 'hold_sb', 'sb'],
] as const)('%s', (_, write, holdId, owner) => {
  it("answers another event's hold exactly as it answers a hold that is not there", async () => {
    const gone = await write('no_such_hold', NIGHTSHADE)

    await expect(write(holdId, NIGHTSHADE)).resolves.toEqual(gone)
  })

  /**
   * The hold is looked up scoped to the event, the way requireEvent looks up
   * an event, so the ladder of a night the caller has no hold on is never read.
   */
  it("never reads the night another event's hold is on", async () => {
    await write(holdId, NIGHTSHADE)

    expect(queries).toEqual(['tx.hold.findUnique'])
  })

  it('reads and writes only inside a Serializable transaction', async () => {
    await expect(write(holdId, owner)).resolves.toMatchObject({ ok: true })

    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
    expect(queries.filter((q) => !q.startsWith('tx.'))).toEqual([])
  })

  it('runs again from the top when Postgres aborts it for a conflict', async () => {
    conflicts = 1

    await expect(write(holdId, owner)).resolves.toMatchObject({ ok: true })
    expect($transaction).toHaveBeenCalledTimes(2)
  })

  /**
   * The report is what the action writes activity lines from. A changed hold
   * missing from it gets no line; one listed that did not change gets a false
   * one. A hold given up earlier sits on the night, unchanged, to be left out.
   */
  it("reports exactly the other events' holds whose rows it changed", async () => {
    rows.push(givenUp('hold_gone', 'gone'))
    const was = new Map(structuredClone(rows).map((row) => [row.id, row]))

    const out = await write(holdId, owner)

    const changed = rows
      .filter((row) => row.eventId !== owner && !isDeepStrictEqual(row, was.get(row.id)))
      .map((row) => row.id)
    expect(changed).not.toEqual([])
    expect(out.ok && out.affected.map((h) => h.holdId)).toEqual(changed)
  })

  /**
   * An aborted attempt's writes are rolled back, so what it would have
   * reported never happened. Only the attempt that committed is reported.
   */
  it('reports what the attempt that committed changed, and nothing twice', async () => {
    const start = structuredClone(rows)
    const clean = await write(holdId, owner)

    rows = start
    conflicts = 1
    await expect(write(holdId, owner)).resolves.toEqual(clean)
  })
})

describe('holdsForEvent', () => {
  /** The page draws "Take the night" off the same rule the writer applies. */
  it('offers the night to the 1st hold, and to nobody queued behind it', async () => {
    const [first] = await holdsForEvent('sf')
    const [second] = await holdsForEvent('sb')

    expect(first?.canConfirm).toBe(true)
    expect(second?.canConfirm).toBe(false)
  })
})
