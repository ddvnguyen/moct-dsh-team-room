/**
 * Derives one completed Turn's record from its session events (contract §3.2).
 *
 * Token buckets come from `deriveTurnTokenUsage`, which returns the exact
 * provider-reported counts or `undefined` when it cannot prove them. A Turn it
 * cannot prove is not recorded. Wall times fold the Turn's own events through
 * the same llm and tool pairing the sessionStats projection uses (turn-wall-time.ts).
 */
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { AgentTeamSessionTurnUsage } from './types.ts'
import { foldTurnWallTime } from './turn-wall-time.ts'

/** The Turn facts the ledger records: everything except the owning Member, Session, and Thread. */
export interface AgentTeamDerivedTurn {
  readonly turn: number
  readonly startedAt: string
  readonly endedAt: string
  readonly toolCalls: number
  /** llm wall time plus tool wall time for the Turn (see turn-wall-time.ts). */
  readonly runMs: number
  readonly usage: AgentTeamSessionTurnUsage
}

/**
 * `events` must be exactly one Turn's events. Returns `undefined` when the Turn is
 * incomplete, when the window holds more than one Turn, or when its usage cannot be
 * proven exact. A wider window would fold other Turns' tool calls and ends into
 * these numbers, so it is refused rather than summarized.
 */
export function deriveAgentTeamTurn(events: readonly SessionEvent[]): AgentTeamDerivedTurn | undefined {
  const starts = events.filter((event): event is SessionEvent<'turn/start'> => event.type === 'turn/start')
  const ends = events.filter((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
  const start = starts[0]
  if (start === undefined || ends.length !== 1) return undefined
  if (new Set(starts.map(event => event.data.turn)).size !== 1) return undefined
  const end = ends[0]!
  const usage = deriveTurnTokenUsage(events)
  if (usage === undefined) return undefined
  const timing = foldTurnWallTime(events)
  const route = usage.routes?.at(-1)
  return Object.freeze({
    turn: start.data.turn,
    startedAt: new Date(start.time).toISOString(),
    endedAt: new Date(end.time).toISOString(),
    toolCalls: events.filter(event => event.type === 'tool/call').length,
    runMs: timing.llmMs + timing.toolMs,
    usage: Object.freeze({
      uncachedInputTokens: usage.uncachedInputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? null,
      cacheWriteTokens: usage.cacheWriteTokens ?? null,
      reasoningTokens: usage.reasoningTokens ?? null,
      ...(route === undefined ? {} : { route: Object.freeze({ provider: route.provider, model: route.model }) }),
    }),
  })
}
