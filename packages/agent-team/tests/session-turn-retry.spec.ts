/**
 * D7 item 9 (retry-aware usage): a completed Turn that carries `llm/retry` is
 * recorded when every attempt's usage is reported, else with a `partial`
 * marker (nulls where unprovable, never a guess). The exact-usage path is
 * unchanged; only the fieldwise fallback learned retries.
 *
 * Fixture: `fixtures/turn9-retried.json` — Turn 9 of a real TEST session log
 * (`lead-s.jsonl`): completed, 40 steps, 40 assistant messages, 3 retried
 * steps whose failed attempts reported zero usage. Model-facing text, tool
 * arguments/results bodies, and unrelated bodies are redacted; every input
 * the derivation reads (turn/step pairing, times, usage samples, sources,
 * retry/attempt events, tool callId pairing) is preserved verbatim, and the
 * redacted Turn derives byte-identically to the full one (proven in the lane,
 * not asserted here). Before item 9 this Turn derived `undefined` (refused by
 * the blanket llm/retry rule) and went unrecorded.
 *
 * Revert-checked: restoring the blanket refusal fails the first test; the
 * second test pins the pre-existing suite green (non-retried Turns
 * byte-identical to today).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deriveAgentTeamTurn, unprovableUsageReason } from '../src/session-turn-usage.ts'

const events = JSON.parse(readFileSync(new URL('./fixtures/turn9-retried.json', import.meta.url), 'utf8')) as Parameters<typeof deriveAgentTeamTurn>[0]

describe('D7 item 9 retry-aware usage (partial marker, never a guess)', () => {
  it('records a real completed retried Turn with nulls where the attempts proved nothing', () => {
    const derived = deriveAgentTeamTurn(events)
    expect(derived, 'a completed retried Turn must be recorded, not refused').toBeDefined()
    expect(derived).toEqual({
      turn: 9,
      startedAt: '2026-10-10T07:10:22.044Z',
      endedAt: '2026-10-10T07:38:36.083Z',
      toolCalls: 50,
      runMs: 1692784,
      usage: {
        uncachedInputTokens: null,
        // 40 message samples plus the 3 failed attempts' reported zeros.
        outputTokens: 31911,
        // Partial markers: the attempts reported no cache split and no
        // reasoning, so the buckets stay null instead of summing
        // message-only numbers as if they were the whole Turn.
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningTokens: null,
      },
    })
    // No route: attempts carry no model attribution, so naming the messages'
    // route would vouch for attempts it never saw.
    expect(derived!.usage).not.toHaveProperty('route')
  })

  it('still names the refusal reason with the retry count for a Turn that cannot prove output', () => {
    const noOutput = events.filter(event => event.type !== 'assistant/message')
    expect(deriveAgentTeamTurn(noOutput)).toBeUndefined()
    expect(unprovableUsageReason(noOutput)).toMatch(/3 retries/)
  })
})
