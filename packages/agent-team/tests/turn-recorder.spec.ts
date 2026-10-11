import { describe, expect, it, vi } from 'vitest'
import type { AgentTeamLedger } from '../src/ledger.ts'
import { AgentTeamTurnRecorder, sessionTurnRequestId } from '../src/turn-recorder.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentTeamMemberId, AgentTeamThreadRef } from '../src/types.ts'

// Usage derivation needs real harness events; the recorder's own behavior does not, so it is stubbed.
const derived = { current: undefined as undefined | Record<string, unknown> }
vi.mock('../src/session-turn-usage.ts', () => ({ deriveAgentTeamTurn: () => derived.current }))

const memberId = 'member:turn-a' as AgentTeamMemberId
const sessionId = 'session:turn-a' as SessionId
const threadA = 'thread:a' as AgentTeamThreadRef
const threadB = 'thread:b' as AgentTeamThreadRef
const threadC = 'thread:c' as AgentTeamThreadRef

function fakeLedger(head: () => number, replied: { sequence: number; threadRef: AgentTeamThreadRef }[] = []) {
  return {
    projectionSequence: vi.fn(head),
    attributionSequence: vi.fn(head),
    getMember: vi.fn(() => ({ memberId, handle: 'turn-a' })),
    workspacesOf: vi.fn(() => ['workspace:w']),
    repliedThreadsBetween: vi.fn(() => replied),
    recordSessionTurn: vi.fn(async (_request: Record<string, unknown>) => ({ committed: true, value: {} })),
  }
}

const event = (type: string, turn = 1) => ({ type, seq: 1, time: 0, data: { turn } }) as never

describe('AgentTeamTurnRecorder', () => {
  it('records one Turn with the delivered Threads plus the replied Threads inside its window, under a deterministic request id', async () => {
    let head = 5
    const ledger = fakeLedger(() => head, [{ sequence: 7, threadRef: threadB }, { sequence: 9, threadRef: threadC }])
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined)
    derived.current = { turn: 1, startedAt: '2026-10-11T01:00:00.000Z', endedAt: '2026-10-11T01:00:05.000Z', toolCalls: 2, runMs: 900, usage: { uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null } }
    recorder.noteDelivered(memberId, [threadA])
    recorder.onSessionEvent(memberId, sessionId, event('turn/start'))
    head = 8
    recorder.onSessionEvent(memberId, sessionId, event('turn/end'))
    await vi.waitFor(() => expect(ledger.recordSessionTurn).toHaveBeenCalledTimes(1))
    const request = ledger.recordSessionTurn.mock.calls[0]![0] as { requestId: string; threadRefs: AgentTeamThreadRef[]; turn: number; workspaceId: string }
    expect(request.requestId).toBe(sessionTurnRequestId(sessionId, 1))
    expect(request.threadRefs).toEqual([threadA, threadB])
    expect(request).toMatchObject({ turn: 1, workspaceId: 'workspace:w', startSequence: 6, endSequence: 8 })
    // The window is [head at start + 1, head at end] = [6, 8]: the reply at 9 is outside it.
    expect(ledger.repliedThreadsBetween).toHaveBeenCalledWith(memberId, 6, 8)
  })

  it('holds a delivery made before the Turn starts for that Turn, and keeps a delivery made mid-Turn in the open Turn only', async () => {
    const ledger = fakeLedger(() => 0)
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined)
    derived.current = { turn: 2, startedAt: 'a', endedAt: 'b', toolCalls: 0, runMs: 0, usage: {} }
    recorder.noteDelivered(memberId, [threadA])
    recorder.onSessionEvent(memberId, sessionId, event('turn/start', 2))
    recorder.noteDelivered(memberId, [threadC])
    recorder.onSessionEvent(memberId, sessionId, event('turn/end', 2))
    await vi.waitFor(() => expect(ledger.recordSessionTurn).toHaveBeenCalledTimes(1))
    expect((ledger.recordSessionTurn.mock.calls[0]![0] as { threadRefs: AgentTeamThreadRef[] }).threadRefs).toEqual([threadA, threadC])
    // A later Turn starts clean: the first Turn's deliveries do not leak forward.
    recorder.onSessionEvent(memberId, sessionId, event('turn/start', 3))
    recorder.onSessionEvent(memberId, sessionId, event('turn/end', 3))
    await vi.waitFor(() => expect(ledger.recordSessionTurn).toHaveBeenCalledTimes(2))
    expect((ledger.recordSessionTurn.mock.calls[1]![0] as { threadRefs: AgentTeamThreadRef[] }).threadRefs).toEqual([])
  })

  it('records nothing when the Turn usage cannot be proven exact', async () => {
    const ledger = fakeLedger(() => 0)
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined)
    derived.current = undefined
    recorder.onSessionEvent(memberId, sessionId, event('turn/start', 4))
    recorder.onSessionEvent(memberId, sessionId, event('turn/end', 4))
    await Promise.resolve()
    expect(ledger.recordSessionTurn).not.toHaveBeenCalled()
  })

  it('ignores events from a Session other than the open Turn\'s', async () => {
    const ledger = fakeLedger(() => 0)
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined)
    derived.current = { turn: 5, startedAt: 'a', endedAt: 'b', toolCalls: 0, runMs: 0, usage: {} }
    recorder.onSessionEvent(memberId, sessionId, event('turn/start', 5))
    recorder.onSessionEvent(memberId, 'session:other' as SessionId, event('turn/end', 5))
    await Promise.resolve()
    expect(ledger.recordSessionTurn).not.toHaveBeenCalled()
  })

  it('counts the Turns it did not record, split by reason, and reports the first write failure', async () => {
    const ledger = fakeLedger(() => 0)
    ledger.recordSessionTurn.mockRejectedValueOnce(new Error('backend down'))
    const onError = vi.fn()
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, onError)
    derived.current = { turn: 6, startedAt: 'a', endedAt: 'b', toolCalls: 0, runMs: 0, usage: {} }
    recorder.onSessionEvent(memberId, sessionId, event('turn/start', 6))
    recorder.onSessionEvent(memberId, sessionId, event('turn/end', 6))
    derived.current = undefined
    recorder.onSessionEvent(memberId, sessionId, event('turn/start', 7))
    recorder.onSessionEvent(memberId, sessionId, event('turn/end', 7))
    await vi.waitFor(() => expect(recorder.unrecordedTurns).toEqual({ failed: 1, unprovable: 1 }))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]![0]).toContain('1 unrecorded so far')
  })

  it('derives the same request id for the same Turn, so a host retry cannot fold it twice', () => {
    expect(sessionTurnRequestId(sessionId, 7)).toBe(sessionTurnRequestId(sessionId, 7))
    expect(sessionTurnRequestId(sessionId, 7)).not.toBe(sessionTurnRequestId(sessionId, 8))
  })
})
