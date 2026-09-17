import { checkPassword } from './password-policy'

/**
 * The two deploy-time knobs the seed reads from the environment.
 *
 * A test deployment runs a production build, where the development role
 * picker is off and an emailed link cannot reach an `@xchc.test` address —
 * so a seeded account is unreachable unless the seed gives it a real
 * password. `SEED_PASSWORD` does that; `SEED_ONLY_IF_EMPTY` stops a
 * redeploy from wiping a database that already has real activity in it.
 *
 * Pure and free of `server-only`: `prisma/seed.ts` runs under `tsx`, outside
 * Next.js, so this has to work there, and it has to be testable without a
 * database.
 */

/**
 * The password every seeded user should get, or `null` for today's
 * behaviour (no passwords, sign-in by emailed link only).
 *
 * Throws, rather than returning a verdict, because the seed's contract is to
 * refuse outright: a `SEED_PASSWORD` that fails the house policy must stop
 * the seed before it clears a single row, not quietly leave passwords unset.
 * Checked against every person, not just the first, because one password
 * goes on all of them — a seed with two users is not proven safe by
 * checking it against only one of their names.
 */
export function seedPasswordFrom(
  env: Record<string, string | undefined>,
  people: { name: string; email: string }[],
): string | null {
  const raw = env.SEED_PASSWORD
  if (raw === undefined) return null

  const password = raw.trim()
  if (password === '') return null

  for (const person of people) {
    const verdict = checkPassword(password, { email: person.email, names: [person.name] })
    if (!verdict.ok) {
      throw new Error(`SEED_PASSWORD fails the password policy for ${person.email}: ${verdict.why}`)
    }
  }

  return password
}

/**
 * Whether the seed should leave an already-populated database alone.
 *
 * Off by default, matching the seed's long-standing behaviour of wiping and
 * reseeding every run — the tool a developer reaches for locally. On for a
 * deploy that should only ever install data once: '1' and 'true' (any case)
 * count as on, everything else — unset, blank, '0', 'false' — as off.
 */
export function seedOnlyIfEmpty(env: Record<string, string | undefined>): boolean {
  const flag = (env.SEED_ONLY_IF_EMPTY ?? '').trim().toLowerCase()
  return flag === '1' || flag === 'true'
}
