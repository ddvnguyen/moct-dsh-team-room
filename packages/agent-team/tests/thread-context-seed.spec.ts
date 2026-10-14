import { describe, expect, it } from 'vitest'
import { buildThreadContextSeed } from '../src/thread-context-seed.ts'

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
