/**
 * Which Threads a Turn belongs to (contract §3.2, Architect decision 2).
 *
 * Event derivation cannot tell a Turn's Thread, so the host supplies two lists:
 * - `delivered`: Threads of agent-team messages delivered to this Member while the Turn was open or at its start.
 * - `replied`: Threads of this Member's own committed operations, each with its sequence.
 * A Turn's threadRefs is the union: delivered first, then replied in sequence order, deduplicated.
 * `replied` is kept only inside the Turn's sequence window, [start, end] inclusive.
 * A Turn with neither records `threadRefs: []`, which the seat history shows as "no thread".
 */
import type { AgentTeamThreadRef } from './types.ts'

export interface AgentTeamTurnWindow {
  readonly startSequence: number
  readonly endSequence: number
}

export interface AgentTeamRepliedThread {
  readonly sequence: number
  readonly threadRef: AgentTeamThreadRef
}

export function threadRefsForTurn(
  delivered: readonly AgentTeamThreadRef[],
  replied: readonly AgentTeamRepliedThread[],
  window: AgentTeamTurnWindow,
): readonly AgentTeamThreadRef[] {
  const inWindow = replied
    .filter(entry => entry.sequence >= window.startSequence && entry.sequence <= window.endSequence)
    .sort((left, right) => left.sequence - right.sequence)
  return Object.freeze([...new Set<AgentTeamThreadRef>([...delivered, ...inWindow.map(entry => entry.threadRef)])])
}
