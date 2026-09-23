'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { validateTicketCode, type TicketCodeInput } from '@/lib/ticket-codes'
import { said, type Said } from '@/lib/toast'
import type { TicketCodeKind } from '@/generated/prisma/client'

/**
 * Codes' mutations — T6, 23 Sep 2026.
 *
 * Venue only. An external promoter can see this page for their own events —
 * their tiers and sales are their business — but a code is the venue's own
 * lever, not theirs to set, so it is refused the same way `setOrganisation`
 * refuses one in src/app/(app)/admin/actions.ts. Every change is an
 * activity line, same as a price.
 */

function parsedDate(raw: string): { ok: true; date: Date | null } | { ok: false; error: string } {
  if (!raw) return { ok: true, date: null }
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return { ok: false, error: 'That date does not parse.' }
  return { ok: true, date }
}

export async function addCode(eventId: string, form: FormData): Promise<Said> {
  const { user } = await requireModule('ticketing')
  const id = await requireEvent(user, eventId)
  if (user.external) return said('Not something an external account can do.', 'stop')

  const rawValue = String(form.get('value') ?? '').trim()
  const rawTierKey = String(form.get('tierKey') ?? '').trim()
  const rawUseLimit = String(form.get('useLimit') ?? '').trim()

  const input: TicketCodeInput = {
    code: String(form.get('code') ?? ''),
    kind: String(form.get('kind') ?? '') as TicketCodeKind,
    value: rawValue ? Number(rawValue) : null,
    tierKey: rawTierKey || null,
    useLimit: rawUseLimit ? Number(rawUseLimit) : null,
  }

  const validated = validateTicketCode(input)
  if (!validated.ok) return said(validated.error, 'stop')

  const from = parsedDate(String(form.get('activeFrom') ?? '').trim())
  if (!from.ok) return said(`Start date: ${from.error}`, 'stop')
  const to = parsedDate(String(form.get('activeTo') ?? '').trim())
  if (!to.ok) return said(`End date: ${to.error}`, 'stop')
  if (from.date && to.date && from.date > to.date) {
    return said('The end date is before the start date.', 'stop')
  }

  const existing = await db.ticketCode.findUnique({
    where: { eventId_code: { eventId: id, code: validated.code } },
    select: { id: true },
  })
  if (existing) return said(`${validated.code} is already a code on this event.`, 'stop')

  await db.ticketCode.create({
    data: {
      eventId: id,
      code: validated.code,
      kind: input.kind,
      value: input.value,
      tierKey: input.tierKey,
      useLimit: input.useLimit,
      activeFrom: from.date,
      activeTo: to.date,
      createdById: user.id,
      who: user.name,
    },
  })

  await record(
    id,
    user,
    `code added: ${validated.code} (${input.kind.toLowerCase().replace('_', ' ')})`,
  )

  refresh()
  return said(
    `${validated.code} is live. Nothing sells against it until Gather.rsvp reports a redemption.`,
  )
}

export async function deactivateCode(eventId: string, codeId: string): Promise<Said> {
  const { user } = await requireModule('ticketing')
  const id = await requireEvent(user, eventId)
  if (user.external) return said('Not something an external account can do.', 'stop')

  const code = await db.ticketCode.findFirst({ where: { id: codeId, eventId: id } })
  if (!code) return said('That code is not on this event.', 'stop')
  if (!code.active) return said(`${code.code} is already off.`, 'warn')

  await db.ticketCode.update({ where: { id: codeId }, data: { active: false } })
  await record(id, user, `code deactivated: ${code.code}`)

  refresh()
  return said(`${code.code} is off. Existing holders keep what they have.`)
}
