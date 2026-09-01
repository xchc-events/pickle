import type { Role } from '@/generated/prisma/client'

/**
 * Who may sign in, and who may change that.
 *
 * Pure, so the rules that decide whether a stranger gets into the venue's
 * pipeline can be tested without a database or a network — the same reason
 * `scope.ts` is kept free of `server-only`.
 *
 * The governing rule: **there is no self-signup.** This is one venue's
 * internal tool. An account exists because an administrator made it, and an
 * OAuth provider vouching for somebody's email address is not the same thing
 * as XCHC having decided they work here.
 */

export type Verdict = { ok: true } | { ok: false; why: string }

export interface Applicant {
  email: string
  /** Whether a User row already exists for this address. */
  known: boolean
  active: boolean
}

export type AdmissionCode = 'unknown' | 'inactive'
export type Admission = { ok: true } | { ok: false; why: string; code: AdmissionCode }

/**
 * Whether this address may sign in.
 *
 * Inactive is checked first: somebody who has left should be told their
 * access has ended, not told they do not exist.
 */
export function mayAdmit(a: Applicant): Admission {
  if (a.known && !a.active) {
    return {
      ok: false,
      code: 'inactive',
      why: 'That account has been switched off. If that is wrong, ask an administrator at the venue.',
    }
  }

  if (!a.known) {
    return {
      ok: false,
      code: 'unknown',
      why: 'There is no account for that address. Somebody has to be added by an administrator before they can sign in — this is not a service you can sign up to.',
    }
  }

  return { ok: true }
}

/**
 * One spelling per address.
 *
 * Lowercased and trimmed, because providers disagree about case and a user
 * typing their own address will not match otherwise. Dots in the local part
 * are left alone: Gmail treats them as insignificant and almost nobody else
 * does, so stripping them would merge two people who are not the same person.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

interface Actor {
  id: string
  role: Role
}

interface Target {
  id: string
  role: Role
  active: boolean
}

const ADMIN_ONLY = 'Only an administrator can change who has access.'

/**
 * The floor under the admin count.
 *
 * Two ways to lock every person out of the venue's own tool: switch off the
 * last admin, or demote them. Neither is recoverable from inside the product
 * — it would take somebody with database access — so both are refused rather
 * than warned about.
 */
const LAST_ADMIN =
  'That is the last administrator. Removing them would lock everybody out of Admin with no way back in from here — promote somebody else first.'

export function mayDeactivate(actor: Actor, target: Target, activeAdmins: number): Verdict {
  if (actor.role !== 'ADMIN') return { ok: false, why: ADMIN_ONLY }

  if (actor.id === target.id && target.active) {
    return {
      ok: false,
      why: 'You cannot switch off your own account. Ask another administrator to do it.',
    }
  }

  // Only a *deactivation* can breach the floor. Turning an account back on
  // never reduces the count.
  if (target.active && target.role === 'ADMIN' && activeAdmins <= 1) {
    return { ok: false, why: LAST_ADMIN }
  }

  return { ok: true }
}

export function mayChangeRole(
  actor: Actor,
  target: Target,
  next: Role,
  activeAdmins: number,
): Verdict {
  if (actor.role !== 'ADMIN') return { ok: false, why: ADMIN_ONLY }

  const losingAnAdmin = target.active && target.role === 'ADMIN' && next !== 'ADMIN'
  if (losingAnAdmin && activeAdmins <= 1) return { ok: false, why: LAST_ADMIN }

  return { ok: true }
}

export interface UserShape {
  role: Role
  promoter: string | null
  personId: string | null
}

/**
 * Ways an account is set up wrongly.
 *
 * None of these is an error — the account works — but each one means somebody
 * will find the product mysteriously empty and not know why. Better said out
 * loud in Admin than discovered on a Friday night.
 */
export function userProblems(u: UserShape): string[] {
  const problems: string[] = []

  if (u.role === 'PROMOTER') {
    if (!u.promoter) {
      problems.push(
        'No promoter organisation, so this account matches no events at all and the portal will be empty.',
      )
    }
    // A promoter has no shifts and no timesheet; a person record would be
    // claiming they are staff.
    return problems
  }

  if (u.promoter) {
    problems.push(
      'A staff account carrying a promoter organisation. The organisation is ignored for internal roles — clear it to avoid confusion.',
    )
  }

  if (!u.personId) {
    problems.push(
      'Not linked to a person, so they cannot be rostered and their hours have nowhere to go.',
    )
  }

  return problems
}
