/**
 * D7 usage cache backfill (Architect ruling): an attempt's unreported cache
 * bucket resolves to 0 iff totalTokens is present, reasoningTokens is absent,
 * and totalTokens === inputTokens + outputTokens + reported cache buckets
 * (strict equality). Anything else stays null as today; reasoningTokens is
 * never backfilled.
 *
 * Main fixture mirrors TEST Turn 1 of session agent-team-c9b8b10a (op 95),
 * confirmed from the session log: attempt 1 {37402, 273, total 37675} with no
 * cache fields (37402+273 = 37675, provably cache-free), attempt 2
 * {261, 218, total 38111, read 37632}, attempt 3 {203, 63, total 38282, read
 * 38016}. Correct row: uncached 37866, output 554, cacheRead 75648,
 * cacheWrite 0 (37866+554+75648 = 114068, the Agent page's 114K at 67%).
 */
import { describe, expect, it } from 'vitest'
import { deriveAgentTeamTurn } from '../src/session-turn-usage.ts'

const T = Date.UTC(2026, 9, 12, 2, 0, 0)
const SOURCE = { kind: 'model', provider: 'dsh-opencode-go', model: 'deepseek-v4.1-flash' }

function message(step: number, usage: unknown, offset: number) {
  return {
    type: 'assistant/message',
    time: T + offset + 1000,
    data: {
      turn: 1, step,
      stream: [{ type: 'chunk', time: T + offset + 1000, chunk: { type: 'usage', usage } }],
      message: { id: `m${step}`, role: 'assistant', content: [], source: SOURCE },
      usage,
    },
  }
}

function step(step: number, usage: unknown) {
  const offset = step * 4000
  return [
    { type: 'step/start', time: T + offset, data: { turn: 1, step } },
    message(step, usage, offset),
    { type: 'step/end', time: T + offset + 2000, data: { turn: 1, step } },
  ]
}

function turn(children: unknown[], endOffset: number) {
  return [
    { type: 'turn/start', time: T, data: { turn: 1 } },
    ...children,
    { type: 'turn/end', time: T + endOffset, data: { turn: 1, reason: { kind: 'completed' } } },
  ] as Parameters<typeof deriveAgentTeamTurn>[0]
}

describe('D7 usage cache backfill (provable zero, never a guess)', () => {
  it('records TEST Turn 1 with backfilled cache: 75648 read, 0 written', () => {
    const events = turn([
      ...step(1, { inputTokens: 37402, outputTokens: 273, totalTokens: 37675 }),
      ...step(2, { inputTokens: 261, outputTokens: 218, totalTokens: 38111, cacheReadTokens: 37632 }),
      ...step(3, { inputTokens: 203, outputTokens: 63, totalTokens: 38282, cacheReadTokens: 38016 }),
    ], 15000)
    const derived = deriveAgentTeamTurn(events)
    expect(derived, 'the Turn must be recorded').toBeDefined()
    expect(derived!.usage).toEqual({
      uncachedInputTokens: 37866,
      outputTokens: 554,
      cacheReadTokens: 75648,
      cacheWriteTokens: 0,
      reasoningTokens: null,
      route: { provider: 'dsh-opencode-go', model: 'deepseek-v4.1-flash' },
    })
  })

  it('leaves the bucket null when totalTokens is absent', () => {
    const events = turn([...step(1, { inputTokens: 100, outputTokens: 20 })], 5000)
    const derived = deriveAgentTeamTurn(events)
    expect(derived, 'the Turn still records with partial markers').toBeDefined()
    expect(derived!.usage.outputTokens).toBe(20)
    expect(derived!.usage.cacheReadTokens).toBeNull()
    expect(derived!.usage.cacheWriteTokens).toBeNull()
  })

  it('leaves the bucket null when the total mismatches', () => {
    const events = turn([...step(1, { inputTokens: 100, outputTokens: 20, totalTokens: 999 })], 5000)
    const derived = deriveAgentTeamTurn(events)
    expect(derived, 'the Turn still records with partial markers').toBeDefined()
    expect(derived!.usage.cacheReadTokens).toBeNull()
    expect(derived!.usage.cacheWriteTokens).toBeNull()
  })

  it('leaves the bucket null when a silent attempt is not backfillable', () => {
    const attemptUsage = { inputTokens: 0, outputTokens: 0 }
    const events = turn([
      { type: 'step/start', time: T + 4000, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/attempt', time: T + 4500,
        data: { turn: 1, step: 1, stream: [{ type: 'chunk', time: T + 4500, chunk: { type: 'usage', usage: attemptUsage } }] },
      },
      message(1, { inputTokens: 100, outputTokens: 20, totalTokens: 170, cacheReadTokens: 50, cacheWriteTokens: 0 }, 4000),
      { type: 'step/end', time: T + 6000, data: { turn: 1, step: 1 } },
    ], 8000)
    const derived = deriveAgentTeamTurn(events)
    expect(derived, 'the Turn still records with partial markers').toBeDefined()
    expect(derived!.usage.outputTokens).toBe(20)
    expect(derived!.usage.cacheReadTokens).toBeNull()
  })

  it('records 0/0 when every silent sample is provably cache-free', () => {
    const attemptUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    const events = turn([
      { type: 'step/start', time: T + 4000, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/attempt', time: T + 4500,
        data: { turn: 1, step: 1, stream: [{ type: 'chunk', time: T + 4500, chunk: { type: 'usage', usage: attemptUsage } }] },
      },
      message(1, { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, 4000),
      { type: 'step/end', time: T + 6000, data: { turn: 1, step: 1 } },
    ], 8000)
    const derived = deriveAgentTeamTurn(events)
    expect(derived, 'the Turn must be recorded').toBeDefined()
    expect(derived!.usage.cacheReadTokens).toBe(0)
    expect(derived!.usage.cacheWriteTokens).toBe(0)
  })
})
