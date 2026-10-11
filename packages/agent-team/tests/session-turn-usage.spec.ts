import { describe, expect, it } from 'vitest'
import { deriveAgentTeamTurn, unprovableUsageReason } from '../src/session-turn-usage.ts'
import { completeTurnEvents } from './helpers/turn-events.ts'

describe('deriveAgentTeamTurn (§3.2)', () => {
  it('derives one provable Turn: exact usage, route, timing and tool count', () => {
    const turn = deriveAgentTeamTurn(completeTurnEvents({ turn: 3, startTime: Date.UTC(2026, 9, 11, 1, 0, 0) }))
    expect(turn).toMatchObject({
      turn: 3,
      startedAt: '2026-10-11T01:00:00.000Z',
      endedAt: '2026-10-11T01:00:04.000Z',
      toolCalls: 0,
      usage: {
        uncachedInputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 50,
        cacheWriteTokens: 0,
        reasoningTokens: null,
        route: { provider: 'deepseek', model: 'deepseek-chat' },
      },
    })
    expect(turn!.runMs).toBeGreaterThanOrEqual(0)
  })

  it('refuses a Turn whose turn/end never arrived', () => {
    const events = completeTurnEvents()
    expect(deriveAgentTeamTurn(events.slice(0, -1))).toBeUndefined()
  })

  it('refuses a Turn whose usage cannot be proven exact', () => {
    const events = completeTurnEvents().map(event => event.type === 'assistant/message'
      ? { ...event, data: { ...(event.data as object), usage: undefined, stream: [] } } as never
      : event)
    expect(deriveAgentTeamTurn(events)).toBeUndefined()
  })

  it('names why a completed Turn was refused, counting the samples that lack the proof fields', () => {
    // The shape of session aeca99c0 turn 5: no totalTokens and no cache fields on the step samples.
    const events = completeTurnEvents().map(event => event.type === 'assistant/message'
      ? { ...event, data: { ...(event.data as object), usage: { inputTokens: 34491, outputTokens: 127 }, stream: [] } } as never
      : event)
    expect(deriveAgentTeamTurn(events)).toBeUndefined()
    expect(unprovableUsageReason(events)).toBe('1 assistant messages, 0 without usage, 1 without both cache fields, 1 without totalTokens, 0 retries')
  })

  it('refuses a Turn that ended in an error, even when its failed attempt reported zero usage', () => {
    // The shape of a failed provider call: the attempt's usage chunk reads 0/0/0 and turn/end carries the error.
    const events = completeTurnEvents().map(event => event.type === 'turn/end'
      ? { ...event, data: { turn: event.data.turn, reason: { kind: 'error', error: { message: '400: MissingSessionID' } } } } as never
      : event)
    expect(deriveAgentTeamTurn(events)).toBeUndefined()
  })

  it('still records a completed Turn whose provider reports zero tokens', () => {
    const events = completeTurnEvents().map(event => event.type === 'assistant/message'
      ? { ...event, data: { ...(event.data as object), usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, stream: [] } } as never
      : event)
    expect(deriveAgentTeamTurn(events)).toMatchObject({ usage: { uncachedInputTokens: 0, outputTokens: 0 } })
  })

  it('refuses a window that holds more than one Turn', () => {
    const first = completeTurnEvents({ turn: 1 })
    const second = completeTurnEvents({ turn: 2, firstSeq: 10, startTime: Date.UTC(2026, 9, 11, 1, 1, 0) })
    expect(deriveAgentTeamTurn([...first, ...second])).toBeUndefined()
  })
})
