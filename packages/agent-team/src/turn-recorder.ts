/**
 * Records each completed Turn of a Member's Session into the ledger (contract §3.2).
 *
 * One recorder per host. It buffers a Member's session events from `turn/start` to
 * `turn/end`, then on `turn/end` derives the Turn and records it. Threads come from two
 * host-supplied lists (turn-threads.ts): the Threads of Team facts delivered to the Member
 * while the Turn was open, and the Threads of the Member's own committed operations inside
 * the Turn's sequence window. A Turn whose usage cannot be proven is not recorded.
 *
 * The request id is derived from (sessionId, turn), so a host retry after a crash resolves
 * to the recorded Turn instead of folding it twice. Recording never throws into the session
 * event path; a failure is reported through `onError`.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { AgentTeamLedger } from './ledger.ts'
import { deriveAgentTeamTurn } from './session-turn-usage.ts'
import { threadRefsForTurn } from './turn-threads.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentTeamMemberId, AgentTeamRequestId, AgentTeamThreadRef } from './types.ts'

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

export class AgentTeamTurnRecorder {
  private readonly open = new Map<AgentTeamMemberId, OpenTurn>()
  /** Threads delivered to a Member before its next Turn starts; they belong to that Turn. */
  private readonly pending = new Map<AgentTeamMemberId, Set<AgentTeamThreadRef>>()
  private failedWrites = 0
  private unprovableTurns = 0

  /**
   * Turns this host did not record: `failed` when the ledger write threw (a
   * backend outage, say), `unprovable` when usage could not be proven exact. The
   * SessionRun stats under-count by exactly these, so they are surfaced, never silent.
   */
  get unrecordedTurns(): { readonly failed: number; readonly unprovable: number } {
    return { failed: this.failedWrites, unprovable: this.unprovableTurns }
  }

  constructor(
    private readonly ledger: () => AgentTeamLedger,
    private readonly onError: (message: string, error: unknown) => void,
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
        startSequence: this.ledger().projectionSequence() + 1,
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

  private async record(memberId: AgentTeamMemberId, turn: OpenTurn): Promise<void> {
    const derived = deriveAgentTeamTurn(turn.events)
    // A Turn whose usage cannot be proven exact is not recorded (contract §3.2).
    if (derived === undefined) {
      this.unprovableTurns += 1
      return
    }
    const ledger = this.ledger()
    const member = ledger.getMember(memberId)
    // One Workspace per Member today; a multi-Workspace Member needs the Turn's Workspace named explicitly.
    const workspaceId = ledger.workspacesOf(memberId)[0]
    if (member === undefined || workspaceId === undefined) return
    const endSequence = ledger.projectionSequence()
    const window = { startSequence: turn.startSequence, endSequence }
    const threadRefs = threadRefsForTurn([...turn.delivered], ledger.repliedThreadsBetween(memberId, window.startSequence, window.endSequence), window)
    await ledger.recordSessionTurn({
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
      actor: { kind: 'member', memberId, handle: member.handle },
    })
  }
}
