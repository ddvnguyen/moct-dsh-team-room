/**
 * Derives one completed Turn's record from its session events (contract §3.2).
 *
 * Token buckets come from `deriveTurnTokenUsage` when it proves the whole Turn exact.
 * When it cannot, each field is kept only where it is provable (`fieldwiseTurnUsage`) and
 * the rest is null: a completed Turn is always recorded, and only a Turn with no provable
 * output count is refused. Wall times fold the Turn's own events through
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

/** Per-field usage of one Turn: null is "not provable", never 0. */
interface TurnUsageFields {
  readonly uncachedInputTokens: number | null
  readonly outputTokens: number
  readonly cacheReadTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly reasoningTokens: number | null
  readonly route?: { readonly provider: string; readonly model: string }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** The exact sum of counts, or undefined when any is not a count or the sum leaves the safe range. */
function sumCounts(values: readonly unknown[]): number | undefined {
  if (!values.every(isCount)) return undefined
  const total = values.reduce<number>((acc, value) => acc + value, 0)
  return Number.isSafeInteger(total) ? total : undefined
}

/**
 * Usage a failed attempt reported in its own stream (the last usage chunk
 * wins), or undefined when the attempt reported no usage. Attempt streams
 * carry usage and finish chunks only, never model attribution, so attempts
 * feed the summed output but never buckets or route.
 */
function attemptReportedUsage(event: SessionEvent<'assistant/attempt'>): { readonly outputTokens: unknown; readonly cacheReadTokens: unknown; readonly cacheWriteTokens: unknown; readonly reasoningTokens: unknown } | undefined {
  let reported: { readonly outputTokens: unknown; readonly cacheReadTokens: unknown; readonly cacheWriteTokens: unknown; readonly reasoningTokens: unknown } | undefined
  for (const record of event.data.stream) {
    if (record.type === 'chunk' && record.chunk.type === 'usage') {
      const usage = record.chunk.usage
      reported = { outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, reasoningTokens: usage.reasoningTokens }
    }
  }
  return reported
}

/**
 * Usage fields that are provable when the Turn as a whole is not. Output is the sum of every
 * step's reported output, which needs one sample per step and no retry (a retry can hide an
 * attempt's output). Every other field is summed only when every step reported it; uncached
 * input is never split out here, since that needs the exact derivation. Returns undefined when
 * the output count is not provable, which is the one refusal left for a completed Turn.
 *
 * Item 9 (retry-aware): a completed Turn that carries llm/retry is recorded only
 * when every attempt reported output; an attempt silent on output refuses the
 * Turn (as today). Reported attempt outputs sum in; any bucket an attempt did
 * not report stays null (partial marker, never a guess), and the route stays
 * unnamed because attempts carry no model attribution. With no attempts the
 * computation is exactly today's.
 */
function fieldwiseTurnUsage(events: readonly SessionEvent[]): TurnUsageFields | undefined {
  const steps = events.filter(event => event.type === 'step/start').length
  const messages = events.filter((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
  if (messages.length === 0 || messages.length !== steps) return undefined
  const samples = messages.map(event => event.data.usage)
  if (samples.some(usage => usage === undefined)) return undefined
  const usages = samples as NonNullable<(typeof samples)[number]>[]
  const attempts = events.filter((event): event is SessionEvent<'assistant/attempt'> => event.type === 'assistant/attempt')
  const reported = attempts.map(attemptReportedUsage)
  // Refusal (Architect ruling): an attempt that reported no output hides an
  // unknown spend — the Turn stays unrecorded rather than flooring its total.
  // Buckets an attempt was silent on still null out (partial marker) below.
  if (reported.some(usage => usage === undefined || !isCount(usage.outputTokens))) return undefined
  const outputTokens = sumCounts([...usages.map(usage => usage.outputTokens), ...reported.map(usage => usage?.outputTokens).filter(output => output !== undefined)])
  if (outputTokens === undefined) return undefined
  const bucket = (pick: (usage: { readonly cacheReadTokens?: unknown; readonly cacheWriteTokens?: unknown; readonly reasoningTokens?: unknown }) => unknown): number | null =>
    sumCounts([...usages.map(pick), ...reported.map(usage => (usage === undefined ? undefined : pick(usage)))]) ?? null
  const reasoned = usages.every(usage => isCount(usage.reasoningTokens) && usage.reasoningTokens <= usage.outputTokens)
    && reported.every(usage => usage !== undefined && isCount(usage.outputTokens) && isCount(usage.reasoningTokens) && usage.reasoningTokens <= usage.outputTokens)
  const routes = messages.map(event => event.data.message.source)
  // The route is named only when every step ran on the same provider and model,
  // and only when no attempt exists: attempts carry no attribution to compare.
  const last = routes.at(-1)
  const route = attempts.length === 0 && last !== undefined && last.provider.length > 0 && last.model.length > 0
    && routes.every(source => source.provider === last.provider && source.model === last.model)
    ? { provider: last.provider, model: last.model }
    : undefined
  return {
    uncachedInputTokens: null,
    outputTokens,
    cacheReadTokens: bucket(usage => usage.cacheReadTokens),
    cacheWriteTokens: bucket(usage => usage.cacheWriteTokens),
    reasoningTokens: reasoned ? bucket(usage => usage.reasoningTokens) : null,
    ...(route === undefined ? {} : { route }),
  }
}

/**
 * `events` must be exactly one Turn's events. Returns `undefined` when the Turn is
 * incomplete, when it ended in an error or an abort, when the window holds more than
 * one Turn, or when its output count cannot be proven. Each usage field is exact or null.
 * A wider window would fold other Turns' tool calls and ends into these numbers, so it is refused rather than summarized.
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
  const exact = deriveTurnTokenUsage(events)
  const usage: TurnUsageFields | undefined = exact === undefined
    ? fieldwiseTurnUsage(events)
    : {
      uncachedInputTokens: exact.uncachedInputTokens,
      outputTokens: exact.outputTokens,
      cacheReadTokens: exact.cacheReadTokens ?? null,
      cacheWriteTokens: exact.cacheWriteTokens ?? null,
      reasoningTokens: exact.reasoningTokens ?? null,
      ...(exact.routes?.at(-1) === undefined ? {} : { route: exact.routes.at(-1)! }),
    }
  if (usage === undefined) return undefined
  const timing = foldTurnWallTime(events)
  const route = usage.route
  return Object.freeze({
    turn: start.data.turn,
    startedAt: new Date(start.time).toISOString(),
    endedAt: new Date(end.time).toISOString(),
    toolCalls: events.filter(event => event.type === 'tool/call').length,
    runMs: timing.llmMs + timing.toolMs,
    usage: Object.freeze({
      uncachedInputTokens: usage.uncachedInputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      reasoningTokens: usage.reasoningTokens,
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
