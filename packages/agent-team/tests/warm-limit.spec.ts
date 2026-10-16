/**
 * Warm-Turn limit (contract §4.2): one warm Turn per seat per minute by default, and a
 * trigger inside the window is coalesced rather than dropped. Fails closed to the limit,
 * so each assertion below fails without its fix.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_WARM_LIMIT, warmDecision } from '../src/warm-limit.ts'

describe('warmDecision (contract §4.2 warm limit)', () => {
  it('starts the first warm Turn of a window', () => {
    expect(warmDecision({ limit: DEFAULT_WARM_LIMIT, nowMs: 1_000, recentWarmStarts: [] })).toEqual({ kind: 'start', at: 1_000 })
  })

  it('coalesces a second warm trigger inside the window', () => {
    const first = 1_000
    expect(warmDecision({ limit: DEFAULT_WARM_LIMIT, nowMs: first + 30_000, recentWarmStarts: [first] })).toEqual({ kind: 'coalesce', at: first + 30_000 })
  })

  it('starts again once the window has moved past the earlier start', () => {
    const first = 1_000
    expect(warmDecision({ limit: DEFAULT_WARM_LIMIT, nowMs: first + 60_001, recentWarmStarts: [first] })).toEqual({ kind: 'start', at: first + 60_001 })
  })

  it('counts only the starts still inside the window', () => {
    const limit = { perWindow: 2, windowMs: 60_000 }
    const now = 100_000
    expect(warmDecision({ limit, nowMs: now, recentWarmStarts: [now - 90_000, now - 30_000] })).toEqual({ kind: 'start', at: now })
    expect(warmDecision({ limit, nowMs: now, recentWarmStarts: [now - 30_000, now - 10_000] })).toEqual({ kind: 'coalesce', at: now })
  })

  it('a zero or negative limit is unlimited, and a zero window never coalesces', () => {
    expect(warmDecision({ limit: { perWindow: 0, windowMs: 60_000 }, nowMs: 5, recentWarmStarts: [4, 3, 2, 1] })).toEqual({ kind: 'start', at: 5 })
    expect(warmDecision({ limit: { perWindow: 1, windowMs: 0 }, nowMs: 5, recentWarmStarts: [4, 3, 2, 1] })).toEqual({ kind: 'start', at: 5 })
  })
})
