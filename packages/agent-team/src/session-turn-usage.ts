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
 * incomplete, when it ended in an error or an abort, when the window holds more than
 * one Turn, or when its usage cannot be proven exact. A wider window would fold other Turns' tool calls and ends into
 * these numbers, so it is refused rather than summarized.
 */
export function deriveAgentTeamTurn(events: readonly SessionEvent[]): AgentTeamDerivedTurn | undefined {
  const starts = events.filter((event): event is SessionEvent<'turn/start'> => event.type === 'turn/start')
  const ends = events.filter((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
  const start = starts[0]
  if (start === undefined || ends.length !== 1) return undefined
  if (new Set(starts.map(event => event.data.turn)).size !== 1) return undefined
  const end = ends[0]!
  // Only a completed Turn is a settled record. An errored or aborted Turn can carry a
  // zero usage sample from a failed provider call; that is not proof of zero tokens.
  if (end.data.reason.kind !== 'completed') return undefined
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

/**
 * Why a completed Turn's usage was refused, for the host log. It counts the samples that
 * lack each field the proof needs; it never carries a token value or provider text.
 */
export function unprovableUsageReason(events: readonly SessionEvent[]): string {
  const end = events.find((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
  if (end === undefined) return 'the Turn has no turn/end'
  if (end.data.reason.kind !== 'completed') return `the Turn ended ${end.data.reason.kind}`
  const samples = events.filter((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
  // llm/retry is not in the dsh-session event union, but the session file carries it (token-meter reads it the same way).
  const retries = events.filter(event => (event.type as string) === 'llm/retry').length
  const noUsage = samples.filter(event => event.data.usage === undefined).length
  const noCacheFields = samples.filter(event => event.data.usage !== undefined
    && (event.data.usage.cacheReadTokens === undefined || event.data.usage.cacheWriteTokens === undefined)).length
  const noTotal = samples.filter(event => event.data.usage?.totalTokens === undefined).length
  return `${samples.length} assistant messages, ${noUsage} without usage, ${noCacheFields} without both cache fields, `
    + `${noTotal} without totalTokens, ${retries} retries`
}
