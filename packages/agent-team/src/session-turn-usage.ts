/**
 * Derives one completed Turn's record from its session events (contract §3.2).
 *
 * Token buckets come from `deriveTurnTokenUsage`, which returns the exact
 * provider-reported counts or `undefined` when it cannot prove them. A Turn it
 * cannot prove is not recorded. Wall times fold the Turn's own events through
 * the sessionStats projection, so llm and tool time pair exactly as the session
 * UI shows them.
 */
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import { sessionStatsProjectionDefinition } from '@deepseek-ai/dsh-session-stats/src/projection.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { AgentTeamSessionTurnUsage } from './types.ts'

/** The Turn facts the ledger records: everything except the owning Member, Session, and Thread. */
export interface AgentTeamDerivedTurn {
  readonly turn: number
  readonly startedAt: string
  readonly endedAt: string
  readonly toolCalls: number
  /** llm wall time plus tool wall time for the Turn (session-stats llmMs + toolMs). */
  readonly runMs: number
  readonly usage: AgentTeamSessionTurnUsage
}

/** Returns `undefined` when the Turn is incomplete or its usage cannot be proven exact. */
export function deriveAgentTeamTurn(events: readonly SessionEvent[]): AgentTeamDerivedTurn | undefined {
  const starts = events.filter((event): event is SessionEvent<'turn/start'> => event.type === 'turn/start')
  const ends = events.filter((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
  const start = starts[0]
  const end = ends.at(-1)
  if (start === undefined || end === undefined) return undefined
  const usage = deriveTurnTokenUsage(events)
  if (usage === undefined) return undefined
  // Fold only this Turn's events through the stats projection, from a clean state.
  const definition = sessionStatsProjectionDefinition
  const timing = events.reduce((state, event) => definition.apply(state, event), definition.init())
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
