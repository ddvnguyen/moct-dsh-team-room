import type { AgentTeamAgentMember } from './types.ts'

/** Multi-instance contract v2 §1/§3: a seat runs 1..5 concurrent instances, 2 by default. */
export const AGENT_TEAM_MIN_INSTANCES = 1
export const AGENT_TEAM_MAX_INSTANCES = 5
export const AGENT_TEAM_DEFAULT_INSTANCES = 2

/** The seat's effective instance count: the stored value, or the default when the Member predates the field. */
export function memberInstances(member: Pick<AgentTeamAgentMember, 'instances'>): number {
  return member.instances ?? AGENT_TEAM_DEFAULT_INSTANCES
}

/** Stored counts are exact integers in range; anything else is refused at commit, never clamped. */
export function assertInstances(instances: number | null | undefined): void {
  if (instances === undefined || instances === null) return
  if (!Number.isInteger(instances) || instances < AGENT_TEAM_MIN_INSTANCES || instances > AGENT_TEAM_MAX_INSTANCES) {
    throw new Error(`member instances must be an integer from ${AGENT_TEAM_MIN_INSTANCES} to ${AGENT_TEAM_MAX_INSTANCES}`)
  }
}
