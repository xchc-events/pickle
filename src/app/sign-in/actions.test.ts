import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessDenied } from '@auth/core/errors'

/**
 * `next-auth`'s entrypoint imports `next/server`, which will not resolve in a
 * plain node test. Its `AuthError` is a straight re-export of `@auth/core`'s
 * (next-auth/index.d.ts:76), and next-auth pins that package to an exact
 * version, so standing the real class in here is the same object the action
 * will meet at runtime — not a stub of it.
 */
vi.mock('next-auth', async () => ({ ...(await vi.importActual('@auth/core/errors')) }))
import { LINK_COOLDOWN_SECONDS } from '@/lib/auth-rules'

/**
 * The wiring between the sign-in form and Auth.js.
 *
 * `mayRequestLink` and `mayAdmit` are already covered as pure rules in
 * auth-rules.test.ts. Nothing covered the wiring, and the wiring is where the
 * bug was: `signIn()` rethrows an `AuthError` out of a server action rather
 * than redirecting to `pages.error`, so a refused request reached the browser
 * as "An unexpected response was received from the server" instead of the
 * explanation the sign-in page already had copy for.
 *
 * These tests are therefore about what the *caller* does with a refusal, not
 * about whether the refusal is correct.
 */

const signIn = vi.fn()
const lastLinkSentAt = vi.fn()

vi.mock('@/lib/auth', () => ({
  signIn: (...args: unknown[]) => signIn(...args),
  lastLinkSentAt: (...args: unknown[]) => lastLinkSentAt(...args),
}))

/** Stands in for Next's redirect, which signals by throwing. */
class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`)
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url)
  },
}))

const { requestSignInLink } = await import('./actions')

function form(email: string): FormData {
  const fd = new FormData()
  fd.set('email', email)
  return fd
}

/** Run the action and report where it sent the browser. */
async function redirectFor(email: string): Promise<string> {
  try {
    await requestSignInLink(form(email))
  } catch (err) {
    if (err instanceof RedirectSignal) return err.url
    throw err
  }
  throw new Error('expected the action to redirect, but it returned')
}

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000)

beforeEach(() => {
  signIn.mockReset().mockResolvedValue(undefined)
  lastLinkSentAt.mockReset().mockResolvedValue(null)
})

describe('requestSignInLink', () => {
  it('asks Auth.js to send when no link has gone out recently', async () => {
    await requestSignInLink(form('awhina@koura.test'))

    expect(signIn).toHaveBeenCalledWith('resend', {
      email: 'awhina@koura.test',
      redirectTo: '/',
    })
  })

  it('refuses a second request inside the cooldown and says how long is left', async () => {
    lastLinkSentAt.mockResolvedValue(ago(20))

    const url = await redirectFor('awhina@koura.test')

    expect(url).toBe(`/sign-in?wait=${LINK_COOLDOWN_SECONDS - 20}`)
  })

  it('sends no email at all when it refuses — the point is the unspent quota', async () => {
    lastLinkSentAt.mockResolvedValue(ago(1))

    await redirectFor('awhina@koura.test')

    expect(signIn).not.toHaveBeenCalled()
  })

  it('allows another link once the cooldown has passed', async () => {
    lastLinkSentAt.mockResolvedValue(ago(LINK_COOLDOWN_SECONDS + 1))

    await requestSignInLink(form('awhina@koura.test'))

    expect(signIn).toHaveBeenCalled()
  })

  /** The reported bug: this used to escape as a Next.js runtime error. */
  it('turns a refused sign-in into an explanation, not an unhandled error', async () => {
    signIn.mockRejectedValue(new AccessDenied())

    const url = await redirectFor('stranger@example.test')

    expect(url).toBe('/sign-in?error=AccessDenied')
  })

  it("lets Next's own redirect through rather than swallowing it", async () => {
    const theRedirect = new RedirectSignal('/')
    signIn.mockRejectedValue(theRedirect)

    await expect(requestSignInLink(form('awhina@koura.test'))).rejects.toBe(theRedirect)
  })

  it('does not disguise an unexpected failure as a sign-in problem', async () => {
    const boom = new Error('the database fell over')
    signIn.mockRejectedValue(boom)

    await expect(requestSignInLink(form('awhina@koura.test'))).rejects.toBe(boom)
  })

  it('normalises the address before looking anything up, so case cannot decide', async () => {
    await requestSignInLink(form('  Awhina@Koura.Test  '))

    expect(lastLinkSentAt).toHaveBeenCalledWith('awhina@koura.test')
    expect(signIn).toHaveBeenCalledWith('resend', {
      email: 'awhina@koura.test',
      redirectTo: '/',
    })
  })

  it('refuses an empty address without touching the database', async () => {
    const url = await redirectFor('   ')

    expect(url).toBe('/sign-in?error=AccessDenied')
    expect(lastLinkSentAt).not.toHaveBeenCalled()
    expect(signIn).not.toHaveBeenCalled()
  })
})
