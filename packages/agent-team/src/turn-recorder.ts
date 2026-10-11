/**
 * Records each completed Turn of a Member's Session into the ledger (contract §3.2).
 *
 * One recorder per host. It buffers a Member's session events from `turn/start` to
 * `turn/end`, then on `turn/end` derives the Turn and records it. Threads come from two
 * host-supplied lists (turn-threads.ts): the Threads of Team facts delivered to the Member
 * while the Turn was open, and the Threads of the Member's own committed operations inside
 * the Turn's sequence window. A completed Turn is always recorded; its usage is exact per field, and
 * null where a field is not provable. A Turn with no provable output count is not recorded.
 *
 * The request id is derived from (sessionId, turn), so a host retry after a crash resolves
 * to the recorded Turn instead of folding it twice. Recording never throws into the session
 * event path; a failure is reported through `onError`.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { AgentTeamLedger } from './ledger.ts'
import { deriveAgentTeamTurn, unprovableUsageReason } from './session-turn-usage.ts'
import { threadRefsForTurn } from './turn-threads.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { AgentTeamMemberId, AgentTeamOperationReceipt, AgentTeamRequestId, AgentTeamThreadRef } from './types.ts'

interface OpenTurn {
  readonly sessionId: SessionId
  /**
   * First ledger sequence this Turn can own: the projection head when it started, plus one.
   * The head moves on every scoped commit, and a replied operation is always scoped, so no
   * replied operation from before the Turn can sit above this head.
   */
  readonly startSequence: number
  readonly events: SessionEvent[]
  readonly delivered: Set<AgentTeamThreadRef>
}

/** The deterministic request id of one Turn: the same Turn always carries the same id. */
export function sessionTurnRequestId(sessionId: SessionId, turn: number): AgentTeamRequestId {
  return `turn:${sessionId}:${turn}` as AgentTeamRequestId
}

/** The deterministic request id of one errored Turn's notice on one Thread (contract §6.0). */
export function turnFailureNoticeRequestId(sessionId: SessionId, turn: number, threadRef: AgentTeamThreadRef): AgentTeamRequestId {
  return `turn-failed:${sessionId}:${turn}:${threadRef}` as AgentTeamRequestId
}

/**
 * The notice's reason: the first line of the error, at most 200 characters, with no mention
 * (`@` removed), no URL and no key-like value. Nothing else of the error leaves the Turn.
 */
export function turnFailureReason(message: string): string {
  const firstLine = (message.split('\n')[0] ?? '').trim()
    .replaceAll('@', '')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b(api[_-]?key|token|secret|authorization|password)\b\s*[:=]\s*\S+/gi, '$1=[redacted]')
    // Provider errors name credentials without a `key=` form: a bearer header, a JWT, an sk- key, or any long opaque run.
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}/g, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
  const bounded = firstLine.length <= 200 ? firstLine : `${firstLine.slice(0, 199)}…`
  return bounded === '' ? 'Turn ended in error' : bounded
}

export class AgentTeamTurnRecorder {
  private readonly open = new Map<AgentTeamMemberId, OpenTurn>()
  /** Threads delivered to a Member before its next Turn starts; they belong to that Turn. */
  private readonly pending = new Map<AgentTeamMemberId, Set<AgentTeamThreadRef>>()
  private failedWrites = 0
  private unprovableTurns = 0

  /**
   * Turns this host did not record: `failed` when the ledger write threw (a
   * backend outage, say), `unprovable` when no output count could be proven or the Turn ended in error (its
   * failure notice is extra visibility, never a replacement for this count). The
   * SessionRun stats under-count by exactly these, so they are surfaced, never silent.
   */
  get unrecordedTurns(): { readonly failed: number; readonly unprovable: number } {
    return { failed: this.failedWrites, unprovable: this.unprovableTurns }
  }

  constructor(
    private readonly ledger: () => AgentTeamLedger,
    private readonly onError: (message: string, error: unknown) => void,
    /** Runs after a Turn is committed; it must not throw, since a throw here would count as a failed write. */
    private readonly onRecorded: (workspaceId: WorkspaceId, threadRefs: readonly AgentTeamThreadRef[]) => void = () => undefined,
    /**
     * Runs after a notice or Turn record is newly committed, so the change waiters of its Thread scopes wake.
     * UI-only: this is not the Remote commit path, so no `agent-team/committed` listener, participation notice or agent wake.
     * A write that was already committed (same requestId) is not reported again. It must not throw.
     */
    private readonly onCommitted: (receipt: AgentTeamOperationReceipt) => void = () => undefined,
    /** Reports a completed Turn that was not recorded, with the reason. Logs only; the count is `unrecordedTurns`. */
    private readonly onUnrecorded: (message: string) => void = () => undefined,
  ) {}

  /** Threads of Team facts just delivered to a Member: into its open Turn, or held for the next one. */
  noteDelivered(memberId: AgentTeamMemberId, threadRefs: readonly AgentTeamThreadRef[]): void {
    if (threadRefs.length === 0) return
    const turn = this.open.get(memberId)
    const target = turn?.delivered ?? this.pendingFor(memberId)
    for (const threadRef of threadRefs) target.add(threadRef)
  }

  /** Feed one session event of a Member's current Session. Only turn boundaries and the events between them matter. */
  onSessionEvent(memberId: AgentTeamMemberId, sessionId: SessionId, event: SessionEvent): void {
    if (event.type === 'turn/start') {
      const held = this.pending.get(memberId)
      this.pending.delete(memberId)
      this.open.set(memberId, {
        sessionId,
        startSequence: this.ledger().attributionSequence() + 1,
        events: [event],
        delivered: new Set(held ?? []),
      })
      return
    }
    const turn = this.open.get(memberId)
    if (turn === undefined || turn.sessionId !== sessionId) return
    turn.events.push(event)
    if (event.type !== 'turn/end') return
    this.open.delete(memberId)
    // An errored Turn is noted on its delivered Threads, not recorded: it has no provable usage (contract §6.0).
    // The event path never throws: a turn/end without a reason is treated as not errored.
    if (event.data.reason?.kind === 'error') {
      // Every turn/end is either recorded or counted: an errored Turn is counted here, and the notice is only extra visibility.
      this.unprovableTurns += 1
      this.noteFailure(memberId, turn, event.data.reason.error.message).catch(error => {
        this.onError(`agent-team: turn failure notice for '${memberId}' failed`, error)
      })
      return
    }
    this.record(memberId, turn).catch(error => {
      this.failedWrites += 1
      this.onError(`agent-team: Turn record for '${memberId}' failed (${this.failedWrites} unrecorded so far)`, error)
    })
  }

  private pendingFor(memberId: AgentTeamMemberId): Set<AgentTeamThreadRef> {
    const existing = this.pending.get(memberId)
    if (existing !== undefined) return existing
    const created = new Set<AgentTeamThreadRef>()
    this.pending.set(memberId, created)
    return created
  }

  /**
   * One audit notice per delivered Thread, each under its own requestId, so a re-delivery of the same
   * Turn resolves to the notice already committed. Nothing is retried: a failed write is reported once.
   */
  private async noteFailure(memberId: AgentTeamMemberId, turn: OpenTurn, message: string): Promise<void> {
    const start = turn.events.find((event): event is SessionEvent<'turn/start'> => event.type === 'turn/start')
    if (start === undefined) return
    const ledger = this.ledger()
    const member = ledger.getMember(memberId)
    const workspaceId = ledger.workspacesOf(memberId)[0]
    if (member === undefined || workspaceId === undefined) return
    const reason = turnFailureReason(message)
    // One Thread's failed write must not stop the others, so each write reports on its own.
    for (const threadRef of turn.delivered) {
      await ledger.recordTurnFailureNotice({
        requestId: turnFailureNoticeRequestId(turn.sessionId, start.data.turn, threadRef),
        workspaceId, threadRef, memberId, sessionId: turn.sessionId, turn: start.data.turn, reason,
        actor: { kind: 'member', memberId, handle: member.handle },
      }).then(result => {
        if (result.committed) this.onCommitted(result.value)
      }).catch(error => {
        this.onError(`agent-team: turn failure notice for '${memberId}' on '${threadRef}' failed`, error)
      })
    }
  }

  private async record(memberId: AgentTeamMemberId, turn: OpenTurn): Promise<void> {
    const derived = deriveAgentTeamTurn(turn.events)
    // A completed Turn is recorded even when some usage fields are unprovable (null); only a missing output count refuses it (contract §3.2).
    if (derived === undefined) {
      this.unprovableTurns += 1
      // Surfaced, never silent: the Turn is missing from the stats row, so the log names it and why.
      const turnNumber = turn.events.find((event): event is SessionEvent<'turn/start'> => event.type === 'turn/start')?.data.turn
      this.onUnrecorded(`agent-team: Turn ${turnNumber ?? '?'} for '${memberId}' not recorded: output not provable (${unprovableUsageReason(turn.events)})`)
      return
    }
    const ledger = this.ledger()
    const member = ledger.getMember(memberId)
    // One Workspace per Member today; a multi-Workspace Member needs the Turn's Workspace named explicitly.
    const workspaceId = ledger.workspacesOf(memberId)[0]
    if (member === undefined || workspaceId === undefined) return
    // The window is the ledger sequence span the Turn covers. endSequence is the projection
    // sequence now; when no ledger op landed during the Turn it is startSequence - 1, the
    // empty-window encoding, which the ledger accepts and nothing else should produce.
    const endSequence = ledger.attributionSequence()
    const window = { startSequence: turn.startSequence, endSequence }
    const threadRefs = threadRefsForTurn([...turn.delivered], ledger.repliedThreadsBetween(memberId, window.startSequence, window.endSequence), window)
    const result = await ledger.recordSessionTurn({
      requestId: sessionTurnRequestId(turn.sessionId, derived.turn),
      workspaceId,
      memberId,
      sessionId: turn.sessionId,
      threadRefs,
      turn: derived.turn,
      startedAt: derived.startedAt,
      endedAt: derived.endedAt,
      toolCalls: derived.toolCalls,
      runMs: derived.runMs,
      usage: derived.usage,
      startSequence: window.startSequence,
      endSequence: window.endSequence,
      actor: { kind: 'member', memberId, handle: member.handle },
    })
    if (result.committed) this.onCommitted(result.value.receipt)
    this.onRecorded(workspaceId, threadRefs)
  }
}
