import { estimateTokens } from './thread-summary.ts'

export interface ThreadContextSeedSummary {
  generation: number
  text: string
}

export interface ThreadContextSeedMessage {
  messageRef: string
  sender: string
  body: string
}

/** Contract §3.3: the whole seed is bounded to 32k estimated tokens. */
export const THREAD_CONTEXT_SEED_TOKEN_BUDGET = 32_000
/** One Message body inside the seed is bounded before the whole-seed budget is spent. */
const BODY_TOKEN_CAP = 8_000

function trimToTokenCap(text: string, cap: number): { readonly text: string; readonly truncated: boolean } {
  if (estimateTokens(text) <= cap) return { text, truncated: false }
  // estimateTokens counts one token per three UTF-8 bytes, so cap * 3 characters
  // at most satisfies the cap; shrink round-wise until it does.
  let slice = text.slice(0, cap * 3)
  while (estimateTokens(slice) > cap) slice = slice.slice(0, Math.max(1, Math.floor(slice.length * cap / estimateTokens(slice))))
  return { text: slice, truncated: true }
}

/**
 * A7b context seed: the next prompt after a fresh start or cold restart is
 * steered with the latest Thread summary and the last 10 Messages. This is the
 * pure formatting half, so the seeding shape has a regression spec that does
 * not depend on an AgentTeam instance. Every truncation is explicit: a capped
 * body or summary carries a [truncated] marker, and Messages dropped to fit
 * the whole-seed token budget are named in a visible line.
 */
export function buildThreadContextSeed(input: {
  summary?: ThreadContextSeedSummary
  messages: ThreadContextSeedMessage[]
}, limits?: { readonly tokens?: number }): string {
  const budget = limits?.tokens ?? THREAD_CONTEXT_SEED_TOKEN_BUDGET
  let summaryLine: string
  if (input.summary === undefined) {
    summaryLine = 'Latest summary (generation 0): (none)'
  } else {
    const summary = trimToTokenCap(input.summary.text, BODY_TOKEN_CAP)
    summaryLine = 'Latest summary (generation ' + String(input.summary.generation) + '):\n' + summary.text + (summary.truncated ? '\n[truncated]' : '')
  }
  // Bodies are capped per Message first, so one huge Message cannot eat the
  // whole budget; every such cut is marked rather than silent.
  const rendered = input.messages.map(message => {
    const body = trimToTokenCap(message.body, BODY_TOKEN_CAP)
    return '[' + message.messageRef + '] ' + message.sender + ': ' + body.text + (body.truncated ? ' [truncated]' : '')
  })
  // Then drop oldest Messages until the whole seed fits the budget.
  while (rendered.length > 0 && estimateTokens([summaryLine, ...rendered].join('\n')) > budget) rendered.shift()
  // A still-oversized seed is summary alone over the budget: truncate it, marked.
  let seedSummary = summaryLine
  if (estimateTokens([summaryLine, ...rendered].join('\n')) > budget) {
    const fixed = estimateTokens(['', 'Recent messages (last 10):', 'Answer using the summary and recent messages above.'].join('\n')) + 1
    seedSummary = trimToTokenCap(summaryLine, budget - fixed).text + '\n[truncated]'
  }
  const lines = ['Thread context seed (A7b):', seedSummary, 'Recent messages (last 10):', ...rendered]
  if (rendered.length < input.messages.length) lines.push('[' + String(input.messages.length - rendered.length) + ' of the most recent Messages truncated to fit the ' + String(budget) + '-token seed budget]')
  lines.push('Answer using the summary and recent messages above.')
  return lines.join('\n')
}
