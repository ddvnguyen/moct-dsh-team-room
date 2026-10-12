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
 * One attempt's usage sample for cache resolution, from a message's reported
 * usage (or its stream fallback, mirroring the exact derivation) or an
 * attempt's stream. Every field is unknown-typed: presence is proven below,
 * never assumed from the shape.
 */
interface AttemptSample {
  readonly inputTokens: unknown
  readonly outputTokens: unknown
  readonly totalTokens: unknown
  readonly cacheReadTokens: unknown
  readonly cacheWriteTokens: unknown
  readonly reasoningTokens: unknown
}

/** The last usage chunk of an attempt stream, or undefined when it reports none. */
function lastStreamUsage(stream: SessionEvent<'assistant/message'>['data']['stream']): AttemptSample | undefined {
  let reported: AttemptSample | undefined
  for (const record of stream) {
    if (record.type === 'chunk' && record.chunk.type === 'usage') {
      const usage = record.chunk.usage
      reported = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, reasoningTokens: usage.reasoningTokens }
    }
  }
  return reported
}

/**
 * Usage a failed attempt reported in its own stream (the last usage chunk
 * wins), or undefined when the attempt reported no usage. Attempt streams
 * carry usage and finish chunks only, never model attribution, so attempts
 * feed the summed output but never buckets or route.
 */
function attemptReportedUsage(event: SessionEvent<'assistant/attempt'>): AttemptSample | undefined {
  return lastStreamUsage(event.data.stream)
}

/** A message's sample: its reported usage, else the last usage chunk of its stream. */
function messageSample(event: SessionEvent<'assistant/message'>): AttemptSample | undefined {
  const usage = event.data.usage
  if (usage !== undefined) {
    return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, reasoningTokens: usage.reasoningTokens }
  }
  return lastStreamUsage(event.data.stream)
}

/**
 * One attempt's cache bucket, reported or provably zero (Architect ruling):
 * an unreported bucket is 0 iff totalTokens is present, reasoningTokens is
 * absent (reported reasoning could account for the gap), and totalTokens is
 * exactly inputTokens + outputTokens + the cache buckets the attempt did
 * report. A reported-but-uncountable bucket is never backfilled. Anything
 * else stays unprovable (undefined), never a guess.
 */
function resolvedBucket(sample: AttemptSample, pick: (sample: AttemptSample) => unknown, others: readonly ((sample: AttemptSample) => unknown)[]): number | undefined {
  const reported = pick(sample)
  if (reported !== undefined) return isCount(reported) ? reported : undefined
  if (sample.reasoningTokens !== undefined) return undefined
  const { inputTokens, outputTokens, totalTokens } = sample
  if (!isCount(inputTokens) || !isCount(outputTokens) || !isCount(totalTokens)) return undefined
  const rest: number[] = []
  for (const other of others) {
    const value = other(sample)
    if (value === undefined) continue
    if (!isCount(value)) return undefined
    rest.push(value)
  }
  const expect = sumCounts([inputTokens, outputTokens, ...rest])
  return expect !== undefined && totalTokens === expect ? 0 : undefined
}

/**
 * One cache bucket summed over attempt samples, with provable-zero backfill:
 * every sample must resolve (reported count or provable 0), else the bucket
 * stays null. Never a guess: a single unresolvable sample nulls the sum.
 */
function resolveSamples(samples: readonly (AttemptSample | undefined)[], pick: (sample: AttemptSample) => unknown, others: readonly ((sample: AttemptSample) => unknown)[]): number | null {
  return sumCounts(samples.map(sample => (sample === undefined ? undefined : resolvedBucket(sample, pick, others)))) ?? null
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
 *
 * Cache backfill (Architect ruling): a cache bucket an attempt did not report
 * resolves to 0 when the attempt's total proves it (see resolvedBucket), so a
 * retried Turn whose silent attempts are provably cache-free records summed
 * buckets instead of nulls. reasoningTokens is never backfilled.
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
  const messageSamples: AttemptSample[] = usages.map(usage => ({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, reasoningTokens: usage.reasoningTokens }))
  const cacheSamples: readonly (AttemptSample | undefined)[] = [...messageSamples, ...reported]
  const cacheRead = (sample: AttemptSample): unknown => sample.cacheReadTokens
  const cacheWrite = (sample: AttemptSample): unknown => sample.cacheWriteTokens
  const reasoned = usages.every(usage => isCount(usage.reasoningTokens) && usage.reasoningTokens <= usage.outputTokens)
    && reported.every(usage => usage !== undefined && isCount(usage.outputTokens) && isCount(usage.reasoningTokens) && usage.reasoningTokens <= usage.outputTokens)
  // Reasoning is never backfilled: it sums only when every sample reported it.
  const reasoning = (sample: { readonly reasoningTokens?: unknown }): unknown => sample.reasoningTokens
  const reasoningTokens = reasoned
    ? sumCounts([...usages.map(reasoning), ...reported.map(usage => (usage === undefined ? undefined : reasoning(usage)))]) ?? null
    : null
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
    cacheReadTokens: resolveSamples(cacheSamples, cacheRead, [cacheWrite]),
    cacheWriteTokens: resolveSamples(cacheSamples, cacheWrite, [cacheRead]),
    reasoningTokens,
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
  // The exact aggregates drop a cache bucket when any attempt was silent on
  // it — even a provably cache-free one. Resolve each null bucket over the
  // Turn's own samples (reported counts plus provable zeros); a genuinely
  // unprovable bucket stays null as today.
  const exactSamples = (): readonly (AttemptSample | undefined)[] => [
    ...events.filter((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message').map(messageSample),
    ...events.filter((event): event is SessionEvent<'assistant/attempt'> => event.type === 'assistant/attempt').map(attemptReportedUsage),
  ]
  const exactCache = (bucket: 'cacheReadTokens' | 'cacheWriteTokens'): number | null => {
    const samples = exactSamples()
    const pick = (sample: AttemptSample): unknown => sample[bucket]
    const others = [bucket === 'cacheReadTokens' ? 'cacheWriteTokens' : 'cacheReadTokens'] as const
    return resolveSamples(samples, pick, others.map(other => (sample: AttemptSample): unknown => sample[other]))
  }
  const usage: TurnUsageFields | undefined = exact === undefined
    ? fieldwiseTurnUsage(events)
    : {
      uncachedInputTokens: exact.uncachedInputTokens,
      outputTokens: exact.outputTokens,
      cacheReadTokens: exact.cacheReadTokens ?? exactCache('cacheReadTokens') ?? null,
      cacheWriteTokens: exact.cacheWriteTokens ?? exactCache('cacheWriteTokens') ?? null,
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
