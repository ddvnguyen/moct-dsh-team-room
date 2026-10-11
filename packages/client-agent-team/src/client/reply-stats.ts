import type { AgentTeamThreadReplyStat } from '@contexera/dsh-agent-team/types'

/** An unknown value: a null bucket or an unrecorded Turn. Never shown as 0. */
export const UNKNOWN = '—'

export interface ReplyStatsView {
  /** All prompt input of the Turn, or UNKNOWN when any input bucket, uncached input included, is null. */
  readonly input: string
  readonly output: string
  readonly seconds: string
  /** Cache share of all prompt input, or UNKNOWN when the buckets are incomplete. */
  readonly cache: string
  readonly tools: number
}

/** Compact token count: 980 → "980", 1234 → "1.2k", 2_000_000 → "2M". */
export function formatTokens(count: number): string {
  if (count < 1_000) return String(count)
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** Wall time of the Turn: under a second reads "<1s", otherwise whole seconds. */
export function formatSeconds(runMs: number): string {
  return runMs < 1_000 ? '<1s' : `${Math.round(runMs / 1_000)}s`
}

/**
 * The stats row for one agent reply, or undefined when the row is not shown.
 *
 * Tokens, time and tools belong to the whole Turn, so only the reply that
 * closes its Turn carries the row; earlier replies of that Turn would repeat
 * the same numbers. cache % divides the cache read by all prompt input
 * (uncached + cache read + cache write), so it is the share of the input served
 * from cache. Any null bucket makes the input and cache figures UNKNOWN.
 */
export function replyStatsView(stat: AgentTeamThreadReplyStat): ReplyStatsView | undefined {
  if (!stat.isLastOfTurn) return undefined
  const { usage, runMs, toolCalls } = stat.turn
  const uncached = usage.uncachedInputTokens
  const read = usage.cacheReadTokens
  const write = usage.cacheWriteTokens
  const total = uncached !== null && read !== null && write !== null ? uncached + read + write : undefined
  return {
    input: total === undefined ? UNKNOWN : formatTokens(total),
    output: formatTokens(usage.outputTokens),
    seconds: formatSeconds(runMs),
    cache: read !== null && total !== undefined && total > 0 ? `${Math.round((read / total) * 100)}%` : UNKNOWN,
    tools: toolCalls,
  }
}
