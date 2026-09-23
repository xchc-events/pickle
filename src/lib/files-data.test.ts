import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The one thing everything else in this change leans on: replacing a rider
 * supersedes only the *same* act's previous one. Before StoredFile.artistId,
 * eventId + kind was the whole scope, so any upload of the same kind on the
 * same event superseded any other — fine when there was one rider per event,
 * wrong now that several acts each keep their own. See finish() in
 * files-data.ts.
 */

vi.mock('server-only', () => ({}))

const findFile = vi.fn()
const findManyFiles = vi.fn()
const updateFile = vi.fn()
const updateManyFiles = vi.fn()
const transaction = vi.fn()
vi.mock('./db', () => ({
  db: {
    storedFile: {
      findUnique: (...a: unknown[]) => findFile(...a),
      findMany: (...a: unknown[]) => findManyFiles(...a),
      update: (...a: unknown[]) => updateFile(...a),
      updateMany: (...a: unknown[]) => updateManyFiles(...a),
      delete: vi.fn(),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}))

const verify = vi.fn()
vi.mock('./r2', () => ({
  isConfigured: () => true,
  verify: (...a: unknown[]) => verify(...a),
  remove: vi.fn(),
  uploadUrl: vi.fn(),
}))

const record = vi.fn()
vi.mock('./activity', () => ({ record: (...a: unknown[]) => record(...a) }))

const { finish, attachToArtist } = await import('./files-data')

const FILE = 'file_new'

const uploadedRow = (over: Record<string, unknown> = {}) => ({
  id: FILE,
  key: 'rider-tech/evt_1/abc.pdf',
  name: 'rider.pdf',
  kind: 'RIDER_TECH',
  eventId: 'evt_1',
  payeeId: null,
  assetId: null,
  artistId: 'art_1',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  verify.mockResolvedValue({ mime: 'application/pdf', size: 1024, etag: 'abc123' })
  findManyFiles.mockResolvedValue([])
  transaction.mockImplementation((ops: unknown[]) => Promise.all(ops as Promise<unknown>[]))
  updateManyFiles.mockResolvedValue({})
  updateFile.mockResolvedValue({})
})

describe('what a finished upload supersedes', () => {
  it('compares artistId, so it only reaches the same act’s prior rider', async () => {
    findFile.mockResolvedValue(uploadedRow({ artistId: 'art_1' }))

    await finish(FILE)

    expect(findManyFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ artistId: 'art_1', eventId: 'evt_1', kind: 'RIDER_TECH' }),
      }),
    )
  })

  it('compares artistId even when null, so an unassigned upload cannot supersede an act’s rider', async () => {
    findFile.mockResolvedValue(uploadedRow({ artistId: null }))

    await finish(FILE)

    const where = findManyFiles.mock.calls[0]![0].where
    // Explicitly present and null — not simply absent, which would match
    // every artistId including an act's.
    expect('artistId' in where).toBe(true)
    expect(where.artistId).toBeNull()
  })

  it('still scopes by eventId/payeeId/assetId as before, alongside artistId', async () => {
    findFile.mockResolvedValue(uploadedRow({ eventId: null, payeeId: 'pay_1', artistId: null }))

    await finish(FILE)

    const where = findManyFiles.mock.calls[0]![0].where
    expect(where.payeeId).toBe('pay_1')
    expect(where).not.toHaveProperty('eventId')
  })

  it('marks only what it found as no longer current, and versions up from it', async () => {
    findFile.mockResolvedValue(uploadedRow())
    findManyFiles.mockResolvedValue([{ id: 'file_old', version: 1 }])

    await finish(FILE)

    expect(updateManyFiles).toHaveBeenCalledWith({
      where: { id: { in: ['file_old'] } },
      data: { current: false },
    })
    expect(updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: FILE },
        data: expect.objectContaining({ version: 2 }),
      }),
    )
  })
})

describe('attaching an unassigned file to an act', () => {
  it('writes the act once', async () => {
    findFile.mockResolvedValue({ artistId: null })

    const out = await attachToArtist(FILE, 'art_1')

    expect(out).toEqual({ ok: true })
    expect(updateFile).toHaveBeenCalledWith({ where: { id: FILE }, data: { artistId: 'art_1' } })
  })

  it('refuses a file that no longer exists', async () => {
    findFile.mockResolvedValue(null)

    const out = await attachToArtist(FILE, 'art_1')

    expect(out.ok).toBe(false)
    expect(updateFile).not.toHaveBeenCalled()
  })

  it('refuses to move a file that is already on an act', async () => {
    findFile.mockResolvedValue({ artistId: 'art_other' })

    const out = await attachToArtist(FILE, 'art_1')

    expect(out).toEqual({ ok: false, why: 'That file is already on an act.' })
    expect(updateFile).not.toHaveBeenCalled()
  })
})
