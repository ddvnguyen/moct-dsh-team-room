/**
 * Wall time of one Turn, folded locally from its session events (contract §3.2).
 *
 * Mirrors the sessionStats projection's llmMs and toolMs rules, without importing
 * it, so the plugin never depends on a package's src/ tree:
 * - llm: an open `step/start` closes at the matching `assistant/message` (same turn and step).
 * - tool: `tool/call` pairs with `tool/result` by callId; an unmatched call counts 0.
 * Times are the events' epoch milliseconds, clamped at 0.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

export interface AgentTeamTurnWallTime {
  readonly llmMs: number
  readonly toolMs: number
}

export function foldTurnWallTime(events: readonly SessionEvent[]): AgentTeamTurnWallTime {
  let llmMs = 0
  let toolMs = 0
  let openStep: { readonly turn: number; readonly step: number; readonly startTime: number } | undefined
  let pendingCalls = new Map<string, number>()
  for (const event of events) {
    switch (event.type) {
      case 'step/start':
        openStep = { turn: event.data.turn, step: event.data.step, startTime: event.time }
        break
      case 'assistant/message':
        if (openStep !== undefined && openStep.turn === event.data.turn && openStep.step === event.data.step) {
          llmMs += Math.max(0, event.time - openStep.startTime)
          openStep = undefined
        }
        break
      case 'step/end':
        openStep = undefined
        break
      case 'tool/call':
        pendingCalls.set(event.data.callId, event.time)
        break
      case 'tool/result': {
        const callId = event.data.message.source.callId
        const dispatched = pendingCalls.get(callId)
        if (dispatched === undefined) break
        toolMs += Math.max(0, event.time - dispatched)
        pendingCalls.delete(callId)
        break
      }
      case 'turn/end':
        pendingCalls = new Map()
        break
      default:
        break
    }
  }
  return Object.freeze({ llmMs, toolMs })
}
