import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/**
 * One complete, provable Turn's session events: turn/start, one step with one
 * assistant message carrying exact provider usage, step/end, turn/end. Shared by
 * the deriveAgentTeamTurn spec and the host's positive Turn-recording spec, so
 * both exercise the same fixture through deriveTurnTokenUsage.
 */
export interface TurnEventsOptions {
  readonly turn?: number
  readonly firstSeq?: number
  readonly startTime?: number
  readonly provider?: string
  readonly model?: string
  /** Extra fields merged into turn/start's data, e.g. a payload that names another Member. */
  readonly startData?: Record<string, unknown>
}

export function completeTurnEvents(options: TurnEventsOptions = {}): SessionEvent[] {
  const turn = options.turn ?? 1
  const seq = options.firstSeq ?? 1
  const time = options.startTime ?? Date.UTC(2026, 9, 11, 1, 0, 0)
  const provider = options.provider ?? 'deepseek'
  const model = options.model ?? 'deepseek-chat'
  const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 170, cacheReadTokens: 50, cacheWriteTokens: 0 }
  const event = (offset: number, type: string, data: unknown) => ({ seq: seq + offset, time: time + offset * 1000, type, data }) as unknown as SessionEvent
  return [
    event(0, 'turn/start', { turn, ...options.startData }),
    event(1, 'step/start', { turn, step: 1 }),
    event(2, 'assistant/message', {
      turn,
      step: 1,
      stream: [
        { type: 'chunk', time: time + 2000, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
        { type: 'chunk', time: time + 2000, chunk: { type: 'usage', usage } },
      ],
      message: { id: `message-${turn}`, role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider, model } },
      usage,
    }),
    event(3, 'step/end', { turn, step: 1 }),
    event(4, 'turn/end', { turn, reason: { kind: 'completed' } }),
  ]
}
