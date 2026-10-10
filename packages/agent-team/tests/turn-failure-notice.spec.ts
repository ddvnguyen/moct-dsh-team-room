import { describe, expect, it, vi } from 'vitest'
import type { AgentTeamLedger } from '../src/ledger.ts'
import { AgentTeamTurnRecorder, turnFailureNoticeRequestId, turnFailureReason } from '../src/turn-recorder.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentTeamMemberId, AgentTeamThreadRef } from '../src/types.ts'

// The errored-Turn path never derives usage, so the derivation is stubbed out: an aborted Turn must stay unprovable, not noticed.
vi.mock('../src/session-turn-usage.ts', () => ({ deriveAgentTeamTurn: () => undefined }))

const memberId = 'member:notice-a' as AgentTeamMemberId
const sessionId = 'session:notice-a' as SessionId
const threadA = 'thread:notice-a' as AgentTeamThreadRef
const threadB = 'thread:notice-b' as AgentTeamThreadRef

function fakeLedger() {
  return {
    projectionSequence: vi.fn(() => 4),
    getMember: vi.fn(() => ({ memberId, handle: 'notice-a' })),
    workspacesOf: vi.fn(() => ['workspace:w']),
    repliedThreadsBetween: vi.fn(() => []),
    recordSessionTurn: vi.fn(async (_request: Record<string, unknown>) => ({ committed: true, value: {} })),
    recordTurnFailureNotice: vi.fn(async (_request: Record<string, unknown>) => ({ committed: true, value: {} })),
  }
}

const event = (type: string, turn: number) => ({ type, seq: 1, time: 0, data: { turn } }) as never
const errorEnd = (turn: number, message: string) => ({ type: 'turn/end', seq: 2, time: 0, data: { turn, reason: { kind: 'error', error: { message } } } }) as never
const abortEnd = (turn: number) => ({ type: 'turn/end', seq: 2, time: 0, data: { turn, reason: { kind: 'aborted', reason: 'human' } } }) as never

describe('AgentTeamTurnRecorder: errored Turns (contract §6.0)', () => {
  it('notes an errored Turn once per delivered Thread, with no Turn record and no unprovable count', async () => {
    const ledger = fakeLedger()
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined)
    recorder.noteDelivered(memberId, [threadA, threadB])
    recorder.onSessionEvent(memberId, sessionId, event('turn/start', 4))
    recorder.onSessionEvent(memberId, sessionId, errorEnd(4, 'provider returned 503'))
    await vi.waitFor(() => expect(ledger.recordTurnFailureNotice).toHaveBeenCalledTimes(2))
    const requests = ledger.recordTurnFailureNotice.mock.calls.map(([request]) => request as Record<string, unknown>)
    expect(requests.map(request => request.threadRef)).toEqual([threadA, threadB])
    expect(requests[0]).toMatchObject({
      requestId: turnFailureNoticeRequestId(sessionId, 4, threadA), workspaceId: 'workspace:w', memberId, sessionId, turn: 4,
      reason: 'provider returned 503', actor: { kind: 'member', memberId, handle: 'notice-a' },
    })
    expect(ledger.recordSessionTurn).not.toHaveBeenCalled()
    expect(recorder.unrecordedTurns).toEqual({ failed: 0, unprovable: 0 })
  })

  it('writes no notice for an aborted Turn, and counts it unprovable as before', async () => {
    const ledger = fakeLedger()
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined)
    recorder.noteDelivered(memberId, [threadA])
    recorder.onSessionEvent(memberId, sessionId, event('turn/start', 5))
    recorder.onSessionEvent(memberId, sessionId, abortEnd(5))
    await vi.waitFor(() => expect(recorder.unrecordedTurns.unprovable).toBe(1))
    expect(ledger.recordTurnFailureNotice).not.toHaveBeenCalled()
  })

  it('re-delivery of the same errored Turn carries the same requestId, so the ledger writes one notice', async () => {
    const ledger = fakeLedger()
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      recorder.noteDelivered(memberId, [threadA])
      recorder.onSessionEvent(memberId, sessionId, event('turn/start', 6))
      recorder.onSessionEvent(memberId, sessionId, errorEnd(6, 'boom'))
    }
    await vi.waitFor(() => expect(ledger.recordTurnFailureNotice).toHaveBeenCalledTimes(2))
    const ids = ledger.recordTurnFailureNotice.mock.calls.map(([request]) => (request as { requestId: string }).requestId)
    expect(ids[0]).toBe(ids[1])
  })

  it('reports a failed notice write once, does not retry it, and still writes the other Threads', async () => {
    const ledger = fakeLedger()
    ledger.recordTurnFailureNotice.mockRejectedValueOnce(new Error('backend down'))
    const onError = vi.fn()
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, onError)
    recorder.noteDelivered(memberId, [threadA, threadB])
    recorder.onSessionEvent(memberId, sessionId, event('turn/start', 7))
    recorder.onSessionEvent(memberId, sessionId, errorEnd(7, 'boom'))
    await vi.waitFor(() => expect(ledger.recordTurnFailureNotice).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(ledger.recordTurnFailureNotice.mock.calls.map(([request]) => (request as { threadRef: string }).threadRef)).toEqual([threadA, threadB])
  })

  it('a turn/end without a reason is not an error and does not throw into the event path', () => {
    const ledger = fakeLedger()
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined)
    recorder.noteDelivered(memberId, [threadA])
    recorder.onSessionEvent(memberId, sessionId, event('turn/start', 8))
    expect(() => recorder.onSessionEvent(memberId, sessionId, event('turn/end', 8))).not.toThrow()
  })
})

describe('turnFailureReason and turnFailureNoticeRequestId', () => {
  it('keeps the first line, drops mentions, URLs and key-like values, and bounds the length', () => {
    expect(turnFailureReason('boom @alice see https://example.test/x token=abc123\nstack at line 4')).toBe('boom alice see [url] token=[redacted]')
    expect(turnFailureReason('x'.repeat(500))).toHaveLength(200)
    expect(turnFailureReason('   ')).toBe('Turn ended in error')
  })

  it('derives a deterministic requestId per Session, Turn and Thread', () => {
    expect(turnFailureNoticeRequestId(sessionId, 3, threadA)).toBe(`turn-failed:${sessionId}:3:${threadA}`)
  })
})
