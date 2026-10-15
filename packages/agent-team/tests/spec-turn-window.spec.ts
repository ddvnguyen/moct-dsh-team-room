import { describe, expect, it } from 'vitest'
import { agentTeamOperationSchema } from '../src/spec.ts'

// The Turn record's window fields are optional and must survive schema validation: a windowed
// Turn keeps its window on the way in, and an old-shape Turn (no window) still parses.
const turn = {
  sequence: 7, operationId: 'operation:turn-1', requestId: 'turn:session:1', occurredAt: '2026-10-11T02:00:00.000Z',
  actor: { kind: 'member', memberId: 'member:a', handle: 'a' }, previousOperationId: null, kind: 'team/session-turn-recorded',
  data: {
    workspaceId: 'workspace:alpha', memberId: 'member:a', sessionId: 'session:a', threadRefs: [], turn: 1,
    startedAt: '2026-10-11T02:00:00.000Z', endedAt: '2026-10-11T02:00:04.000Z', toolCalls: 0, runMs: 4000,
    usage: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0, reasoningTokens: null },
  },
}

describe('session-turn-recorded schema (§3.2)', () => {
  it('keeps the window fields of a windowed Turn', () => {
    const parsed = agentTeamOperationSchema.parse({ ...turn, data: { ...turn.data, startSequence: 6, endSequence: 9 } })
    expect(parsed.kind === 'team/session-turn-recorded' && parsed.data).toMatchObject({ startSequence: 6, endSequence: 9 })
  })

  it('parses an old-shape Turn without the window fields', () => {
    const parsed = agentTeamOperationSchema.parse(turn)
    expect(parsed.kind === 'team/session-turn-recorded' && parsed.data).not.toHaveProperty('startSequence')
  })
})

// The uncached input is nullable (an unprovable split), but never a string or a negative count: the schema stays strict.
describe('session-turn-recorded usage shape (§3.2)', () => {
  const withUncached = (uncachedInputTokens: unknown) => ({ ...turn, data: { ...turn.data, usage: { ...turn.data.usage, uncachedInputTokens } } })

  it('parses the old numeric shape unchanged', () => {
    const parsed = agentTeamOperationSchema.parse(withUncached(100))
    expect(parsed.kind === 'team/session-turn-recorded' && parsed.data.usage.uncachedInputTokens).toBe(100)
  })

  it('parses a null uncached input, which is unknown and not zero', () => {
    const parsed = agentTeamOperationSchema.parse(withUncached(null))
    expect(parsed.kind === 'team/session-turn-recorded' && parsed.data.usage.uncachedInputTokens).toBeNull()
  })

  it('rejects a string, a negative count and a fractional count', () => {
    expect(() => agentTeamOperationSchema.parse(withUncached('100'))).toThrow()
    expect(() => agentTeamOperationSchema.parse(withUncached(-1))).toThrow()
    expect(() => agentTeamOperationSchema.parse(withUncached(1.5))).toThrow()
  })
})
