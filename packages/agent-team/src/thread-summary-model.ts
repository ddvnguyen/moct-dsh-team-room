/**
 * The one-shot model call behind a Thread summary (contract §3.3). A direct `llm.stream` call:
 * no Member Agent and no seat is involved, so the call cannot touch a Member's Session.
 */
import { BlockAssembler, createUserMessage, type ContextFormed, type GenerateOptions, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SummaryInput } from './thread-summary.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'wowyuarm-agent-team-thread-summary': { kind: 'wowyuarm-agent-team-thread-summary' } & ContextFormed
  }
}

export interface ThreadSummaryModelCall {
  readonly model: { readonly provider: string; readonly model: string }
  readonly input: Extract<SummaryInput, { ok: true }>
  readonly maxTokens: number
}

export interface ThreadSummaryModelResult {
  readonly text: string
  readonly model: { readonly provider: string; readonly model: string }
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
}

/** Run one summary call and return its text and usage. A missing usage chunk is recorded as zero, not guessed. */
export async function callThreadSummaryModel(llm: Pick<LlmRuntime, 'stream'>, call: ThreadSummaryModelCall): Promise<ThreadSummaryModelResult> {
  const options: GenerateOptions = {
    provider: call.model.provider,
    model: call.model.model,
    system: call.input.system,
    messages: [createUserMessage({ content: [{ type: 'text', text: call.input.transcript }], source: { kind: 'wowyuarm-agent-team-thread-summary' } })],
    maxTokens: call.maxTokens,
  }
  const assembler = new BlockAssembler()
  for await (const chunk of llm.stream(options)) assembler.push(chunk)
  const text = assembler.blocks()
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join(' ')
    .trim()
  const usage = assembler.usage
  return { text, model: call.model, usage: { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 } }
}
