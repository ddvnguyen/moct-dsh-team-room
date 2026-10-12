import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  PROVIDER_POISON_TURNS,
  PoisonedSessionTracker,
  malformedToolCallGeneration,
  providerPoisonSignature,
  zeroReportedUsage,
} from '../src/poisoned-session.ts'
import type { AgentTeamMemberId } from '../src/types.ts'
import { completeTurnEvents } from './helpers/turn-events.ts'

const memberId = 'member:poison-unit' as AgentTeamMemberId
const otherMember = 'member:poison-other' as AgentTeamMemberId
const sessionId = 'session:poison-unit' as SessionId
const otherSession = 'session:poison-other' as SessionId
const signature = '400:INVALID_REQUEST'

const zeroUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

const event = (offset: number, type: string, data: unknown) => ({ seq: offset, time: offset, type, data }) as unknown as SessionEvent

describe('providerPoisonSignature (task-11 item 1)', () => {
  it('classifies a zero-usage 4xx INVALID_REQUEST rejection as the poison signature', () => {
    expect(providerPoisonSignature({ status: 400, code: 'INVALID_REQUEST' }, true)).toBe(signature)
    expect(providerPoisonSignature({ status: 422, code: 'INVALID_REQUEST' }, true)).toBe('422:INVALID_REQUEST')
  })

  it('refuses a Turn that spent tokens, a non-4xx status, a missing status, or another code', () => {
    expect(providerPoisonSignature({ status: 400, code: 'INVALID_REQUEST' }, false)).toBeUndefined()
    expect(providerPoisonSignature({ status: 503, code: 'INVALID_REQUEST' }, true)).toBeUndefined()
    expect(providerPoisonSignature({ code: 'INVALID_REQUEST' }, true)).toBeUndefined()
    expect(providerPoisonSignature({ status: 400, code: 'RATE_LIMIT' }, true)).toBeUndefined()
  })
})

describe('zeroReportedUsage (task-11 item 1)', () => {
  it('is true when the Turn reports no usage anywhere — the rejected-before-generation shape', () => {
    expect(zeroReportedUsage([])).toBe(true)
    expect(zeroReportedUsage([
      event(0, 'turn/start', { turn: 1 }),
      event(1, 'assistant/message', { turn: 1, step: 1, stream: [], message: { id: 'm', role: 'assistant', content: [] }, usage: zeroUsage }),
    ])).toBe(true)
    expect(zeroReportedUsage([
      event(0, 'assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', chunk: { type: 'usage', usage: zeroUsage } }] }),
    ])).toBe(true)
  })

  it('is false for any nonzero bucket, and for a committed message that reported no usage', () => {
    // A provable completed Turn spends tokens, so it can never look poisoned.
    expect(zeroReportedUsage(completeTurnEvents())).toBe(false)
    expect(zeroReportedUsage([
      event(0, 'assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { ...zeroUsage, outputTokens: 7 } } }] }),
    ])).toBe(false)
    // Unknown spend is not provable zero: conservatively not poisoned.
    expect(zeroReportedUsage([
      event(0, 'assistant/message', { turn: 1, step: 1, stream: [], message: { id: 'm', role: 'assistant', content: [] } }),
    ])).toBe(false)
  })
})

describe('malformedToolCallGeneration (task-11 item 3)', () => {
  const markup = 'Sure:\n<atem:function_calls>\n<default.bash command="pwd"/>\n</atem:function_calls>'
  const messageWith = (text: string, parts: unknown[]) => [
    event(0, 'assistant/message', {
      turn: 1, step: 1, stream: [],
      message: { id: 'm', role: 'assistant', content: parts.length === 0 ? [{ type: 'text', text }] : parts },
      usage: zeroUsage,
    }),
  ]

  it('flags text that emits the tool-call markup while the message has no tool-call part', () => {
    const reason = malformedToolCallGeneration(messageWith(markup, []))
    expect(reason).toContain('tool-call markup')
    expect(reason).toContain('<atem:function_calls>')
    expect(reason).toContain('no tool-call part')
  })

  it('accepts a well-formed generation: plain text, or markup alongside the real tool-call part', () => {
    expect(malformedToolCallGeneration(messageWith('plain answer', []))).toBeUndefined()
    expect(malformedToolCallGeneration(completeTurnEvents())).toBeUndefined()
    expect(malformedToolCallGeneration(messageWith(markup, [
      { type: 'text', text: markup },
      { type: 'tool-call', id: 'call-1', name: 'default.bash', arguments: '{}' },
    ]))).toBeUndefined()
  })

  it('skips markup an author quoted in a fence, inline span, or blockquote — but still flags raw prose', () => {
    expect(malformedToolCallGeneration(messageWith('As in the incident:\n```\n<atem:function_calls>\n</atem:function_calls>\n```', []))).toBeUndefined()
    expect(malformedToolCallGeneration(messageWith('The shape `<atem:function_calls>` is the tell', []))).toBeUndefined()
    expect(malformedToolCallGeneration(messageWith('> <atem:function_calls>\n> </atem:function_calls>', []))).toBeUndefined()
    // A quoted copy plus a live emission in the same message still flags.
    expect(malformedToolCallGeneration(messageWith('Quoted:\n```\n<atem:function_calls>\n```\nLive:\n<atem:function_calls>', []))).toBeDefined()
  })
})

describe('PoisonedSessionTracker (task-11 item 1)', () => {
  it('streaks identical signatures per Session and crosses exactly at the threshold', () => {
    const tracker = new PoisonedSessionTracker()
    const first = tracker.noteError(memberId, sessionId, 1, signature)
    expect(first.verdict?.failedTurns).toBe(1)
    expect(first.crossed).toBe(false)
    expect(tracker.poisoned(memberId)).toBeUndefined()

    tracker.noteError(memberId, sessionId, 2, signature)
    expect(tracker.poisoned(memberId)).toBeUndefined()

    const third = tracker.noteError(memberId, sessionId, 3, signature)
    expect(third.crossed).toBe(true)
    expect(tracker.poisoned(memberId)).toMatchObject({ failedTurns: PROVIDER_POISON_TURNS, sessionId, signature, turn: 3 })

    const fourth = tracker.noteError(memberId, sessionId, 4, signature)
    expect(fourth.crossed).toBe(false)
    expect(fourth.verdict?.failedTurns).toBe(4)
    expect(tracker.poisoned(memberId)).toMatchObject({ failedTurns: 4 })
  })

  it('scopes the verdict to the Session asked about and never to another Member', () => {
    const tracker = new PoisonedSessionTracker()
    tracker.noteError(memberId, sessionId, 1, signature)
    tracker.noteError(memberId, sessionId, 2, signature)
    tracker.noteError(memberId, sessionId, 3, signature)
    expect(tracker.poisoned(memberId, sessionId)).toBeDefined()
    expect(tracker.poisoned(memberId, otherSession)).toBeUndefined()
    expect(tracker.poisoned(otherMember)).toBeUndefined()
  })

  it('resets on a different signature, a different Session, or an unclassified failure', () => {
    const tracker = new PoisonedSessionTracker()
    tracker.noteError(memberId, sessionId, 1, signature)
    tracker.noteError(memberId, sessionId, 2, signature)
    // A different provider failure starts a fresh streak at 1, not a continuation.
    const switched = tracker.noteError(memberId, sessionId, 3, '503:UPSTREAM')
    expect(switched.verdict?.failedTurns).toBe(1)
    expect(switched.crossed).toBe(false)
    // Unclassified failure erases state entirely (changed reports the erase).
    const erased = tracker.noteError(memberId, sessionId, 4, undefined)
    expect(erased.verdict).toBeUndefined()
    expect(erased.changed).toBe(true)
    expect(tracker.poisoned(memberId)).toBeUndefined()
    // A new Session also starts over.
    tracker.noteError(memberId, otherSession, 1, signature)
    tracker.noteError(memberId, otherSession, 2, signature)
    expect(tracker.noteError(memberId, sessionId, 3, signature).crossed).toBe(false)
    expect(tracker.noteError(memberId, sessionId, 4, signature).crossed).toBe(false)
    expect(tracker.noteError(memberId, sessionId, 5, signature).crossed).toBe(true)
  })

  it('clear reports whether state existed, and clears only the asked-for Member', () => {
    const tracker = new PoisonedSessionTracker()
    expect(tracker.clear(memberId)).toBe(false)
    tracker.noteError(memberId, sessionId, 1, signature)
    tracker.noteError(otherMember, sessionId, 1, signature)
    expect(tracker.clear(memberId)).toBe(true)
    expect(tracker.clear(memberId)).toBe(false)
    expect(tracker.poisoned(memberId)).toBeUndefined()
    expect(tracker.poisoned(otherMember)).toBeUndefined()
  })
})
