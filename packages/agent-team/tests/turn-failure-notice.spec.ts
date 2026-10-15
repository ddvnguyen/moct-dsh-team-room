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
    attributionSequence: vi.fn(() => 4),
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
    // Two Threads, one errored Turn: the counter moves once, not once per Thread.
    expect(recorder.unrecordedTurns).toEqual({ failed: 0, unprovable: 1 })
  })

  it('an errored Turn delivered to no Thread writes no notice and still moves the counter', async () => {
    const ledger = fakeLedger()
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined)
    recorder.onSessionEvent(memberId, sessionId, event('turn/start', 9))
    recorder.onSessionEvent(memberId, sessionId, errorEnd(9, 'boom'))
    await vi.waitFor(() => expect(recorder.unrecordedTurns.unprovable).toBe(1))
    expect(ledger.recordTurnFailureNotice).not.toHaveBeenCalled()
  })

  it('a failed notice write still leaves the errored Turn counted', async () => {
    const ledger = fakeLedger()
    ledger.recordTurnFailureNotice.mockRejectedValue(new Error('backend down'))
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined)
    recorder.noteDelivered(memberId, [threadA])
    recorder.onSessionEvent(memberId, sessionId, event('turn/start', 10))
    recorder.onSessionEvent(memberId, sessionId, errorEnd(10, 'boom'))
    await vi.waitFor(() => expect(ledger.recordTurnFailureNotice).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(recorder.unrecordedTurns.unprovable).toBe(1))
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
    // Ordinary words, not one long run: a long opaque run is a credential and is redacted instead.
    expect(turnFailureReason('lorem ipsum '.repeat(60))).toHaveLength(200)
    expect(turnFailureReason('   ')).toBe('Turn ended in error')
  })

  it('redacts each credential shape a provider error can carry, and the ledger text never holds a key', () => {
    // The exact provider message from the Architect's review.
    const provider = turnFailureReason('Incorrect API key provided: sk-live-ABCDEF1234567890')
    expect(provider).toBe('Incorrect API key provided: [redacted]')
    expect(provider).not.toContain('sk-')
    expect(turnFailureReason('Authorization failed for Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).not.toMatch(/Bearer eyJ|eyJ/)
    expect(turnFailureReason('Authorization failed for Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).toBe('Authorization failed for Bearer [redacted]')
    expect(turnFailureReason('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig failed')).toBe('jwt [redacted].[redacted].sig failed')
    expect(turnFailureReason('bad key sk-abc123XYZ')).toBe('bad key [redacted]')
    expect(turnFailureReason('opaque ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd here')).toBe('opaque [redacted] here')
    // A word that merely contains "sk-" is not a key.
    expect(turnFailureReason('task-runner timed out')).toBe('task-runner timed out')
  })

  it('derives a deterministic requestId per Session, Turn and Thread', () => {
    expect(turnFailureNoticeRequestId(sessionId, 3, threadA)).toBe(`turn-failed:${sessionId}:3:${threadA}`)
  })
})

describe('AgentTeamLedger.threadTurnFailures (§6.0 read view)', () => {
  it('falls back to the memberId as the handle when the Member has no projection entry', async () => {
    const { AgentTeamLedger: Ledger } = await import('../src/ledger.ts')
    const operation = (sequence: number, turn: number) => ({
      kind: 'team/turn-failure-notice', sequence, occurredAt: `2026-10-11T00:00:0${sequence}.000Z`,
      data: { threadRef: threadA, memberId, sessionId, turn, reason: `reason ${turn}` },
    })
    const view = { turnFailureNotices: () => [operation(3, 1), operation(5, 2)], state: { members: new Map() } }
    const failures = Ledger.prototype.threadTurnFailures.call(view as never, threadA)
    expect(failures.map(failure => [failure.sequence, failure.turn, failure.handle])).toEqual([[3, 1, memberId], [5, 2, memberId]])
    const known = { turnFailureNotices: () => [operation(3, 1)], state: { members: new Map([[memberId, { handle: 'notice-a' }]]) } }
    expect(Ledger.prototype.threadTurnFailures.call(known as never, threadA)[0]!.handle).toBe('notice-a')
  })
})

describe('AgentTeamLedger.changeScopesOf for Turn records (UI invalidation only)', () => {
  it('invalidates the thread of a failure notice and each Thread a Turn was attributed to, and nothing else', async () => {
    const { AgentTeamLedger: Ledger } = await import('../src/ledger.ts')
    const notice = { kind: 'team/turn-failure-notice', sequence: 9, data: { threadRef: threadA, memberId, sessionId, turn: 1, reason: 'x' } }
    expect(Ledger.prototype.changeScopesOf.call({} as never, notice as never)).toEqual([{ kind: 'thread', threadRef: threadA }])
    const turn = { kind: 'team/session-turn-recorded', sequence: 10, data: { threadRefs: [threadA, threadB] } }
    expect(Ledger.prototype.changeScopesOf.call({} as never, turn as never)).toEqual([{ kind: 'thread', threadRef: threadA }, { kind: 'thread', threadRef: threadB }])
    const quiet = { kind: 'team/session-turn-recorded', sequence: 11, data: { threadRefs: [] } }
    expect(Ledger.prototype.changeScopesOf.call({} as never, quiet as never)).toEqual([])
  })
})
