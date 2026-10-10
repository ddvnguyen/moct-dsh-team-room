/**
 * Thread summary policy and transcript budget (contract §3.3). Pure: no ledger, no model.
 *
 * A summary reads only committed Thread Messages, each cited by its ledger handle. Input is
 * capped and never truncated: a transcript over the cap is skipped and logged by the caller.
 */

/** Hard cap on the estimated input of one summary call. */
export const SUMMARY_INPUT_TOKEN_CAP = 32_000
/** Hard cap on the output of one summary call; passed to the model as its max tokens. */
export const SUMMARY_OUTPUT_TOKEN_CAP = 2_000

export interface ThreadSummaryPolicy {
  readonly enabled: boolean
  readonly model: { readonly provider: string; readonly model: string }
  /** Recorded Turns naming the Thread since its last summary that trigger a rolling summary. */
  readonly everyTurns: number
  /** Estimated Message tokens since the last summary that trigger a rolling summary. */
  readonly everyTokens: number
}

export const DEFAULT_THREAD_SUMMARY_POLICY: ThreadSummaryPolicy = Object.freeze({
  enabled: true,
  model: Object.freeze({ provider: 'opencode-go', model: 'mimo-v2.6-flash' }),
  everyTurns: 20,
  everyTokens: 100_000,
})

/**
 * Conservative token estimate: one token per three UTF-8 bytes. Real tokenizers average
 * closer to four bytes, so the estimate overcounts and the input cap is never exceeded by undercounting.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 3)
}

/** Whether a rolling summary is due for a Thread, given what has happened since its last summary. */
export function summaryDue(since: { readonly turns: number; readonly tokens: number }, policy: ThreadSummaryPolicy): boolean {
  return policy.enabled && (since.turns >= policy.everyTurns || since.tokens >= policy.everyTokens)
}

export interface SummaryMessageLine {
  /** The committed Message's ledger handle; the summary cites it. */
  readonly messageRef: string
  /** The sender's Member handle, or the sender id when no Member matches. */
  readonly sender: string
  readonly body: string
}

export const THREAD_SUMMARY_SYSTEM_PROMPT = [
  'You maintain a running summary of one Team Thread.',
  'Summarize only the Messages supplied. Cite each claim with the Message handle in brackets, for example [message:abc].',
  'Keep decisions, open questions, and who owns what. Do not invent facts or add advice.',
  'If a prior summary is supplied, fold its content into the new one; do not repeat it verbatim.',
].join(' ')

export type SummaryInput =
  | { readonly ok: true; readonly system: string; readonly transcript: string; readonly tokens: number }
  | { readonly ok: false; readonly tokens: number }

/**
 * Frame the prior summary and the new Messages as one transcript. Over the input cap the
 * result is `ok: false` and nothing is truncated.
 */
export function buildSummaryInput(priorSummary: string | undefined, lines: readonly SummaryMessageLine[]): SummaryInput {
  const parts: string[] = []
  if (priorSummary !== undefined) parts.push(`Prior summary:\n${priorSummary}`)
  parts.push('Messages:')
  for (const line of lines) parts.push(`[${line.messageRef}] ${line.sender}: ${line.body}`)
  const transcript = parts.join('\n')
  const tokens = estimateTokens(THREAD_SUMMARY_SYSTEM_PROMPT) + estimateTokens(transcript)
  if (tokens > SUMMARY_INPUT_TOKEN_CAP) return { ok: false, tokens }
  return { ok: true, system: THREAD_SUMMARY_SYSTEM_PROMPT, transcript, tokens }
}
