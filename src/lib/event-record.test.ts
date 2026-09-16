import { describe, expect, it } from 'vitest'
import {
  canAdvance,
  canChangeEventRecord,
  gatesDoneLabel,
  gatesMessage,
  isLate,
  timeMinutes,
  type Gate,
} from './event-record'

/**
 * The gates themselves are tested part by part in parts.test.ts, where they
 * moved when the eight stages became parts. What stays here is what every
 * gate list shares: the run-time arithmetic the licence gate reads, and the
 * summary under a list.
 */

const gate = (label: string, ok: boolean): Gate => ({ label, ok, why: '', screen: 'event' })

describe('run times', () => {
  it('carries hours after midnight past 1440 rather than wrapping', () => {
    // The load-bearing case: 1am is *after* 11pm, not twelve hours before it.
    expect(timeMinutes('11:00pm')).toBe(1380)
    expect(timeMinutes('1:00am')).toBe(1500)
    expect(timeMinutes('1:00am')).toBeGreaterThan(timeMinutes('11:00pm'))
  })

  it('treats midnight itself as late', () => {
    expect(timeMinutes('12:00am')).toBe(1440)
    expect(isLate('12:00am')).toBe(true)
    expect(isLate('11:30pm')).toBe(false)
  })

  it('reads 6am and later as the same evening, not the next one', () => {
    // The prototype's cutoff. A 6am time is a morning event, not a 30-hour night.
    expect(timeMinutes('6:00am')).toBe(360)
    expect(timeMinutes('5:30am')).toBe(1770)
  })

  it('reads an unset time as zero rather than throwing', () => {
    expect(timeMinutes(null)).toBe(0)
    expect(timeMinutes('whenever')).toBe(0)
    expect(isLate(null)).toBe(false)
  })
})

describe('the gate summary', () => {
  const four = (firstOk: boolean) => [
    gate('An owner is named', firstOk),
    gate('Date is locked', true),
    gate('Space chosen', true),
    gate('Kind of night set', true),
  ]

  it('counts what is clear', () => {
    expect(gatesDoneLabel(four(true))).toBe('4 of 4 clear')
    expect(gatesDoneLabel(four(false))).toBe('3 of 4 clear')
  })

  it('advances only when every gate is clear', () => {
    expect(canAdvance(four(true))).toBe(true)
    expect(canAdvance(four(false))).toBe(false)
  })

  it('names the blocker rather than only counting it', () => {
    expect(gatesMessage(four(false), 'clear')).toBe('One thing holds this up: an owner is named.')
    const two = [gate('An owner is named', false), gate('Date is locked', false)]
    expect(gatesMessage(two, 'clear')).toBe(
      '2 things hold this up, starting with an owner is named.',
    )
  })

  it('says what comes next once nothing holds it up', () => {
    expect(gatesMessage(four(true), 'Everything is clear — this can move to Negotiating.')).toBe(
      'Everything is clear — this can move to Negotiating.',
    )
  })
})

/**
 * Reading the record is not keeping it.
 *
 * `eventScope` lets an external promoter open their own organisation's events,
 * and Pipeline is one of their two modules, so every action on this page used
 * to be one POST away from them: agreeing their own terms, locking their own
 * date, moving their own show on to sale. What the handoff does let them
 * answer for — agreeing or querying the terms, signing off the artwork —
 * belongs in Sign-offs, in their own words, not on the venue's controls.
 */
describe('who may change the event record', () => {
  it('lets anybody inside the venue change it', () => {
    expect(canChangeEventRecord({ external: false }).ok).toBe(true)
  })

  it('refuses an external promoter, though their scope lets them read it', () => {
    expect(canChangeEventRecord({ external: true }).ok).toBe(false)
  })

  it('tells them who can make the change, not only that they cannot', () => {
    const v = canChangeEventRecord({ external: true })
    expect(v.ok === false && v.why).toMatch(/coordinator/i)
  })
})
