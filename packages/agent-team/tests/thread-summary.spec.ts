import { describe, expect, it } from 'vitest'
import { DEFAULT_THREAD_SUMMARY_POLICY, SUMMARY_INPUT_TOKEN_CAP, buildSummaryInput, estimateTokens, selectSummaryWindow, summaryDue } from '../src/thread-summary.ts'

describe('thread summary policy and budget (§3.3)', () => {
  it('estimates one token per three UTF-8 bytes, rounding up', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abc')).toBe(1)
    expect(estimateTokens('abcd')).toBe(2)
    // Multi-byte characters count their bytes, so the estimate never undercounts.
    expect(estimateTokens('é')).toBe(1)
  })

  it('is due at the turn threshold or the token threshold, and never when disabled', () => {
    const policy = DEFAULT_THREAD_SUMMARY_POLICY
    expect(policy).toMatchObject({ enabled: true, everyTurns: 20, everyTokens: 100_000 })
    expect(summaryDue({ turns: 19, tokens: 99_999 }, policy)).toBe(false)
    expect(summaryDue({ turns: 20, tokens: 0 }, policy)).toBe(true)
    expect(summaryDue({ turns: 0, tokens: 100_000 }, policy)).toBe(true)
    expect(summaryDue({ turns: 20, tokens: 0 }, { ...policy, enabled: false })).toBe(false)
  })

  it('frames the prior summary and the new Messages, citing each Message handle', () => {
    const input = buildSummaryInput('Earlier: a plan.', [{ messageRef: 'message:m1', sender: 'seat-a', body: 'ship it' }])
    expect(input).toMatchObject({ ok: true })
    if (!input.ok) throw new Error('expected an in-budget input')
    expect(input.transcript).toBe('Prior summary:\nEarlier: a plan.\nMessages:\n[message:m1] seat-a: ship it')
    expect(input.system).toContain('Cite each claim')
  })

  it('refuses over-cap input without truncating it', () => {
    const body = 'x'.repeat(SUMMARY_INPUT_TOKEN_CAP * 3 + 1)
    const input = buildSummaryInput(undefined, [{ messageRef: 'message:big', sender: 'seat-a', body }])
    expect(input.ok).toBe(false)
    expect(input.tokens).toBeGreaterThan(SUMMARY_INPUT_TOKEN_CAP)
  })

  it('takes the oldest Messages that fit whole, and stops before the one that would cross the cap', () => {
    const big = (ref: string) => ({ messageRef: ref, sender: 'seat-a', body: 'z'.repeat(40_000) })
    const window = selectSummaryWindow(undefined, [big('message:1'), big('message:2'), big('message:3')])
    expect(window).toMatchObject({ ok: true, included: 2 })
    if (!window.ok) throw new Error('expected a window')
    expect(window.input.tokens).toBeLessThanOrEqual(SUMMARY_INPUT_TOKEN_CAP)
    expect(window.input.transcript).toContain('[message:2]')
    expect(window.input.transcript).not.toContain('[message:3]')
  })

  it('reports no window only when the first Message alone exceeds the cap', () => {
    const huge = { messageRef: 'message:huge', sender: 'seat-a', body: 'z'.repeat(SUMMARY_INPUT_TOKEN_CAP * 3) }
    expect(selectSummaryWindow(undefined, [huge])).toMatchObject({ ok: false })
  })
})
