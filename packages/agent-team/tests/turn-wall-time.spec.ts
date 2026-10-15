/**
 * foldTurnWallTime against a fixed event sequence with a known answer. The
 * sequence covers a matched model step, a matched tool pair, an unmatched
 * tool/call that must count 0 ms, and a result with no call.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { foldTurnWallTime } from '../src/turn-wall-time.ts'

const ev = (type: string, time: number, data: Record<string, unknown> = {}) => ({ type, seq: 0, time, data }) as unknown as SessionEvent

describe('foldTurnWallTime', () => {
  it('pairs model steps and tool calls, and counts an unmatched call as 0 ms', () => {
    const events = [
      ev('turn/start', 1000, { turn: 1 }),
      ev('step/start', 1000, { turn: 1, step: 1 }),
      ev('assistant/message', 1600, { turn: 1, step: 1 }),
      ev('tool/call', 1700, { callId: 'a' }),
      ev('tool/result', 2100, { message: { source: { callId: 'a' } } }),
      ev('tool/call', 2200, { callId: 'b' }),
      ev('tool/result', 2300, { message: { source: { callId: 'zz' } } }),
      ev('step/end', 2400, { turn: 1, step: 1 }),
      ev('turn/end', 2500, { turn: 1, reason: 'completed' }),
    ]
    // llm: 1000 -> 1600 = 600. tool: a 1700 -> 2100 = 400; b never resolves (0); zz has no call (0).
    expect(foldTurnWallTime(events)).toEqual({ llmMs: 600, toolMs: 400 })
  })

  it('does not close a model step that belongs to another turn or step', () => {
    const events = [
      ev('step/start', 1000, { turn: 1, step: 1 }),
      ev('assistant/message', 1500, { turn: 1, step: 2 }),
      ev('assistant/message', 1800, { turn: 2, step: 1 }),
    ]
    expect(foldTurnWallTime(events)).toEqual({ llmMs: 0, toolMs: 0 })
  })

  it('drops pending calls at turn end, so a later result cannot pair with them', () => {
    const events = [
      ev('tool/call', 1000, { callId: 'x' }),
      ev('turn/end', 1100, { turn: 1, reason: 'completed' }),
      ev('tool/result', 1500, { message: { source: { callId: 'x' } } }),
    ]
    expect(foldTurnWallTime(events)).toEqual({ llmMs: 0, toolMs: 0 })
  })
})
