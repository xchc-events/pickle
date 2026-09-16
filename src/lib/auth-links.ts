import 'server-only'
import { accountByEmail, issueLink, lastLinkSentAt, recordAuthEvent } from './auth-data'
import { inviteEmail, passwordChangedEmail, resetEmail, signInLinkEmail } from './auth-email'
import { linkBase, mayRequestLink } from './auth-rules'
import { emailConfigured, sendMail } from './email'
import type { AuthEventKind, AuthTokenPurpose } from '@/generated/prisma/client'

/**
 * Emailing a link to an account: the cooldown, the token, the email, the trail.
 */

export type LinkOutcome =
  /** Handed to Resend. */
  | 'sent'
  /** Written to the dev server's log instead — see src/lib/email.ts. */
  | 'logged'
  /** One went to this account less than a minute ago. Nothing sent. */
  | 'cooling'
  /** No safe address to point a link at — AUTH_URL unset in production. */
  | 'unavailable'
  /** No mail keys in production, so nothing can be sent. */
  | 'unconfigured'

const SENT: Record<AuthTokenPurpose, AuthEventKind> = {
  SIGN_IN: 'LINK_SENT',
  INVITE: 'INVITE_SENT',
  RESET: 'RESET_SENT',
}

interface Account {
  id: string
  email: string
  name: string | null
}

/**
 * Email `account` a link. For callers who may say what happened — an
 * administrator in Admin, or somebody signed in asking for their own.
 *
 * Throws if the mail service refuses: an administrator needs to know the
 * invitation did not go.
 */
export async function emailLink(
  account: Account,
  purpose: AuthTokenPurpose,
  actorId: string | null = null,
): Promise<LinkOutcome> {
  // Before the token, not after: a link minted for an email that cannot be
  // sent is a live credential nobody received, and it would start a cooldown
  // for a message that never went.
  if (!emailConfigured() && process.env.NODE_ENV === 'production') return 'unconfigured'

  if (!mayRequestLink(await lastLinkSentAt(account.id), new Date()).ok) return 'cooling'

  const link = await issueLink(account.id, purpose)
  if (!link) {
    console.error(
      `Cannot email a ${purpose} link to ${account.id}: AUTH_URL is not set, so there is no safe address to point it at.`,
    )
    return 'unavailable'
  }

  const mail =
    purpose === 'INVITE'
      ? inviteEmail({ url: link.url, name: account.name })
      : purpose === 'RESET'
        ? resetEmail(link.url)
        : signInLinkEmail(link.url)

  const delivery = await sendMail(account.email, mail)
  await recordAuthEvent(SENT[purpose], { email: account.email, userId: account.id, actorId })
  return delivery
}

/**
 * Email a link to an address, if it belongs to an account that is on — and
 * otherwise do nothing, silently.
 *
 * For the sign-in and "forgot your password" forms, which answer every address
 * the same way. Run it after the response has gone (`after()`), so the time the
 * form takes to answer does not give away what the answer would have been
 * either. By then there is nobody to tell about a failure, so it is logged.
 */
export async function emailLinkQuietly(
  email: string,
  purpose: Extract<AuthTokenPurpose, 'SIGN_IN' | 'RESET'>,
): Promise<void> {
  try {
    const account = await accountByEmail(email)
    if (!account?.active) return
    await emailLink(account, purpose)
  } catch (err) {
    console.error(`Emailing a ${purpose} link failed:`, err)
  }
}

/**
 * Tell somebody their password changed.
 *
 * Runs after the change has landed, so a failure here must not look like the
 * change failed — it is logged.
 */
export async function notifyPasswordChanged(email: string, when: Date): Promise<void> {
  try {
    const base = linkBase(process.env.AUTH_URL, process.env.NODE_ENV)
    if (!base) return
    await sendMail(email, passwordChangedEmail({ when, forgotUrl: `${base}/sign-in/forgot` }))
  } catch (err) {
    console.error('Telling somebody their password changed failed:', err)
  }
}
