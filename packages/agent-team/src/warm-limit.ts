/**
 * Warm-Turn rate limit (contract §4.2): at most one warm Turn per seat per window, and
 * triggers that arrive inside the window are coalesced rather than dropped.
 *
 * Pure: the caller supplies the clock and the limit, so the policy is testable with a
 * fake clock. The default is one warm Turn per minute per seat; a larger window or a zero
 * limit (unlimited) is a per-seat configuration, never a hardcoded behavior.
 */

/** Warm Turns per window, and the window length in milliseconds. */
export interface WarmLimit {
  /** Maximum warm Turns in the window; 0 or negative means unlimited. */
  readonly perWindow: number
  readonly windowMs: number
}

/** The contract default: one warm Turn per minute per seat. */
export const DEFAULT_WARM_LIMIT: WarmLimit = Object.freeze({ perWindow: 1, windowMs: 60_000 })

export interface WarmDecisionInput {
  readonly limit: WarmLimit
  readonly nowMs: number
  /** Times of the warm Turns already started in this window, oldest first. */
  readonly recentWarmStarts: readonly number[]
}

export interface WarmDecision {
  readonly kind: 'start' | 'coalesce'
  /** The clock reading this decision was taken at. */
  readonly at: number
}

/**
 * Decide one warm trigger: start it, or coalesce it because the window is already full.
 * A coalesce records nothing, so the caller delivers the queued facts with the start it
 * already owes instead of opening a second warm Turn.
 */
export function warmDecision(input: WarmDecisionInput): WarmDecision {
  const { limit, nowMs, recentWarmStarts } = input
  if (limit.perWindow <= 0 || limit.windowMs <= 0) return { kind: 'start', at: nowMs }
  const windowStart = nowMs - limit.windowMs
  const inWindow = recentWarmStarts.filter(started => started > windowStart)
  return inWindow.length >= limit.perWindow ? { kind: 'coalesce', at: nowMs } : { kind: 'start', at: nowMs }
}
