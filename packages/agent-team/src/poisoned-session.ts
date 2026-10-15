/**
 * Provider-poison detection and the malformed-generation refusal (task-11).
 *
 * A "poisoned" seat is one whose provider rejects its Turns with an identical
 * 4xx INVALID_REQUEST signature before any usage is reported, Turn after Turn
 * (incident seq-475: a replay-state payload the provider refuses to parse).
 * Because the signature is identical, the next queued Turn replays the same
 * rejection — re-queueing cannot recover the seat, so the host surfaces a
 * sticky diagnosis (presence `error`, class `runtime`) and refuses to steer it
 * silently, instead of clearing the runtime error on every status poll.
 *
 * The TurnRecorder owns the tracker: it is the one component that sees every
 * Turn's full event window and its `turn/end` failure reason. State is
 * per-Member and per-Session — any non-matching failure, a different Session,
 * or a clean recorded Turn resets the streak, so a diagnosis never outlives
 * the condition that produced it.
 *
 * This module also carries the malformed-generation guard: an assistant
 * generation whose visible text carries a tool-call markup block
 * (`<…:function_calls>`) while the message has no `tool-call` content part
 * would record as a completed Turn while its tool calls never existed — such a
 * Turn is refused before derive, never persisted as `completed`.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentTeamMemberId } from './types.ts'

/** Consecutive identical provider failures before a seat is declared poisoned. */
export const PROVIDER_POISON_TURNS = 3

/** The subset of a `turn/end` error's `LlmFailure` that classifies a rejection. */
export interface ProviderFailureSignal {
  readonly status?: number | undefined
  readonly code: string
}

/**
 * The poison signature of one failed Turn: `"<status>:<code>"` exactly when the
 * provider rejected the request with a 4xx INVALID_REQUEST before spending any
 * reported usage, else undefined. Anything else (5xx, network errors, a Turn
 * that generated tokens) is a different failure and resets the streak.
 */
export function providerPoisonSignature(failure: ProviderFailureSignal, zeroUsage: boolean): string | undefined {
  if (!zeroUsage) return undefined
  if (failure.status === undefined || failure.status < 400 || failure.status > 499) return undefined
  if (failure.code !== 'INVALID_REQUEST') return undefined
  return `${failure.status}:${failure.code}`
}

/**
 * True iff every usage sample the Turn reports is provably zero — no tokens
 * were spent. Conservative in both directions: a committed message without
 * reported usage (unknown spend) is NOT zero, and any nonzero bucket anywhere
 * (message or failed attempt stream) is not zero. A Turn that committed no
 * message and reported no usage chunk is exactly the rejected-before-generation
 * shape.
 */
export function zeroReportedUsage(events: readonly SessionEvent[]): boolean {
  const count = (value: unknown): boolean => typeof value === 'number' && value > 0
  for (const event of events) {
    if (event.type === 'assistant/message') {
      const usage = event.data.usage
      if (usage === undefined) return false
      if (count(usage.inputTokens) || count(usage.outputTokens) || count(usage.totalTokens)) return false
    } else if (event.type === 'assistant/attempt') {
      for (const record of event.data.stream) {
        if (record.type !== 'chunk' || record.chunk.type !== 'usage') continue
        const usage = record.chunk.usage
        if (count(usage.inputTokens) || count(usage.outputTokens) || count(usage.totalTokens)) return false
      }
    }
  }
  return true
}

/** The tool-call markup a poisoned generation emits as plain text, e.g. the incident's `<atem:function_calls>…`. */
const TOOL_CALL_MARKUP = /<\/?[A-Za-z0-9_-]+:function_calls>/g

/**
 * Character ranges the malformed check must not read as a generation: fenced
 * code blocks, inline code spans, and blockquote lines. An agent discussing
 * this incident quotes the markup there on purpose; only prose that emits it
 * means a call was made and never executed. The fence-first alternation
 * mirrors mentions.ts `codeRanges` (a block is never a run of inline spans).
 */
function quotedMarkupRanges(text: string): readonly (readonly [number, number])[] {
  const ranges: [number, number][] = []
  for (const match of text.matchAll(/```[\s\S]*?```|`[^`\n]*`|^[>][^\n]*/gm)) {
    const start = match.index ?? 0
    ranges.push([start, start + match[0].length])
  }
  return ranges
}

/**
 * The first committed assistant message whose visible text carries a tool-call
 * markup block while the message has no `tool-call` content part — the model
 * emitted the markup it was asked to emit but never produced (or the session
 * dropped) the structured call, so nothing downstream could ever execute. A
 * Turn containing such a message must not be recorded as completed. Returns a
 * renderable description, or undefined when every generation is well-formed.
 */
export function malformedToolCallGeneration(events: readonly SessionEvent[]): string | undefined {
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const content = event.data.message.content
    if (content.some(block => block.type === 'tool-call')) continue
    for (const block of content) {
      if (block.type !== 'text') continue
      const quoted = quotedMarkupRanges(block.text)
      for (const match of block.text.matchAll(TOOL_CALL_MARKUP)) {
        const at = match.index ?? 0
        if (quoted.some(([start, end]) => at >= start && at < end)) continue
        return `tool-call markup '${match[0]}' in its text with no tool-call part`
      }
    }
  }
  return undefined
}

/** The sticky diagnosis a poisoned seat carries: same signature, consecutive failed Turns, one Session. */
export interface AgentTeamPoisonVerdict {
  readonly sessionId: SessionId
  /** `"<status>:<code>"` of the identical provider rejection (see providerPoisonSignature). */
  readonly signature: string
  /** Consecutive identical failed Turns including this one. */
  readonly failedTurns: number
  /** The Turn that produced this verdict (the crossing Turn while below notification state). */
  readonly turn: number
}

interface PoisonStreak {
  sessionId: SessionId
  signature: string
  failedTurns: number
  turn: number
}

/** Per-Member consecutive identical provider-rejection state; owned by the TurnRecorder. */
export class PoisonedSessionTracker {
  private readonly state = new Map<AgentTeamMemberId, PoisonStreak>()

  /**
   * One errored Turn. A poison-signature failure extends the streak (a new
   * signature, a new Session, or no streak starts one at 1); any other
   * signature resets it. `crossed` is true exactly when this failure takes the
   * streak to `PROVIDER_POISON_TURNS` — the one moment the seat becomes newly
   * diagnosable, i.e. the notice worth sending once. `changed` reports any
   * state update (including a reset that erased state) so the host can refresh
   * or drop its stored diagnosis.
   */
  noteError(
    memberId: AgentTeamMemberId,
    sessionId: SessionId,
    turn: number,
    signature: string | undefined,
  ): { readonly verdict: AgentTeamPoisonVerdict | undefined; readonly crossed: boolean; readonly changed: boolean } {
    if (signature === undefined) {
      return { verdict: undefined, crossed: false, changed: this.state.delete(memberId) }
    }
    const current = this.state.get(memberId)
    const fresh = current === undefined || current.sessionId !== sessionId || current.signature !== signature
    const failedTurns = fresh ? 1 : current.failedTurns + 1
    const streak: PoisonStreak = { sessionId, signature, failedTurns, turn }
    this.state.set(memberId, streak)
    return {
      verdict: Object.freeze({ ...streak }),
      crossed: failedTurns === PROVIDER_POISON_TURNS,
      changed: !fresh,
    }
  }

  /** The poisoned verdict only at or past the threshold and on the Session asked about (or the current one). */
  poisoned(memberId: AgentTeamMemberId, sessionId?: SessionId): AgentTeamPoisonVerdict | undefined {
    const streak = this.state.get(memberId)
    if (streak === undefined || streak.failedTurns < PROVIDER_POISON_TURNS) return undefined
    if (sessionId !== undefined && streak.sessionId !== sessionId) return undefined
    return Object.freeze({ ...streak })
  }

  /** A clean recorded Turn erases the streak; returns whether state existed (to drop the stored diagnosis). */
  clear(memberId: AgentTeamMemberId): boolean {
    return this.state.delete(memberId)
  }
}
