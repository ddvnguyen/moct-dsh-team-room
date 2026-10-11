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
    // A step without totalTokens or cache fields cannot be exact, so the whole Turn is not exact.
    const events = completeTurnEvents().map(event => event.type === 'assistant/message'
      ? { ...event, data: { ...(event.data as object), usage: { inputTokens: 34491, outputTokens: 127 }, stream: [] } } as never
      : event)
    expect(unprovableUsageReason(events)).toBe('1 assistant messages, 0 without usage, 1 without both cache fields, 1 without totalTokens, 0 retries')
  })

  it('keeps each provable field of a Turn whose exact usage is not provable, and nulls the rest', () => {
    // The shape of session aeca99c0 turn 5: three steps, the first with no cache fields, the others with cacheReadTokens only.
    const turn5 = [
      { type: 'turn/start', seq: 1, time: Date.UTC(2026, 9, 11, 2, 38, 40), data: { turn: 5 } },
      { type: 'step/start', seq: 2, time: Date.UTC(2026, 9, 11, 2, 38, 41), data: { turn: 5, step: 1 } },
      { type: 'assistant/message', seq: 3, time: Date.UTC(2026, 9, 11, 2, 38, 42), data: { turn: 5, step: 1, message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'opencode2dsh', model: 'mimo-v2.6-flash-free' } }, usage: { inputTokens: 34491, outputTokens: 127 } } },
      { type: 'step/end', seq: 4, time: Date.UTC(2026, 9, 11, 2, 38, 43), data: { turn: 5, step: 1 } },
      { type: 'step/start', seq: 5, time: Date.UTC(2026, 9, 11, 2, 38, 44), data: { turn: 5, step: 2 } },
      { type: 'assistant/message', seq: 6, time: Date.UTC(2026, 9, 11, 2, 38, 45), data: { turn: 5, step: 2, message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'opencode2dsh', model: 'mimo-v2.6-flash-free' } }, usage: { inputTokens: 436, outputTokens: 126, cacheReadTokens: 34432 } } },
      { type: 'step/end', seq: 7, time: Date.UTC(2026, 9, 11, 2, 38, 46), data: { turn: 5, step: 2 } },
      { type: 'step/start', seq: 8, time: Date.UTC(2026, 9, 11, 2, 38, 47), data: { turn: 5, step: 3 } },
      { type: 'assistant/message', seq: 9, time: Date.UTC(2026, 9, 11, 2, 38, 48), data: { turn: 5, step: 3, message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'opencode2dsh', model: 'mimo-v2.6-flash-free' } }, usage: { inputTokens: 307, outputTokens: 44, cacheReadTokens: 34816 } } },
      { type: 'step/end', seq: 10, time: Date.UTC(2026, 9, 11, 2, 38, 49), data: { turn: 5, step: 3 } },
      { type: 'turn/end', seq: 11, time: Date.UTC(2026, 9, 11, 2, 39, 12), data: { turn: 5, reason: { kind: 'completed' } } },
    ] as never
    expect(deriveAgentTeamTurn(turn5)).toMatchObject({
      turn: 5,
      usage: {
        uncachedInputTokens: null,
        outputTokens: 297,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningTokens: null,
        route: { provider: 'opencode2dsh', model: 'mimo-v2.6-flash-free' },
      },
    })
  })

  it('refuses a completed Turn with a step that reported no usage, since its output is not provable', () => {
    const events = completeTurnEvents().map(event => event.type === 'assistant/message'
      ? { ...event, data: { ...(event.data as object), usage: undefined, stream: [] } } as never
      : event)
    expect(deriveAgentTeamTurn(events)).toBeUndefined()
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
