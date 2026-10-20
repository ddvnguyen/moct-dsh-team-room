import type { AgentTeamMemberRole } from './types.ts'

/** Every role a Member may carry; `member-context.ts` keeps one prompt section per entry. */
export const AGENT_TEAM_MEMBER_ROLES = ['architect', 'leader', 'worker', 'orchestrator'] as const satisfies readonly AgentTeamMemberRole[]

/** A stored role is one of the closed set, checked before it reaches the table; `null` and `undefined` mean no role. */
export function assertMemberRole(role: AgentTeamMemberRole | null | undefined): void {
  if (role === undefined || role === null) return
  if (!AGENT_TEAM_MEMBER_ROLES.includes(role)) throw new Error(`member role must be one of ${AGENT_TEAM_MEMBER_ROLES.join(', ')}`)
}
