import type { AgentTeamIssueView } from './types.ts'

/**
 * Whether one issue is in its planning phase.
 *
 * The rule lives in the Host, where the truth is: a Task is in its planning
 * phase when it is `todo` and holds no claim with `state === 'active'`. The
 * view carries that answer as `properties.planningPhase`, and this helper
 * only reads it — a client convenience, never a second rule to re-derive.
 */
export function isPlanningPhase(view: AgentTeamIssueView): boolean {
  return view.properties.planningPhase
}
