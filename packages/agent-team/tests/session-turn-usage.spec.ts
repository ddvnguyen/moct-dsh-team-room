import { describe, expect, it } from 'vitest'
import { deriveAgentTeamTurn } from '../src/session-turn-usage.ts'
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

  it('refuses a window that holds more than one Turn', () => {
    const first = completeTurnEvents({ turn: 1 })
    const second = completeTurnEvents({ turn: 2, firstSeq: 10, startTime: Date.UTC(2026, 9, 11, 1, 1, 0) })
    expect(deriveAgentTeamTurn([...first, ...second])).toBeUndefined()
  })
})
