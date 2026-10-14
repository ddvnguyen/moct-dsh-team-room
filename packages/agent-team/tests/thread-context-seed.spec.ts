import { describe, expect, it } from 'vitest'

import { buildThreadContextSeed } from '../src/thread-context-seed'
import { estimateTokens } from '../src/thread-summary'

describe('A7b next-prompt context seed', () => {
  it('includes the latest summary generation and text before the tail-10 messages', () => {
    const seed = buildThreadContextSeed({
      summary: { generation: 3, text: 'Seeded summary' },
      messages: [
        { messageRef: 'message:m1', sender: 'seat-a', body: 'first' },
        { messageRef: 'message:m2', sender: 'seat-b', body: 'second' },
      ],
    })
    expect(seed).toContain('Latest summary (generation 3):')
    expect(seed).toContain('Seeded summary')
    expect(seed).toContain('[message:m2] seat-b: second')
    expect(seed.indexOf('Seeded summary')).toBeLessThan(seed.indexOf('[message:m1] seat-a: first'))
  })

  it('states explicitly that no summary exists', () => {
    const seed = buildThreadContextSeed({ messages: [] })
    expect(seed).toContain('Latest summary (generation 0): (none)')
    expect(seed).toContain('Recent messages (last 10):')
  })
})

describe('AgentTeam thread context seed truncation (A7b, §3.3 budget)', () => {
  it('caps an oversized Message body with an explicit [truncated] marker and keeps the seed within the budget', () => {
    const huge = 'x'.repeat(120_000) // far above the 8k-token per-body cap
    const small = 'normal body'
    const seed = buildThreadContextSeed({
      messages: [
        { messageRef: 'message:1111', sender: 'alice', body: small },
        { messageRef: 'message:2222', sender: 'bob', body: huge },
      ],
    }, { tokens: 32_000 })
    expect(seed).toContain('[truncated]')
    expect(seed).not.toContain(huge)
    expect(seed).toContain('[message:1111] alice: normal body')
    expect(seed).toContain('[message:2222] bob: ')
    // tokens ≈ bytes/3 → 32k tokens ≈ 96k chars; the seed must be far under
    expect(seed.length).toBeLessThan(96_000)
    expect(estimateTokens(seed)).toBeLessThanOrEqual(32_000)
  })
})
