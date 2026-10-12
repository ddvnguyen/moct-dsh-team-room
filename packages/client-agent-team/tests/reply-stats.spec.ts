import { describe, expect, it } from 'vitest'
import type { AgentTeamMemberId, AgentTeamMessageRef, AgentTeamThreadReplyStat } from 'moct-dsh-team-room/types'
import { formatSeconds, formatTokens, replyStatsView, UNKNOWN } from '../src/client/reply-stats.ts'

/** A reply stat with the Turn's usage; unset fields take the 1.2k / 340 / 12s / 7 tools fixture. */
function stat(options: { isLastOfTurn?: boolean; uncached?: number | null; read?: number | null; write?: number | null; output?: number; runMs?: number; tools?: number } = {}): AgentTeamThreadReplyStat {
  return {
    messageRef: 'message:1' as AgentTeamMessageRef,
    memberId: 'member:builder' as AgentTeamMemberId,
    isLastOfTurn: options.isLastOfTurn ?? true,
    turn: {
      toolCalls: options.tools ?? 7,
      runMs: options.runMs ?? 12_000,
      usage: {
        uncachedInputTokens: options.uncached === undefined ? 200 : options.uncached,
        cacheReadTokens: options.read === undefined ? 1_000 : options.read,
        cacheWriteTokens: options.write === undefined ? 0 : options.write,
        outputTokens: options.output ?? 340,
        reasoningTokens: null,
      },
    } as AgentTeamThreadReplyStat['turn'],
  }
}

describe('reply stats row', () => {
  it('shows input, output, time, cache share and tools when every bucket is recorded', () => {
    // 200 uncached + 1000 read + 0 written = 1200 input; cache % = 1000 / 1200.
    expect(replyStatsView(stat())).toEqual({ input: '1.2k', partialInput: false, output: '340', seconds: '12s', cache: '83%', tools: 7 })
  })

  it('shows the recorded uncached figure as a lower bound when a cache bucket is null, never 0', () => {
    // TEST Turn 1 shape: uncached 37866 recorded, cache buckets null.
    expect(replyStatsView(stat({ write: null }))).toEqual({ input: '200', partialInput: true, output: '340', seconds: '12s', cache: UNKNOWN, tools: 7 })
    expect(replyStatsView(stat({ read: null }))).toEqual({ input: '200', partialInput: true, output: '340', seconds: '12s', cache: UNKNOWN, tools: 7 })
    expect(replyStatsView(stat({ uncached: 37866, read: null, write: null }))).toEqual({ input: '37.9k', partialInput: true, output: '340', seconds: '12s', cache: UNKNOWN, tools: 7 })
  })

  it('shows the unknown dash for input when the uncached split is null, while output and time stay exact', () => {
    // Turn 5 of session aeca99c0: output is provable (297), the uncached split is not.
    expect(replyStatsView(stat({ uncached: null, read: null, write: null, output: 297 }))).toEqual({ input: UNKNOWN, partialInput: false, output: '297', seconds: '12s', cache: UNKNOWN, tools: 7 })
  })

  it('shows no row on a reply that is not the last of its Turn, so the Turn totals are not repeated', () => {
    expect(replyStatsView(stat({ isLastOfTurn: false }))).toBeUndefined()
  })

  it('shows the unknown dash for cache when the Turn had no prompt input at all', () => {
    expect(replyStatsView(stat({ uncached: 0, read: 0, write: 0 }))).toEqual({ input: '0', partialInput: false, output: '340', seconds: '12s', cache: UNKNOWN, tools: 7 })
  })
})

describe('reply stats formatting', () => {
  it('compacts token counts', () => {
    expect(formatTokens(980)).toBe('980')
    expect(formatTokens(1_234)).toBe('1.2k')
    expect(formatTokens(2_000)).toBe('2k')
    expect(formatTokens(2_000_000)).toBe('2M')
  })

  it('reads a sub-second Turn as under one second', () => {
    expect(formatSeconds(400)).toBe('<1s')
    expect(formatSeconds(12_400)).toBe('12s')
  })
})
